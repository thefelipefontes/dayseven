import Foundation
import Combine
import CoreLocation
import FirebaseAuth
import WatchConnectivity
import WidgetKit

// MARK: - App View Model

@MainActor
class AppViewModel: ObservableObject {
    // Services
    let authService = AuthService()
    let firestoreService = FirestoreService()
    let healthKitService = HealthKitService()
    let workoutManager = WorkoutManager()
    let phoneService = PhoneConnectivityService.shared
    let celebrationManager = CelebrationManager()

    private var cancellables = Set<AnyCancellable>()

    // User data
    @Published var activities: [Activity] = []
    @Published var goals: UserGoals = .defaults
    @Published var streaks: UserStreaks = .defaults
    /// Phone-owned injury pause. When true the streak is frozen and the watch shows a
    /// "paused" treatment instead of the normal flame. The watch never mutates this.
    @Published var injuryModeActive: Bool = false
    /// Categories frozen by the active injury pause. The watch must not advance these when a
    /// workout is saved (a partial injury keeps non-frozen categories counting). Phone-owned.
    @Published var injuryFrozenCats: [String] = []
    /// This week's celebration flags as last read from Firestore. `steps` and `master` are set
    /// only by the phone (they need weekly steps); saves carry them over for the same week.
    private var loadedWeekCelebrations: [String: Any] = [:]
    @Published var personalRecords: PersonalRecords = .defaults
    @Published var weeklyProgress: WeeklyProgress = .empty
    @Published var weeklyStats: WeeklyStats = WeeklyStats(totalWorkouts: 0, totalCalories: 0, totalMiles: 0, strengthCount: 0, cardioCount: 0, recoveryCount: 0)

    /// User's distance-unit preference ('mi' | 'km'). Seeded from SharedDefaults
    /// so cold launches start with the last known unit before Firestore returns.
    /// Updated by loadUserData() (slow path) and PhoneConnectivityService's
    /// applicationContext listener (fast path).
    @Published var distanceUnit: String = SharedDefaults.readDistanceUnit()

    // Health data
    @Published var todaySteps: Int = 0
    /// Sunday → now, for the Steps ring. Refreshed whenever today's steps update.
    @Published var weekSteps: Int = 0
    @Published var todayCalories: Int = 0
    @Published var todayDistance: Double = 0

    // State
    @Published var isLoading = true
    @Published var errorMessage: String?

    /// Guard: prevents loadUserData() from overwriting local state while a save/delete is in progress.
    /// Without this, a phone-triggered reload can race with a watch save and reset progress.
    ///
    /// A count of writes in flight, not a flag: saveActivity runs flushOfflineQueue inside
    /// itself, and the flush's `isSaving = false` used to clear the flag for the outer save
    /// too, leaving its whole write unguarded.
    private var writesInFlight = 0
    private var isSaving: Bool { writesInFlight > 0 }

    /// Writes finished so far. A load compares it before and after its fetch: if a write
    /// finished in between, the load's read may predate it and must not replace its result.
    private var writesFinished = 0

    /// Re-entrancy guard for loadUserData(). Not isLoading — that starts true to drive the
    /// launch spinner, so guarding on it would block the very first load.
    private var isLoadingData = false

    /// Timestamp of the last SUCCESSFUL load. Only successes count: a failed fetch must
    /// leave the next foreground free to retry immediately. Concurrent loads are already
    /// deduped by isLoadingData, so this doesn't need to guard against them.
    private var lastLoadTime: Date = .distantPast

    /// Consecutive failed loads, for the bounded retry below.
    private var loadRetryCount = 0
    private let maxLoadRetries = 3

    /// Timestamp of the last successful save/delete/update. Used to skip redundant
    /// dataChanged-triggered reloads within a cooldown window — after a save the watch
    /// already has the correct local state, so an immediate reload is unnecessary.
    private var lastSaveTime: Date = .distantPast

    /// Tracks the last known activity count from the watch's perspective (saves + loads).
    /// Used for logging to help debug sync issues.
    private var lastKnownActivityCount: Int = 0

    /// Read-modify-write attempts before giving up on a write the phone keeps racing.
    private let maxWriteAttempts = 3

    init() {
        // Give PhoneConnectivityService access to WorkoutManager for remote commands
        phoneService.workoutManager = workoutManager

        // Forward authService changes to trigger view updates
        authService.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.objectWillChange.send()
            }
            .store(in: &cancellables)

        // Mirror phone-pushed distance-unit changes onto our @Published so views
        // observing AppViewModel.distanceUnit flip immediately.
        phoneService.$distanceUnit
            .receive(on: DispatchQueue.main)
            .sink { [weak self] unit in
                guard let self = self else { return }
                if self.distanceUnit != unit {
                    self.distanceUnit = unit
                    SharedDefaults.writeDistanceUnit(unit)
                }
            }
            .store(in: &cancellables)

        // Forward workoutManager changes so views observing appVM
        // also update when workout metrics (timer, HR, etc.) change.
        // Throttle to avoid 30fps re-renders across the entire view tree —
        // the ActiveWorkoutView reads workoutManager directly for smooth updates.
        workoutManager.objectWillChange
            .throttle(for: .milliseconds(500), scheduler: DispatchQueue.main, latest: true)
            .sink { [weak self] _ in
                self?.objectWillChange.send()
            }
            .store(in: &cancellables)

        // Background health monitoring keeps today's steps/calories and the week's steps
        // current for the dashboard and complications. Neither is a daily goal any more, so
        // nothing celebrates here: steps are weekly (the phone celebrates the week) and
        // calories are a stat.
        healthKitService.onStepsUpdated = { [weak self] steps in
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                self.todaySteps = steps
                self.weekSteps = await self.fetchWeekStepsSafe()
                self.pushDataToWidget()
            }
        }

        healthKitService.onCaloriesUpdated = { [weak self] calories in
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                self.todayCalories = calories
                self.pushDataToWidget()
            }
        }

        // Observe phone reachability — when the phone reconnects, flush any
        // offline-queued activities (connectivity likely restored)
        phoneService.$isReachable
            .dropFirst()
            .filter { $0 == true }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self = self else { return }
                print("[AppViewModel] Phone became reachable — flushing offline queue")
                Task {
                    await self.flushOfflineQueue()
                }
            }
            .store(in: &cancellables)

        // Observe dataChangedFlag from PhoneConnectivityService
        // When the phone notifies us that data changed (e.g., activity deleted),
        // reload fresh data from Firestore so we don't operate on stale state
        phoneService.$dataChangedFlag
            .dropFirst() // skip initial value
            .filter { $0 == true }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self = self else { return }
                self.phoneService.dataChangedFlag = false

                // Skip reload if a save just completed — the watch already has correct
                // local state and the phone is just echoing back our own change.
                let timeSinceSave = Date().timeIntervalSince(self.lastSaveTime)
                if timeSinceSave < 5.0 {
                    print("[AppViewModel] Phone data changed — skipping reload (save completed \(String(format: "%.1f", timeSinceSave))s ago)")
                    return
                }

                print("[AppViewModel] Phone data changed — reloading from Firestore in 1s")
                Task {
                    // Small delay to ensure Firestore write has propagated
                    try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second
                    await self.loadUserData()
                    print("[AppViewModel] Reload after phone data change complete")
                }
            }
            .store(in: &cancellables)
    }

    // MARK: - Load User Data

    func loadUserData() async {
        // Don't overwrite local state while a save/delete/update is in progress.
        // The save already has the correct local state; a reload during batchSave
        // would fetch stale Firestore data and reset progress.
        if isSaving {
            print("[LoadUserData] Skipping — save in progress")
            return
        }

        guard let uid = authService.currentUser?.uid else {
            isLoading = false
            return
        }

        // A cold launch fires .task and the scenePhase handler together; without this
        // they'd both fetch the same document.
        if isLoadingData {
            print("[LoadUserData] Skipping — load already in progress")
            return
        }
        isLoadingData = true
        defer { isLoadingData = false }

        isLoading = true
        print("[LoadUserData] Starting fetch for uid \(uid.prefix(6))…")
        let writesBeforeFetch = writesFinished

        do {
            // Fetch Firestore data and HealthKit data in parallel
            async let firestoreData = firestoreService.getUserData(uid: uid)
            async let steps = fetchStepsSafe()
            async let calories = fetchCaloriesSafe()
            async let distance = fetchDistanceSafe()

            let userData = try await firestoreData

            distanceUnit = userData.distanceUnit
            SharedDefaults.writeDistanceUnit(userData.distanceUnit)
            loadRetryCount = 0

            if isSaving || writesFinished != writesBeforeFetch {
                // A save started or finished while this read was in flight. Its state is newer
                // than (or about to replace) what this read saw; adopting the read would put
                // the just-saved workout back off the rings.
                print("[LoadUserData] A save ran during the fetch — keeping its state over this read")
            } else {
                adopt(userData)
                setActivities(userData.activities)
                lastKnownActivityCount = activities.count

                lastLoadTime = Date()
            }

            print("[LoadUserData] Loaded \(activities.count) activities — lifts: \(weeklyProgress.lifts.completed)/\(goals.liftsPerWeek), cardio: \(weeklyProgress.cardio.completed)/\(goals.cardioPerWeek), recovery: \(weeklyProgress.recovery.completed)/\(goals.recoveryPerWeek)")

            // Health data
            todaySteps = await steps
            weekSteps = await fetchWeekStepsSafe()
            todayCalories = await calories
            todayDistance = await distance

            // Push data to widget
            pushDataToWidget()

            // Reconcile celebration flags with actual progress
            // (clears flags for goals no longer met, e.g. after phone-side deletion)
            reconcileCelebrationFlags()

            // Setup background health monitoring (idempotent — only runs once)
            healthKitService.setupBackgroundDelivery()

            // Flush any offline-queued work now that we have fresh data
            if OfflineQueueManager.shared.hasPendingWork {
                Task {
                    try? await Task.sleep(nanoseconds: 500_000_000) // 0.5s delay
                    await flushOfflineQueue()
                }
            }

            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false

            // This used to fail completely silently, which made a watch showing empty
            // rings indistinguishable from a watch that had simply loaded nothing.
            print("[LoadUserData] FAILED: \(error)")

            // Nothing else retries: RootView's .task guards on activities.isEmpty and has
            // already fired by now, and the foreground refresh only advances its cooldown
            // on success. watchOS connectivity drops constantly, so one unlucky fetch
            // would otherwise leave the rings at zero until the app is relaunched.
            if loadRetryCount < maxLoadRetries {
                loadRetryCount += 1
                let attempt = loadRetryCount
                print("[LoadUserData] Retrying in \(attempt * 2)s (attempt \(attempt)/\(maxLoadRetries))")
                Task { [weak self] in
                    try? await Task.sleep(nanoseconds: UInt64(attempt) * 2_000_000_000)
                    await self?.loadUserData()
                }
            } else {
                print("[LoadUserData] Giving up after \(maxLoadRetries) retries — will try again on next foreground")
            }
        }
    }

    // MARK: - Foreground Refresh

    /// Called when the app becomes active.
    ///
    /// Steps, calories and distance come straight from HealthKit and are cheap, so they
    /// always refresh. The rings are different: weeklyProgress is derived from the
    /// activities loaded out of Firestore, and nothing recomputed it once the app had
    /// data — .task guards on activities.isEmpty, and the phone's dataChanged push only
    /// lands if the watch happens to be reachable at that moment. So a workout logged on
    /// the phone left the rings frozen until the next cold launch.
    ///
    /// Rate limited so raising your wrist repeatedly doesn't hammer Firestore, and held
    /// off briefly after a local save, whose state is already correct.
    func refreshOnForeground() async {
        await refreshHealthData()

        if isLoadingData || isSaving { return }
        if Date().timeIntervalSince(lastLoadTime) < 30 { return }
        if Date().timeIntervalSince(lastSaveTime) < 5 { return }

        await loadUserData()
    }

    // MARK: - Refresh Health Data

    func refreshHealthData() async {
        todaySteps = await fetchStepsSafe()
        weekSteps = await fetchWeekStepsSafe()
        todayCalories = await fetchCaloriesSafe()
        todayDistance = await fetchDistanceSafe()
    }

    // MARK: - Safe HealthKit fetchers

    private func fetchStepsSafe() async -> Int {
        return (try? await healthKitService.fetchTodaySteps()) ?? 0
    }

    private func fetchWeekStepsSafe() async -> Int {
        return (try? await healthKitService.fetchWeekSteps()) ?? weekSteps
    }

    private func fetchCaloriesSafe() async -> Int {
        return (try? await healthKitService.fetchTodayCalories()) ?? 0
    }

    private func fetchDistanceSafe() async -> Double {
        return (try? await healthKitService.fetchTodayDistance()) ?? 0
    }

    // MARK: - Writes
    //
    // Every write below replaces the whole `activities` field, so each one starts from a fresh
    // read and applies only its own change to it. They never write the watch's in-memory
    // `activities`: after a load timeout that is often [], and PATCHing it used to wipe the
    // user's entire history. The read's updateTime goes along as a precondition; if the phone
    // wrote in between, Firestore refuses and we re-read and try again.

    private func beginWrite() {
        writesInFlight += 1
    }

    private func endWrite() {
        writesInFlight -= 1
        writesFinished += 1
    }

    /// Takes on the server's view of the user from a fresh read.
    private func adopt(_ data: UserDocument) {
        hasServerState = true
        activities = data.activities
        goals = data.goals
        streaks = data.streaks
        injuryModeActive = data.injuryActive
        injuryFrozenCats = data.injuryFrozen
        loadedWeekCelebrations = data.weekCelebrations
        personalRecords = data.personalRecords
    }

    // MARK: - Save Activity (after workout ends)

    /// Returns the id the workout is stored (or queued) under — an existing activity's id when
    /// Firestore already holds this HealthKit workout — or nil if nothing was saved.
    @discardableResult
    func saveActivity(_ activity: Activity) async -> ActivityID? {
        beginWrite()
        defer { endWrite() }

        guard let uid = authService.currentUser?.uid else {
            print("[SaveActivity] No user uid — skipping save")
            errorMessage = "Not signed in"
            return nil
        }
        print("[SaveActivity] Saving for uid: \(uid), type: \(activity.type)")

        // Flush any previously queued offline activities first
        await flushOfflineQueue()

        for attempt in 1...maxWriteAttempts {
            let freshData: UserDocument
            do {
                freshData = try await firestoreService.getUserData(uid: uid)
            } catch {
                // Without a fresh read there is nothing safe to write: queue the workout and let
                // the flush merge it into a real read later.
                print("[SaveActivity] Could not read Firestore — queueing instead of writing: \(error.localizedDescription)")
                // It shows on the rings from the queue. Streaks and celebrations are left alone:
                // without a read the local list may be missing most of the week. The flush
                // doesn't advance them either; the phone recalculates streaks from history on
                // its next load.
                OfflineQueueManager.shared.enqueue(activity)
                setActivities(activities)
                pushDataToWidget()
                return activity.id
            }
            adopt(freshData)
            print("[SaveActivity] Refreshed \(activities.count) activities from Firestore before save")

            // Already there: an earlier attempt that did land, or the phone's copy of the same
            // HealthKit workout. Inserting again would log it twice.
            if let existing = freshData.activities.first(where: { $0.id == activity.id || activity.isSameHealthKitWorkout(as: $0) }) {
                print("[SaveActivity] Firestore already has this workout as \(existing.id) — not inserting a duplicate")
                setActivities(freshData.activities)
                pushDataToWidget()
                return existing.id
            }

            // Progress before this workout, from the same fresh read. weeklyProgress is the
            // last local view: if the phone logged the goal-completing workout since, it still
            // reads "one short", this save looks like it completed the goal, and streaks.lifts
            // gets a second +1 (with longestStrengthStreak ratcheting up for good).
            let oldProgress = calculateWeeklyProgress(activities: freshData.activities, goals: goals)

            let updatedActivities = [activity] + freshData.activities
            let newProgress = calculateWeeklyProgress(activities: updatedActivities, goals: goals)

            // Check for streak updates. This advances self.streaks / personalRecords; a retry
            // re-adopts the fresh read first, so a refused attempt can't count twice.
            let category = ActivityTypes.getActivityCategory(activity)
            var recordUpdates: [String: Any]? = nil
            let completed = updateStreaksIfNeeded(oldProgress: oldProgress, newProgress: newProgress, category: category, recordUpdates: &recordUpdates)

            // Build weekCelebrations update if any category was just completed
            var weekCelebrations: [String: Any]? = nil
            if completed.lifts || completed.cardio || completed.recovery || completed.master {
                let weekKey = currentWeekKey()
                weekCelebrations = [
                    "week": weekKey,
                    "lifts": completed.lifts || newProgress.lifts.completed >= goals.liftsPerWeek,
                    "cardio": completed.cardio || newProgress.cardio.completed >= goals.cardioPerWeek,
                    // A recovery goal of 0 means Recovery is off — never "met"
                    "recovery": completed.recovery || (goals.recoveryPerWeek > 0 && newProgress.recovery.completed >= goals.recoveryPerWeek),
                    "steps": phoneWeekFlag("steps", week: weekKey),
                    "master": phoneWeekFlag("master", week: weekKey)
                ]
            }

            do {
                try await firestoreService.batchSave(
                    uid: uid,
                    activities: updatedActivities,
                    streaks: streaks,
                    recordUpdates: recordUpdates,
                    weekCelebrations: weekCelebrations,
                    expectedUpdateTime: freshData.updateTime
                )
            } catch FirestoreError.preconditionFailed where attempt < maxWriteAttempts {
                print("[SaveActivity] Document changed since the read (attempt \(attempt)) — re-reading")
                continue
            } catch {
                print("[SaveActivity] FAILED — queueing for retry: \(error.localizedDescription)")
                OfflineQueueManager.shared.enqueue(activity)
                // Still show it (and its goal) locally; the flush and the phone settle the rest.
                setActivities(updatedActivities)
                celebrate(completed)
                pushDataToWidget()
                return activity.id
            }

            print("[SaveActivity] Successfully saved \(updatedActivities.count) activities to Firestore")
            setActivities(updatedActivities)
            celebrate(completed)

            // Mark save time so we skip redundant dataChanged reloads
            // (the phone will echo back a dataChanged after processing our save)
            lastSaveTime = Date()
            lastKnownActivityCount = updatedActivities.count

            // Push updated data to widget
            pushDataToWidget()

            // Notify the iPhone to refresh its Firestore cache
            notifyPhoneDataChanged()
            return activity.id
        }
        return nil
    }

    /// Replaces the local activities and recomputes everything derived from them. Work still
    /// in the offline queue is laid over `list`, so a queued save stays on the rings and a
    /// queued discard stays off them until the flush lands it.
    private func setActivities(_ list: [Activity]) {
        let shown = OfflineQueueManager.shared.applyingPending(to: list)
        activities = shown
        weeklyProgress = calculateWeeklyProgress(activities: shown, goals: goals)
        weeklyStats = calculateWeeklyStats(activities: shown)
    }

    /// Plays the celebrations for goals a save just completed. Master overrides the
    /// individual categories (foreground — the user just logged from the watch).
    private func celebrate(_ completed: (lifts: Bool, cardio: Bool, recovery: Bool, master: Bool)) {
        if completed.master {
            celebrationManager.triggerCelebration(.master, streakCount: streaks.master, isBackground: false)
        } else {
            if completed.lifts {
                celebrationManager.triggerCelebration(.strength, streakCount: streaks.lifts, isBackground: false)
            }
            if completed.cardio {
                celebrationManager.triggerCelebration(.cardio, streakCount: streaks.cardio, isBackground: false)
            }
            if completed.recovery {
                celebrationManager.triggerCelebration(.recovery, streakCount: streaks.recovery, isBackground: false)
            }
        }
    }

    // MARK: - Update Activity (re-save with changed details)

    func updateActivityDetails(_ update: ActivityDetailsUpdate) async {
        beginWrite()
        defer { endWrite() }

        let activityId = update.activityId
        guard let uid = authService.currentUser?.uid else {
            print("[UpdateActivity] No user uid — skipping update")
            return
        }

        for attempt in 1...maxWriteAttempts {
            let freshData: UserDocument
            do {
                freshData = try await firestoreService.getUserData(uid: uid)
            } catch {
                print("[UpdateActivity] Could not read Firestore — queueing the edit: \(error.localizedDescription)")
                queueUpdate(update)
                return
            }
            adopt(freshData)

            // Merge by id into the fresh list: only this one activity changes.
            var updatedActivities = freshData.activities
            guard let index = updatedActivities.firstIndex(where: { $0.id == activityId }) else {
                if OfflineQueueManager.shared.pendingActivities.contains(where: { $0.id == activityId }) {
                    // Its save is still queued; the edit rides along with it.
                    queueUpdate(update)
                } else {
                    print("[UpdateActivity] Activity not in Firestore: \(activityId)")
                    setActivities(updatedActivities)
                }
                return
            }
            update.apply(to: &updatedActivities[index])

            // Save to Firestore using batchSave (always uses field masks to prevent wiping other fields)
            do {
                try await firestoreService.batchSave(
                    uid: uid,
                    activities: updatedActivities,
                    streaks: streaks,
                    recordUpdates: nil,
                    expectedUpdateTime: freshData.updateTime
                )
            } catch FirestoreError.preconditionFailed where attempt < maxWriteAttempts {
                print("[UpdateActivity] Document changed since the read (attempt \(attempt)) — re-reading")
                continue
            } catch {
                print("[UpdateActivity] FAILED — queueing the edit: \(error.localizedDescription)")
                queueUpdate(update)
                return
            }
            print("[UpdateActivity] Successfully updated activity \(activityId)")

            setActivities(updatedActivities)
            lastSaveTime = Date()
            lastKnownActivityCount = updatedActivities.count
            pushDataToWidget()

            // Notify the iPhone to refresh
            notifyPhoneDataChanged()
            return
        }
    }

    private func queueUpdate(_ update: ActivityDetailsUpdate) {
        OfflineQueueManager.shared.enqueueUpdate(update)
        setActivities(activities)
        pushDataToWidget()
    }

    // MARK: - Offline Queue Flush

    /// Retries the writes that were queued due to network failures: new activities, detail
    /// edits and discards. Fetches fresh data from Firestore, merges the queue into it, and
    /// saves once.
    func flushOfflineQueue() async {
        let queue = OfflineQueueManager.shared
        guard queue.hasPendingWork, !queue.isFlushing else { return }
        guard let uid = authService.currentUser?.uid else { return }

        beginWrite()
        defer { endWrite() }

        queue.isFlushing = true
        defer { queue.isFlushing = false }

        for attempt in 1...maxWriteAttempts {
            do {
                // Fetch fresh state from Firestore
                let freshData = try await firestoreService.getUserData(uid: uid)

                // Snapshot the queue after the read, so a discard made while it was in flight
                // stays out. Anything queued from here on waits for the next flush.
                let inserts = queue.pendingActivities
                let updates = queue.pendingUpdates
                let deletions = queue.pendingDeletions
                print("[OfflineFlush] Flushing \(inserts.count) activities, \(updates.count) edits, \(deletions.count) discards")

                let merged = OfflineQueueManager.merge(inserts: inserts, updates: updates, deletions: deletions, into: freshData.activities)

                guard merged.changed else {
                    queue.removeFlushed(inserts: inserts.map(\.id), updates: updates, deletions: deletions)
                    print("[OfflineFlush] All pending already synced — cleared queue")
                    return
                }

                // Save using batchSave (always uses field masks to prevent wiping other fields)
                try await firestoreService.batchSave(
                    uid: uid,
                    activities: merged.activities,
                    streaks: freshData.streaks,
                    recordUpdates: nil,
                    expectedUpdateTime: freshData.updateTime
                )

                queue.removeFlushed(inserts: inserts.map(\.id), updates: updates, deletions: deletions)

                // Update local state
                adopt(freshData)
                setActivities(merged.activities)
                pushDataToWidget()

                lastSaveTime = Date()
                lastKnownActivityCount = merged.activities.count

                // Notify the phone to refresh and reconcile streaks
                notifyPhoneDataChanged()

                print("[OfflineFlush] Successfully flushed the queue (\(merged.activities.count) activities)")
                return
            } catch FirestoreError.preconditionFailed where attempt < maxWriteAttempts {
                print("[OfflineFlush] Document changed since the read (attempt \(attempt)) — re-reading")
                continue
            } catch {
                print("[OfflineFlush] Failed — will retry later: \(error.localizedDescription)")
                return
            }
        }
    }

    // MARK: - Delete Activity (for discard after auto-save)

    func deleteActivity(withId activityId: ActivityID) async {
        beginWrite()
        defer { endWrite() }

        // A queued auto-save (or edit) of this workout would otherwise be flushed later and
        // bring the discarded workout back.
        let queue = OfflineQueueManager.shared
        let saveWasQueued = queue.drop(activityId)
        // A flush already writing may still carry that save in its snapshot. Leave a queued
        // discard behind in that case; if there turns out to be nothing to discard, the next
        // flush just clears it.
        defer {
            if saveWasQueued || queue.isFlushing, !queue.pendingDeletions.contains(activityId) {
                queue.enqueueDeletion(activityId)
            }
        }

        guard let uid = authService.currentUser?.uid else {
            print("[DeleteActivity] No user uid — skipping delete")
            return
        }

        for attempt in 1...maxWriteAttempts {
            let freshData: UserDocument
            do {
                freshData = try await firestoreService.getUserData(uid: uid)
            } catch {
                print("[DeleteActivity] Could not read Firestore — queueing the discard: \(error.localizedDescription)")
                queueDeletion(activityId)
                return
            }
            adopt(freshData)

            guard freshData.activities.contains(where: { $0.id == activityId }) else {
                print("[DeleteActivity] Activity not in Firestore (already gone): \(activityId)")
                setActivities(freshData.activities)
                pushDataToWidget()
                return
            }

            // Progress before and after, both from the fresh read
            let oldProgress = calculateWeeklyProgress(activities: freshData.activities, goals: goals)
            let updatedActivities = freshData.activities.filter { $0.id != activityId }
            let newProgress = calculateWeeklyProgress(activities: updatedActivities, goals: goals)

            // Check if deletion drops any category below goal and decrement streaks.
            // Like the save, this edits self.streaks, which a retry re-adopts from the read.
            var weekCelebrations: [String: Any]? = nil
            let liftsDropped = oldProgress.lifts.completed >= goals.liftsPerWeek && newProgress.lifts.completed < goals.liftsPerWeek
            let cardioDropped = oldProgress.cardio.completed >= goals.cardioPerWeek && newProgress.cardio.completed < goals.cardioPerWeek
            let recoveryDropped = oldProgress.recovery.completed >= goals.recoveryPerWeek && newProgress.recovery.completed < goals.recoveryPerWeek
            let wasAllMet = oldProgress.allGoalsMet

            if liftsDropped || cardioDropped || recoveryDropped {
                if liftsDropped { streaks.lifts = max(0, streaks.lifts - 1) }
                if cardioDropped { streaks.cardio = max(0, streaks.cardio - 1) }
                if recoveryDropped { streaks.recovery = max(0, streaks.recovery - 1) }

                // Build weekCelebrations clearing the flags for dropped categories
                let weekKey = currentWeekKey()
                weekCelebrations = [
                    "week": weekKey,
                    "lifts": !liftsDropped && newProgress.lifts.completed >= goals.liftsPerWeek,
                    "cardio": !cardioDropped && newProgress.cardio.completed >= goals.cardioPerWeek,
                    "recovery": !recoveryDropped && goals.recoveryPerWeek > 0 && newProgress.recovery.completed >= goals.recoveryPerWeek,
                    "steps": phoneWeekFlag("steps", week: weekKey),
                    // Strength and Cardio are part of every Winning Streak rule; the phone
                    // re-judges the week (and its recovery/steps parts) on its next recalculation.
                    "master": (liftsDropped || cardioDropped) ? false : phoneWeekFlag("master", week: weekKey)
                ]
            }

            do {
                try await firestoreService.batchSave(
                    uid: uid,
                    activities: updatedActivities,
                    streaks: streaks,
                    recordUpdates: nil,
                    weekCelebrations: weekCelebrations,
                    expectedUpdateTime: freshData.updateTime
                )
            } catch FirestoreError.preconditionFailed where attempt < maxWriteAttempts {
                print("[DeleteActivity] Document changed since the read (attempt \(attempt)) — re-reading")
                continue
            } catch {
                print("[DeleteActivity] FAILED — queueing the discard: \(error.localizedDescription)")
                queueDeletion(activityId)
                return
            }
            print("[DeleteActivity] Successfully removed activity and saved \(updatedActivities.count) activities")

            if liftsDropped { celebrationManager.clearCelebration(.strength) }
            if cardioDropped { celebrationManager.clearCelebration(.cardio) }
            if recoveryDropped { celebrationManager.clearCelebration(.recovery) }
            // The Winning Streak count itself is the phone's (it needs weekly steps); the
            // watch only clears its own celebration flag.
            if (liftsDropped || cardioDropped || recoveryDropped) && wasAllMet {
                celebrationManager.clearCelebration(.master)
            }

            setActivities(updatedActivities)
            lastSaveTime = Date()
            lastKnownActivityCount = updatedActivities.count

            // Push updated data to widget
            pushDataToWidget()

            // Notify the iPhone to refresh
            notifyPhoneDataChanged()
            return
        }
    }

    /// Queues a discard that couldn't be written, and takes the workout off the rings now.
    private func queueDeletion(_ id: ActivityID) {
        OfflineQueueManager.shared.enqueueDeletion(id)
        setActivities(activities)
        pushDataToWidget()
    }

    // MARK: - Notify Phone (with background fallback)

    /// Notifies the iPhone that data changed. Uses sendMessage for real-time when reachable,
    /// falls back to transferUserInfo for background/unreachable delivery.
    func notifyPhoneDataChanged() {
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(["action": "activitySaved"], replyHandler: { reply in
                print("[NotifyPhone] iPhone refreshed: \(reply)")
            }, errorHandler: { error in
                print("[NotifyPhone] sendMessage failed: \(error.localizedDescription) — using transferUserInfo")
                WCSession.default.transferUserInfo(["action": "activitySaved", "timestamp": Date().timeIntervalSince1970])
            })
        } else {
            WCSession.default.transferUserInfo(["action": "activitySaved", "timestamp": Date().timeIntervalSince1970])
            print("[NotifyPhone] Phone not reachable — queued transferUserInfo")
        }
    }

    // MARK: - Streak Update Logic (matches App.jsx lines 17555-17703)

    /// Returns which categories/master were just completed (for celebration tracking)
    @discardableResult
    private func updateStreaksIfNeeded(
        oldProgress: WeeklyProgress,
        newProgress: WeeklyProgress,
        category: String,
        recordUpdates: inout [String: Any]?
    ) -> (lifts: Bool, cardio: Bool, recovery: Bool, master: Bool) {
        // Check if individual goals were just completed
        // (lifting+cardio counts toward both, matching calculateWeeklyProgress and the phone's countsAsLifting/countsAsCardio)
        let justCompletedLifts = (category == "lifting" || category == "lifting+cardio") &&
            oldProgress.lifts.completed < goals.liftsPerWeek &&
            newProgress.lifts.completed >= goals.liftsPerWeek

        let justCompletedCardio = (category == "cardio" || category == "lifting+cardio") &&
            oldProgress.cardio.completed < goals.cardioPerWeek &&
            newProgress.cardio.completed >= goals.cardioPerWeek

        let justCompletedRecovery = category == "recovery" &&
            oldProgress.recovery.completed < goals.recoveryPerWeek &&
            newProgress.recovery.completed >= goals.recoveryPerWeek

        var updates: [String: Any] = [:]

        // Injury-aware: don't optimistically advance a frozen category, and never advance master
        // during any injury pause (the phone recalc is canonical and applies activation-week
        // credit). A partial injury still lets non-frozen categories advance normally.
        let injFrozen = injuryModeActive ? injuryFrozenCats : []
        let creditLifts = justCompletedLifts && !injFrozen.contains("lifts")
        let creditCardio = justCompletedCardio && !injFrozen.contains("cardio")
        let creditRecovery = justCompletedRecovery && !injFrozen.contains("recovery")

        // Update individual streaks
        if creditLifts {
            streaks.lifts += 1
            if streaks.lifts > (personalRecords.longestStrengthStreak ?? 0) {
                personalRecords.longestStrengthStreak = streaks.lifts
                updates["longestStrengthStreak"] = streaks.lifts
            }
        }

        if creditCardio {
            streaks.cardio += 1
            if streaks.cardio > (personalRecords.longestCardioStreak ?? 0) {
                personalRecords.longestCardioStreak = streaks.cardio
                updates["longestCardioStreak"] = streaks.cardio
            }
        }

        if creditRecovery {
            streaks.recovery += 1
            if streaks.recovery > (personalRecords.longestRecoveryStreak ?? 0) {
                personalRecords.longestRecoveryStreak = streaks.recovery
                updates["longestRecoveryStreak"] = streaks.recovery
            }
        }

        // The Winning Streak (master) is no longer advanced here. From each user's rule start it
        // needs weekly steps (Strength + Cardio + Steps), which the watch doesn't track yet, so
        // the phone owns the count, the record and the week celebration — it recalculates
        // after every watch save (watchActivitySaved). Advancing it here with the old
        // three-category rule used to overwrite the phone's value.
        let justCompletedWeek = false

        if !updates.isEmpty {
            recordUpdates = updates
        }
        return (lifts: creditLifts, cardio: creditCardio, recovery: creditRecovery, master: justCompletedWeek)
    }

    /// A flag only the phone sets (steps, master), carried over when it belongs to `week`.
    private func phoneWeekFlag(_ key: String, week: String) -> Bool {
        guard (loadedWeekCelebrations["week"] as? String) == week else { return false }
        return loadedWeekCelebrations[key] as? Bool ?? false
    }

    /// Returns the current week key (Sunday start date as "yyyy-MM-dd")
    private func currentWeekKey() -> String {
        formatDateString(startOfCurrentWeek())
    }

    // MARK: - Daily Goal Celebration Check

    /// Clear celebration flags for any goals that are no longer met.
    /// Called after loadUserData to handle phone-side deletions or data changes.
    private func reconcileCelebrationFlags() {
        if weeklyProgress.lifts.completed < goals.liftsPerWeek {
            celebrationManager.clearCelebration(.strength)
        }
        if weeklyProgress.cardio.completed < goals.cardioPerWeek {
            celebrationManager.clearCelebration(.cardio)
        }
        if weeklyProgress.recovery.completed < goals.recoveryPerWeek {
            celebrationManager.clearCelebration(.recovery)
        }
        if !weeklyProgress.allGoalsMet {
            celebrationManager.clearCelebration(.master)
        }
    }

    // MARK: - Request HealthKit Permissions

    func requestHealthKitPermissions() async {
        do {
            try await healthKitService.requestAuthorization()
        } catch {
            errorMessage = "HealthKit: \(error.localizedDescription)"
        }
    }

    // MARK: - Request Location Permission (for GPS-tracked workouts)

    /// Held as a property so the prompt's delegate callback can fire — a
    /// short-lived stack instance would be deallocated before the user taps.
    /// Only `.notDetermined` triggers the system prompt; previously-granted
    /// and previously-denied users are silently skipped (the call is a no-op
    /// after the first decision, and there's no way to re-prompt without
    /// sending the user to Settings).
    private let onboardingLocationManager = CLLocationManager()

    func requestLocationPermissionIfNeeded() {
        guard onboardingLocationManager.authorizationStatus == .notDetermined else { return }
        onboardingLocationManager.requestWhenInUseAuthorization()
    }

    // MARK: - Push Data to Widget Complication

    /// Last time pushDataToWidget asked WidgetKit for a reload
    private var lastWidgetReload: Date = .distantPast

    /// Whether this launch has read the user from Firestore yet. Until then goals and streaks
    /// are the defaults, and writing them would replace the complication's last good data
    /// with a 0 streak.
    private var hasServerState = false

    private func pushDataToWidget() {
        guard hasServerState else { return }
        // Recompute for the week as it is now. weeklyProgress is only refreshed when the
        // activities change, so the first steps delivery after Sunday midnight wrote last
        // week's counts stamped as the new week, and the complication showed them as done.
        weeklyProgress = calculateWeeklyProgress(activities: activities, goals: goals)

        let change = SharedDefaults.writeStreakData(
            masterStreak: streaks.master,
            liftsStreak: streaks.lifts,
            cardioStreak: streaks.cardio,
            recoveryStreak: streaks.recovery,
            liftsCompleted: weeklyProgress.lifts.completed,
            liftsGoal: weeklyProgress.lifts.goal,
            cardioCompleted: weeklyProgress.cardio.completed,
            cardioGoal: weeklyProgress.cardio.goal,
            recoveryCompleted: weeklyProgress.recovery.completed,
            recoveryGoal: weeklyProgress.recovery.goal,
            todaySteps: todaySteps,
            stepsGoal: goals.stepsPerDay,
            todayCalories: todayCalories,
            weekSteps: weekSteps,
            injuryModeActive: injuryModeActive
        )
        // Reloads come out of the complication's daily budget. The HealthKit observers call
        // this on every steps or calories delivery, and it used to reload each time; now
        // nothing drawn changing means no reload, and steps alone reload at most every 15
        // minutes (the timeline's own 30-minute refresh picks up the rest).
        switch change {
        case .none:
            return
        case .steps where Date().timeIntervalSince(lastWidgetReload) < 15 * 60:
            return
        case .steps, .other:
            lastWidgetReload = Date()
            WidgetCenter.shared.reloadAllTimelines()
            print("[Widget] Pushed streak data and reloaded timelines")
        }
    }
}
