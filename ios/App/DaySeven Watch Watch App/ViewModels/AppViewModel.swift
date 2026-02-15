import Foundation
import Combine
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
    @Published var personalRecords: PersonalRecords = .defaults
    @Published var weeklyProgress: WeeklyProgress = .empty
    @Published var weeklyStats: WeeklyStats = WeeklyStats(totalWorkouts: 0, totalCalories: 0, totalMiles: 0, strengthCount: 0, cardioCount: 0, recoveryCount: 0)

    // Health data
    @Published var todaySteps: Int = 0
    @Published var todayCalories: Int = 0
    @Published var todayDistance: Double = 0

    // State
    @Published var isLoading = true
    @Published var errorMessage: String?

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

        // Wire up background health monitoring for steps/calories celebrations
        healthKitService.onStepsUpdated = { [weak self] steps in
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                self.todaySteps = steps
                self.checkDailyGoalCelebrations(isBackground: true)
                self.pushDataToWidget()
            }
        }

        healthKitService.onCaloriesUpdated = { [weak self] calories in
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                self.todayCalories = calories
                self.checkDailyGoalCelebrations(isBackground: true)
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
                print("[AppViewModel] Phone data changed — reloading from Firestore in 1s")
                self.phoneService.dataChangedFlag = false
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
        guard let uid = authService.currentUser?.uid else {
            isLoading = false
            return
        }

        isLoading = true

        do {
            // Fetch Firestore data and HealthKit data in parallel
            async let firestoreData = firestoreService.getUserData(uid: uid)
            async let steps = fetchStepsSafe()
            async let calories = fetchCaloriesSafe()
            async let distance = fetchDistanceSafe()

            let userData = try await firestoreData
            activities = userData.activities
            goals = userData.goals
            streaks = userData.streaks
            personalRecords = userData.personalRecords

            // Calculate progress
            weeklyProgress = calculateWeeklyProgress(activities: activities, goals: goals)
            weeklyStats = calculateWeeklyStats(activities: activities)

            // Health data
            todaySteps = await steps
            todayCalories = await calories
            todayDistance = await distance

            // Push data to widget
            pushDataToWidget()

            // Reconcile celebration flags with actual progress
            // (clears flags for goals no longer met, e.g. after phone-side deletion)
            reconcileCelebrationFlags()

            // Setup background health monitoring (idempotent — only runs once)
            healthKitService.setupBackgroundDelivery()

            // Check if daily goals are already met (foreground check)
            checkDailyGoalCelebrations(isBackground: false)

            // Flush any offline-queued activities now that we have fresh data
            if OfflineQueueManager.shared.hasPendingActivities {
                Task {
                    try? await Task.sleep(nanoseconds: 500_000_000) // 0.5s delay
                    await flushOfflineQueue()
                }
            }

            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    // MARK: - Refresh Health Data

    func refreshHealthData() async {
        todaySteps = await fetchStepsSafe()
        todayCalories = await fetchCaloriesSafe()
        todayDistance = await fetchDistanceSafe()

        // Check if daily goals were hit
        checkDailyGoalCelebrations(isBackground: false)
    }

    // MARK: - Safe HealthKit fetchers

    private func fetchStepsSafe() async -> Int {
        return (try? await healthKitService.fetchTodaySteps()) ?? 0
    }

    private func fetchCaloriesSafe() async -> Int {
        return (try? await healthKitService.fetchTodayCalories()) ?? 0
    }

    private func fetchDistanceSafe() async -> Double {
        return (try? await healthKitService.fetchTodayDistance()) ?? 0
    }

    // MARK: - Save Activity (after workout ends)

    func saveActivity(_ activity: Activity) async {
        guard let uid = authService.currentUser?.uid else {
            print("[SaveActivity] No user uid — skipping save")
            errorMessage = "Not signed in"
            return
        }
        print("[SaveActivity] Saving for uid: \(uid), type: \(activity.type)")

        // Flush any previously queued offline activities first
        await flushOfflineQueue()

        // Fetch fresh data from Firestore to avoid overwriting activities added from phone
        do {
            let freshData = try await firestoreService.getUserData(uid: uid)
            activities = freshData.activities
            goals = freshData.goals
            streaks = freshData.streaks
            personalRecords = freshData.personalRecords
            print("[SaveActivity] Refreshed \(activities.count) activities from Firestore before save")
        } catch {
            print("[SaveActivity] Warning: Could not refresh from Firestore, using local data: \(error.localizedDescription)")
        }

        // Store previous progress for streak comparison
        let oldProgress = weeklyProgress

        // Add activity to the beginning of the array
        var updatedActivities = activities
        updatedActivities.insert(activity, at: 0)
        activities = updatedActivities

        // Recalculate progress
        let newProgress = calculateWeeklyProgress(activities: updatedActivities, goals: goals)
        weeklyProgress = newProgress
        weeklyStats = calculateWeeklyStats(activities: updatedActivities)

        // Check for streak updates
        let category = ActivityTypes.getActivityCategory(activity)
        var recordUpdates: [String: Any]? = nil
        let completed = updateStreaksIfNeeded(oldProgress: oldProgress, newProgress: newProgress, category: category, recordUpdates: &recordUpdates)

        // Trigger watch celebrations for completed goals (foreground — user just logged from watch)
        // Master streak overrides individual category celebrations
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

        // Build weekCelebrations update if any category was just completed
        var weekCelebrations: [String: Any]? = nil
        if completed.lifts || completed.cardio || completed.recovery || completed.master {
            let weekKey = currentWeekKey()
            weekCelebrations = [
                "week": weekKey,
                "lifts": completed.lifts || newProgress.lifts.completed >= goals.liftsPerWeek,
                "cardio": completed.cardio || newProgress.cardio.completed >= goals.cardioPerWeek,
                "recovery": completed.recovery || newProgress.recovery.completed >= goals.recoveryPerWeek,
                "master": completed.master
            ]
        }

        // Save to Firestore
        do {
            try await firestoreService.batchSave(
                uid: uid,
                activities: updatedActivities,
                streaks: streaks,
                recordUpdates: recordUpdates,
                weekCelebrations: weekCelebrations
            )
            print("[SaveActivity] Successfully saved \(updatedActivities.count) activities to Firestore")

            // Push updated data to widget
            pushDataToWidget()

            // Notify the iPhone to refresh its Firestore cache
            if WCSession.default.isReachable {
                WCSession.default.sendMessage(["action": "activitySaved"], replyHandler: { reply in
                    print("[SaveActivity] iPhone cache refresh: \(reply)")
                }, errorHandler: { error in
                    print("[SaveActivity] iPhone notify failed: \(error.localizedDescription)")
                })
            }
        } catch {
            print("[SaveActivity] FAILED — queueing for retry: \(error.localizedDescription)")
            OfflineQueueManager.shared.enqueue(activity)
            // Still push to widget so local state is reflected immediately
            pushDataToWidget()
        }
    }

    // MARK: - Offline Queue Flush

    /// Retries saving any activities that were queued due to network failures.
    /// Fetches fresh data from Firestore, merges pending activities, and saves.
    func flushOfflineQueue() async {
        let queue = OfflineQueueManager.shared
        guard queue.hasPendingActivities, !queue.isFlushing else { return }
        guard let uid = authService.currentUser?.uid else { return }

        queue.isFlushing = true
        defer { queue.isFlushing = false }

        let pending = queue.pendingActivities
        print("[OfflineFlush] Flushing \(pending.count) pending activities")

        do {
            // Fetch fresh state from Firestore
            let freshData = try await firestoreService.getUserData(uid: uid)
            var mergedActivities = freshData.activities

            // Merge: insert pending activities that aren't already in Firestore
            var addedCount = 0
            for activity in pending {
                if !mergedActivities.contains(where: { $0.id == activity.id }) {
                    mergedActivities.insert(activity, at: 0)
                    addedCount += 1
                }
            }

            guard addedCount > 0 else {
                queue.clearAll()
                print("[OfflineFlush] All pending already synced — cleared queue")
                return
            }

            // Save only the activities array (streaks reconcile via phone notification)
            try await firestoreService.saveActivities(uid: uid, activities: mergedActivities)

            queue.clearAll()

            // Update local state
            activities = mergedActivities
            goals = freshData.goals
            streaks = freshData.streaks
            personalRecords = freshData.personalRecords
            weeklyProgress = calculateWeeklyProgress(activities: mergedActivities, goals: freshData.goals)
            weeklyStats = calculateWeeklyStats(activities: mergedActivities)
            pushDataToWidget()

            // Notify the phone to refresh and reconcile streaks
            if WCSession.default.isReachable {
                WCSession.default.sendMessage(["action": "activitySaved"], replyHandler: { _ in }, errorHandler: { _ in })
            }

            print("[OfflineFlush] Successfully flushed \(addedCount) activities")
        } catch {
            print("[OfflineFlush] Failed — will retry later: \(error.localizedDescription)")
        }
    }

    // MARK: - Delete Activity (for discard after auto-save)

    func deleteActivity(withId activityId: ActivityID) async {
        guard let uid = authService.currentUser?.uid else {
            print("[DeleteActivity] No user uid — skipping delete")
            return
        }

        // Capture old progress before deletion
        let oldProgress = weeklyProgress

        // Remove from local array
        var updatedActivities = activities
        updatedActivities.removeAll { $0.id == activityId }
        activities = updatedActivities

        // Recalculate progress
        let newProgress = calculateWeeklyProgress(activities: updatedActivities, goals: goals)
        weeklyProgress = newProgress
        weeklyStats = calculateWeeklyStats(activities: updatedActivities)

        // Check if deletion drops any category below goal and decrement streaks
        var weekCelebrations: [String: Any]? = nil
        let liftsDropped = oldProgress.lifts.completed >= goals.liftsPerWeek && newProgress.lifts.completed < goals.liftsPerWeek
        let cardioDropped = oldProgress.cardio.completed >= goals.cardioPerWeek && newProgress.cardio.completed < goals.cardioPerWeek
        let recoveryDropped = oldProgress.recovery.completed >= goals.recoveryPerWeek && newProgress.recovery.completed < goals.recoveryPerWeek
        let wasAllMet = oldProgress.allGoalsMet

        if liftsDropped || cardioDropped || recoveryDropped {
            if liftsDropped {
                streaks.lifts = max(0, streaks.lifts - 1)
                celebrationManager.clearCelebration(.strength)
            }
            if cardioDropped {
                streaks.cardio = max(0, streaks.cardio - 1)
                celebrationManager.clearCelebration(.cardio)
            }
            if recoveryDropped {
                streaks.recovery = max(0, streaks.recovery - 1)
                celebrationManager.clearCelebration(.recovery)
            }
            if wasAllMet {
                streaks.master = max(0, streaks.master - 1)
                celebrationManager.clearCelebration(.master)
            }

            // Build weekCelebrations clearing the flags for dropped categories
            let weekKey = currentWeekKey()
            weekCelebrations = [
                "week": weekKey,
                "lifts": !liftsDropped && newProgress.lifts.completed >= goals.liftsPerWeek,
                "cardio": !cardioDropped && newProgress.cardio.completed >= goals.cardioPerWeek,
                "recovery": !recoveryDropped && newProgress.recovery.completed >= goals.recoveryPerWeek,
                "master": false
            ]
        }

        // Save to Firestore
        do {
            try await firestoreService.batchSave(
                uid: uid,
                activities: updatedActivities,
                streaks: streaks,
                recordUpdates: nil,
                weekCelebrations: weekCelebrations
            )
            print("[DeleteActivity] Successfully removed activity and saved \(updatedActivities.count) activities")

            // Push updated data to widget
            pushDataToWidget()

            // Notify the iPhone to refresh
            if WCSession.default.isReachable {
                WCSession.default.sendMessage(["action": "activitySaved"], replyHandler: { _ in }, errorHandler: { _ in })
            }
        } catch {
            print("[DeleteActivity] FAILED: \(error.localizedDescription)")
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
        let justCompletedLifts = category == "lifting" &&
            oldProgress.lifts.completed < goals.liftsPerWeek &&
            newProgress.lifts.completed >= goals.liftsPerWeek

        let justCompletedCardio = category == "cardio" &&
            oldProgress.cardio.completed < goals.cardioPerWeek &&
            newProgress.cardio.completed >= goals.cardioPerWeek

        let justCompletedRecovery = category == "recovery" &&
            oldProgress.recovery.completed < goals.recoveryPerWeek &&
            newProgress.recovery.completed >= goals.recoveryPerWeek

        var updates: [String: Any] = [:]

        // Update individual streaks
        if justCompletedLifts {
            streaks.lifts += 1
            if streaks.lifts > (personalRecords.longestStrengthStreak ?? 0) {
                personalRecords.longestStrengthStreak = streaks.lifts
                updates["longestStrengthStreak"] = streaks.lifts
            }
        }

        if justCompletedCardio {
            streaks.cardio += 1
            if streaks.cardio > (personalRecords.longestCardioStreak ?? 0) {
                personalRecords.longestCardioStreak = streaks.cardio
                updates["longestCardioStreak"] = streaks.cardio
            }
        }

        if justCompletedRecovery {
            streaks.recovery += 1
            if streaks.recovery > (personalRecords.longestRecoveryStreak ?? 0) {
                personalRecords.longestRecoveryStreak = streaks.recovery
                updates["longestRecoveryStreak"] = streaks.recovery
            }
        }

        // Check master streak (all three goals met)
        let allGoalsMet = newProgress.allGoalsMet
        let wasAllGoalsMet = oldProgress.allGoalsMet
        var justCompletedWeek = false

        if allGoalsMet && !wasAllGoalsMet {
            streaks.master += 1
            justCompletedWeek = true
            if streaks.master > (personalRecords.longestMasterStreak ?? 0) {
                personalRecords.longestMasterStreak = streaks.master
                updates["longestMasterStreak"] = streaks.master
            }
        }

        if !updates.isEmpty {
            recordUpdates = updates
        }
        return (lifts: justCompletedLifts, cardio: justCompletedCardio, recovery: justCompletedRecovery, master: justCompletedWeek)
    }

    /// Returns the current week key (Sunday start date as "yyyy-MM-dd")
    private func currentWeekKey() -> String {
        let calendar = Calendar.current
        let today = Date()
        let weekday = calendar.component(.weekday, from: today) // 1 = Sunday
        let startOfWeek = calendar.date(byAdding: .day, value: -(weekday - 1), to: calendar.startOfDay(for: today))!
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: startOfWeek)
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

    private func checkDailyGoalCelebrations(isBackground: Bool) {
        guard goals.stepsPerDay > 0, goals.caloriesPerDay > 0 else { return }

        if todaySteps >= goals.stepsPerDay {
            celebrationManager.triggerCelebration(.steps, isBackground: isBackground)
        }
        if todayCalories >= goals.caloriesPerDay {
            celebrationManager.triggerCelebration(.calories, isBackground: isBackground)
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

    // MARK: - Push Data to Widget Complication

    private func pushDataToWidget() {
        SharedDefaults.writeStreakData(
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
            todayCalories: todayCalories
        )
        WidgetCenter.shared.reloadAllTimelines()
        print("[Widget] Pushed streak data and reloaded timelines")
    }
}
