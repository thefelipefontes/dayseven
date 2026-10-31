import Foundation
import Combine
import HealthKit
import CoreLocation
import WatchKit

// MARK: - Workout Result

struct WorkoutResult: Equatable {
    var workoutUUID: String
    var startDate: Date
    var duration: Int // minutes
    var durationSeconds: TimeInterval // precise seconds for pace calculation
    var calories: Int
    var avgHr: Int
    var maxHr: Int
    var distance: Double? // miles
    /// The phone ended this workout, and the phone saves it (with this workoutUUID) as part of
    /// its own Finish flow. The watch summary must not save a second copy.
    var endedFromPhone: Bool = false
}

// MARK: - Workout Split

/// Per-unit split fired when the user crosses a whole-unit boundary (mile or km)
/// during a distance workout. Mirrors Apple Workout's split notification.
///
/// - `splitNumber`: 1, 2, 3, ... — index of the unit just completed.
/// - `unit`: "mi" or "km" so the overlay can render the right label without
///   re-reading the live preference (avoids label flicker if the user toggles
///   mid-workout, though that's not exposed).
/// - `splitSecondsPerUnit`: time spent on this single split (== pace per unit
///   for THIS split alone).
/// - `overallSecondsPerUnit`: pace per unit averaged across the whole workout
///   up to the moment the split fired. Lets the overlay show "right now" + "so far".
struct WorkoutSplit: Equatable, Identifiable {
    let id = UUID()
    var splitNumber: Int
    var unit: String
    var splitSecondsPerUnit: TimeInterval
    var overallSecondsPerUnit: TimeInterval
    var firedAt: Date

    static func == (lhs: WorkoutSplit, rhs: WorkoutSplit) -> Bool { lhs.id == rhs.id }
}

private let metersPerMile: Double = 1609.34
private let metersPerKm: Double = 1000.0

// MARK: - Workout Error

enum WorkoutError: Error, LocalizedError {
    case noActiveWorkout
    case alreadyActive
    case healthKitNotAvailable
    case startFailed(String)

    var errorDescription: String? {
        switch self {
        case .noActiveWorkout: return "No active workout"
        case .alreadyActive: return "A workout is already active"
        case .healthKitNotAvailable: return "HealthKit not available"
        case .startFailed(let msg): return "Failed to start: \(msg)"
        }
    }
}

// MARK: - Workout Manager

@MainActor
class WorkoutManager: NSObject, ObservableObject {
    let healthStore = HKHealthStore()

    // Published state
    @Published var isActive = false
    @Published var isPaused = false
    /// Result published when workout ends — consumed by ActiveWorkoutView to show summary
    @Published var lastResult: WorkoutResult?
    @Published var elapsedTime: TimeInterval = 0
    /// Whole-second counter for always-on display — only publishes on second boundaries
    @Published var elapsedSeconds: Int = 0
    @Published var heartRate: Double = 0
    @Published var activeCalories: Double = 0
    @Published var distance: Double = 0 // meters
    @Published var averageHeartRate: Double = 0
    @Published var maxHeartRate: Double = 0

    // Nested page index within ActiveWorkoutView (0 = controls, 1 = timer)
    // Written by ActiveWorkoutView, read by MainTabView for dot indicator
    @Published var workoutPageIndex: Int = 1

    // Set to true when summary is being dismissed (Done/Discard tapped).
    // ActiveWorkoutView uses this to show black instead of timer during nav pop.
    @Published var isDismissingSummary = false

    /// True from the moment user taps End until endWorkout() completes.
    /// Used to block UI interaction and show loading state.
    @Published var isEnding = false

    // Workout metadata — set by ActiveWorkoutView at start, read by summary overlay in RootView.
    // Saved with the running workout so a relaunch after a crash saves it as the same type.
    @Published var summaryActivityType: String = "" { didSet { saveRecoveryInfoIfActive() } }
    @Published var summaryStrengthType: String? = nil { didSet { saveRecoveryInfoIfActive() } }
    @Published var summarySubtype: String? = nil { didSet { saveRecoveryInfoIfActive() } }
    @Published var summaryFocusAreas: [String]? = nil { didSet { saveRecoveryInfoIfActive() } }
    @Published var summaryCountToward: String? = nil { didSet { saveRecoveryInfoIfActive() } }

    // Heart rate zone tracking
    @Published var currentZone: HeartRateZone = .recovery
    @Published var currentZoneSeconds: Int = 0
    var estimatedMaxHR: Double = 190.0

    /// Last mile split that crossed during the active workout. ActiveWorkoutView
    /// observes this and renders a brief overlay (Apple-style) before clearing.
    @Published var latestSplit: WorkoutSplit?

    // Distance-split bookkeeping. `lastSplitAnnounced` is the highest whole unit
    // (mile or km, depending on user pref) we've already fired a split for;
    // `lastSplitElapsedAt` is the elapsed-time at which that unit was crossed,
    // so the next split = currentElapsed - lastSplitElapsedAt.
    private var lastSplitAnnounced: Int = 0
    private var lastSplitElapsedAt: TimeInterval = 0
    /// Snapshotted at workout start from SharedDefaults so splits stay consistent
    /// for the duration even if the user toggles unit mid-workout.
    private var workoutDistanceUnit: String = "mi"

    // Internal state
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var heartRateSamples: [Double] = []
    private var startDate: Date?
    private var workoutActivityType: HKWorkoutActivityType = .other
    private var accumulatedPauseTime: TimeInterval = 0
    private var lastPauseDate: Date?

    /// When the running workout started (nil when none is running).
    var workoutStartDate: Date? { startDate }

    /// Total paused time so far, including any in-progress pause. Used so the phone
    /// app can compute elapsed locally (now - startDate - effectivePauseTime) and
    /// stay smooth like the Live Activity instead of lagging behind WCSession polls.
    var effectivePauseTime: TimeInterval {
        var total = accumulatedPauseTime
        if let pauseStart = lastPauseDate {
            total += Date().timeIntervalSince(pauseStart)
        }
        return total
    }

    // Route tracking
    private var locationManager: CLLocationManager?
    private var routeBuilder: HKWorkoutRouteBuilder?
    private var isOutdoorWorkout: Bool = false

    // Timer — reads wall-clock time so elapsed time stays accurate even if
    // watchOS throttles it. It ticks once a second; the on-screen clock's
    // hundredths come from activeElapsed(at:) in a TimelineView, which only runs
    // fast while the screen is lit.
    private var timer: Timer?
    private var activeStartDate: Date?
    private var zoneStartDate: Date?

    // MARK: - Location Type for Activity

    private static func locationType(for activityType: HKWorkoutActivityType) -> HKWorkoutSessionLocationType {
        switch activityType {
        case .running, .walking, .cycling, .hiking,
             .soccer, .basketball, .americanFootball, .tennis, .golf:
            return .outdoor
        case .swimming:
            return .indoor
        default:
            return .indoor
        }
    }

    // MARK: - Start Workout

    func startWorkout(activityType: HKWorkoutActivityType, isIndoor: Bool = false, subtype: String? = nil) async throws {
        // If there's a stale session lingering, clean it up before starting
        if session != nil && !isActive {
            cancelWorkout()
        }
        guard !isActive else { throw WorkoutError.alreadyActive }
        guard HKHealthStore.isHealthDataAvailable() else { throw WorkoutError.healthKitNotAvailable }

        // Set a fallback summary type from the HK activity type. Entry paths that
        // know more (ActiveWorkoutView, PhoneConnectivityService, etc.) can
        // overwrite right after this — but if WorkoutSummaryView ever appears
        // without those richer paths firing, autoSaveWorkout still has a
        // non-empty type to persist instead of saving a blank Activity.
        if summaryActivityType.isEmpty {
            let fallback = ActivityTypes.appActivity(for: activityType)
            summaryActivityType = fallback.type
            if summaryStrengthType == nil { summaryStrengthType = fallback.strengthType }
            if summaryCountToward == nil { summaryCountToward = fallback.countToward }
        }

        let config = HKWorkoutConfiguration()
        config.activityType = activityType
        config.locationType = isIndoor ? .indoor : WorkoutManager.locationType(for: activityType)

        // Swimming: branch on subtype.
        // Pool → indoor + .pool + 25-yd lap length so the watch can auto-count strokes/laps.
        // Open Water → outdoor + .openWater + no lap length; GPS route is started below.
        // Overrides the generic locationType set above.
        if activityType == .swimming {
            let isOpenWater = subtype?.lowercased() == "open water"
            if isOpenWater {
                config.swimmingLocationType = .openWater
                config.locationType = .outdoor
            } else {
                config.swimmingLocationType = .pool
                config.locationType = .indoor
                config.lapLength = HKQuantity(unit: .yard(), doubleValue: 25)
            }
        }

        do {
            session = try HKWorkoutSession(healthStore: healthStore, configuration: config)
            builder = session?.associatedWorkoutBuilder()
        } catch {
            throw WorkoutError.startFailed(error.localizedDescription)
        }

        guard let session = session, let builder = builder else {
            throw WorkoutError.startFailed("Failed to create session")
        }

        session.delegate = self
        builder.delegate = self

        // Use the builder's existing data source if available, otherwise create one.
        // The associatedWorkoutBuilder() may come pre-configured with a data source
        // that properly connects to watch sensors.
        let dataSource: HKLiveWorkoutDataSource
        if let existingDS = builder.dataSource {
            dataSource = existingDS
            print("[WorkoutManager] Using existing builder dataSource: \(existingDS)")
        } else {
            dataSource = HKLiveWorkoutDataSource(
                healthStore: healthStore,
                workoutConfiguration: config
            )
            builder.dataSource = dataSource
            print("[WorkoutManager] Created new dataSource: \(dataSource)")
        }

        // Enable distance collection BEFORE starting — add distance type to the data source
        // so it's ready when the session begins collecting.
        if activityType == .walking || activityType == .running || activityType == .hiking {
            let distanceType = HKQuantityType(.distanceWalkingRunning)
            dataSource.enableCollection(for: distanceType, predicate: nil)
            print("[WorkoutManager] Enabled distanceWalkingRunning, locationType: \(config.locationType.rawValue)")
        } else if activityType == .cycling && !isIndoor {
            // Indoor cycling has no distance source (no GPS, no wheel sensor), so
            // skip distance collection entirely — matches Apple Fitness, which
            // doesn't record distance for indoor rides.
            let distanceType = HKQuantityType(.distanceCycling)
            dataSource.enableCollection(for: distanceType, predicate: nil)
            print("[WorkoutManager] Enabled distanceCycling, locationType: \(config.locationType.rawValue)")
        } else if activityType == .swimming {
            let distanceType = HKQuantityType(.distanceSwimming)
            dataSource.enableCollection(for: distanceType, predicate: nil)
            print("[WorkoutManager] Enabled distanceSwimming")
        }

        workoutActivityType = activityType
        let now = Date()
        startDate = now

        // Clear any previous result and reset metrics. Saved recovery info belongs to an
        // earlier workout until this one is running.
        lastResult = nil
        resetMetrics()
        clearRecoveryInfo()

        session.startActivity(with: now)
        do {
            try await builder.beginCollection(at: now)
        } catch {
            // The session is already running. Left alone it kept running with nothing on
            // screen to end it (isActive never turned true), holding the heart-rate sensor.
            print("[WorkoutManager] beginCollection failed — ending the session: \(error.localizedDescription)")
            session.end()
            builder.discardWorkout()
            self.session = nil
            self.builder = nil
            startDate = nil
            throw WorkoutError.startFailed(error.localizedDescription)
        }

        // Also try enabling distance AFTER beginCollection as a belt-and-suspenders approach
        if activityType == .walking || activityType == .running || activityType == .hiking {
            let distanceType = HKQuantityType(.distanceWalkingRunning)
            dataSource.enableCollection(for: distanceType, predicate: nil)
        } else if activityType == .cycling && !isIndoor {
            let distanceType = HKQuantityType(.distanceCycling)
            dataSource.enableCollection(for: distanceType, predicate: nil)
        } else if activityType == .swimming {
            let distanceType = HKQuantityType(.distanceSwimming)
            dataSource.enableCollection(for: distanceType, predicate: nil)
        }

        // Log what the data source is actually collecting
        print("[WorkoutManager] typesToCollect: \(dataSource.typesToCollect.map { $0.identifier })")

        // Start GPS route collection for outdoor workouts.
        // Swimming is a special case: GPS only for Open Water (pool swims have no GPS need
        // and the watch is underwater anyway).
        let isOpenWaterSwim = activityType == .swimming && subtype?.lowercased() == "open water"
        let isOutdoor = !isIndoor && (WorkoutManager.isOutdoorActivityType(activityType) || isOpenWaterSwim)
        isOutdoorWorkout = isOutdoor
        if isOutdoor {
            routeBuilder = HKWorkoutRouteBuilder(healthStore: healthStore, device: .local())
            startLocationCollection()
        }

        isActive = true
        isPaused = false
        activeStartDate = now
        zoneStartDate = now
        startTimer()
        saveRecoveryInfoIfActive()
    }

    // MARK: - Crash Recovery

    /// What the app knows about the running workout that HealthKit doesn't keep: how
    /// DaySeven will save it, and whether it tracks a route. Written while a workout runs,
    /// read back when watchOS relaunches the app after a crash to hand the session back.
    private struct RecoveryInfo: Codable {
        var activityType: String
        var strengthType: String?
        var subtype: String?
        var focusAreas: [String]?
        var countToward: String?
        var isOutdoor: Bool
        var distanceUnit: String
    }

    private static let recoveryInfoKey = "activeWorkoutRecoveryInfo"

    private func saveRecoveryInfoIfActive() {
        guard isActive, session != nil else { return }
        let info = RecoveryInfo(
            activityType: summaryActivityType,
            strengthType: summaryStrengthType,
            subtype: summarySubtype,
            focusAreas: summaryFocusAreas,
            countToward: summaryCountToward,
            isOutdoor: isOutdoorWorkout,
            distanceUnit: workoutDistanceUnit
        )
        if let data = try? JSONEncoder().encode(info) {
            UserDefaults.standard.set(data, forKey: Self.recoveryInfoKey)
        }
    }

    private func clearRecoveryInfo() {
        UserDefaults.standard.removeObject(forKey: Self.recoveryInfoKey)
    }

    private func loadRecoveryInfo() -> RecoveryInfo? {
        guard let data = UserDefaults.standard.data(forKey: Self.recoveryInfoKey) else { return nil }
        return try? JSONDecoder().decode(RecoveryInfo.self, from: data)
    }

    /// A session watchOS handed back before the app had built its WorkoutManager (the
    /// view model is created with the first scene). The first manager to exist adopts it.
    static var recoveredSessionAwaitingManager: HKWorkoutSession?

    /// Takes over a session recovered before this manager existed, if there is one.
    func adoptRecoveredSessionIfAny() {
        guard let recovered = Self.recoveredSessionAwaitingManager else { return }
        Self.recoveredSessionAwaitingManager = nil
        Task { await recoverWorkout(recovered) }
    }

    /// Re-attaches to the workout session that was running when the app died. watchOS keeps
    /// the session and its builder's data alive across the crash; the app only has to take
    /// them back, give the builder a new data source and rebuild its own state from them.
    func recoverWorkout(_ recovered: HKWorkoutSession) async {
        guard !isActive, session == nil else {
            print("[WorkoutManager] Recovery skipped — a workout is already running here")
            return
        }
        let recoveredBuilder = recovered.associatedWorkoutBuilder()
        let info = loadRecoveryInfo()
        print("[WorkoutManager] Recovering workout: state \(recovered.state.rawValue), builder start \(recoveredBuilder.startDate.map { "\($0)" } ?? "none"), saved info \(info != nil)")

        // Collection never began (the app died between startActivity and beginCollection),
        // so there is nothing to save. End it rather than leave it running unseen.
        guard let start = recoveredBuilder.startDate else {
            recovered.end()
            recoveredBuilder.discardWorkout()
            clearRecoveryInfo()
            return
        }

        session = recovered
        builder = recoveredBuilder
        recovered.delegate = self
        recoveredBuilder.delegate = self

        // The builder comes back without a data source, and without one it stops collecting.
        let config = recovered.workoutConfiguration
        let dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: config)
        switch config.activityType {
        case .walking, .running, .hiking:
            dataSource.enableCollection(for: HKQuantityType(.distanceWalkingRunning), predicate: nil)
        case .cycling where config.locationType != .indoor:
            dataSource.enableCollection(for: HKQuantityType(.distanceCycling), predicate: nil)
        case .swimming:
            dataSource.enableCollection(for: HKQuantityType(.distanceSwimming), predicate: nil)
        default:
            break
        }
        recoveredBuilder.dataSource = dataSource

        workoutActivityType = config.activityType
        startDate = start
        lastResult = nil
        resetMetrics()

        let fallback = ActivityTypes.appActivity(for: config.activityType)
        summaryActivityType = info?.activityType ?? fallback.type
        summaryStrengthType = info?.strengthType ?? fallback.strengthType
        summarySubtype = info?.subtype
        summaryFocusAreas = info?.focusAreas
        summaryCountToward = info?.countToward ?? fallback.countToward
        if let unit = info?.distanceUnit { workoutDistanceUnit = unit }

        // Everything collected before the crash is still in the builder
        let now = Date()
        let hrUnit = HKUnit.count().unitDivided(by: .minute())
        let hrStats = recoveredBuilder.statistics(for: HKQuantityType(.heartRate))
        heartRate = hrStats?.mostRecentQuantity()?.doubleValue(for: hrUnit) ?? 0
        averageHeartRate = hrStats?.averageQuantity()?.doubleValue(for: hrUnit) ?? 0
        maxHeartRate = hrStats?.maximumQuantity()?.doubleValue(for: hrUnit) ?? 0
        activeCalories = recoveredBuilder.statistics(for: HKQuantityType(.activeEnergyBurned))?
            .sumQuantity()?.doubleValue(for: .kilocalorie()) ?? 0
        for type in [HKQuantityType(.distanceWalkingRunning), HKQuantityType(.distanceCycling), HKQuantityType(.distanceSwimming)] {
            if let meters = recoveredBuilder.statistics(for: type)?.sumQuantity()?.doubleValue(for: .meter()), meters > 0 {
                distance = meters
            }
        }
        // Splits already passed were announced before the crash
        let metersPerUnit = workoutDistanceUnit == "km" ? metersPerKm : metersPerMile
        lastSplitAnnounced = Int((distance / metersPerUnit).rounded(.down))

        // The builder's elapsed time already leaves out paused time. Whatever else has passed
        // since the start was paused; a pause still going counts up to now, and resume() or
        // endWorkout() adds the rest from lastPauseDate.
        let activeSeconds = recoveredBuilder.elapsedTime(at: now)
        accumulatedPauseTime = max(0, now.timeIntervalSince(start) - activeSeconds)
        elapsedTime = activeSeconds
        elapsedSeconds = Int(activeSeconds)
        lastSplitElapsedAt = activeSeconds
        activeStartDate = now
        zoneStartDate = now

        // The route recorded before the crash is lost with the old route builder. A new one
        // keeps the rest of the route.
        if info?.isOutdoor == true {
            isOutdoorWorkout = true
            routeBuilder = HKWorkoutRouteBuilder(healthStore: healthStore, device: .local())
            startLocationCollection()
        }

        isActive = true
        if recovered.state == .paused {
            isPaused = true
            lastPauseDate = now
        } else {
            isPaused = false
            startTimer()
        }
        saveRecoveryInfoIfActive()
        print("[WorkoutManager] Recovered \(summaryActivityType): \(Int(activeSeconds))s active, paused \(isPaused)")

        // A session that had already been stopped only needs finishing. Ending it here
        // publishes the result, and the summary saves it like any other workout.
        if recovered.state == .stopped || recovered.state == .ended {
            do {
                _ = try await endWorkout()
            } catch {
                print("[WorkoutManager] Could not finish the recovered workout: \(error.localizedDescription)")
                cancelWorkout()
            }
        }
    }

    // MARK: - End Workout

    func endWorkout(endedFromPhone: Bool = false) async throws -> WorkoutResult {
        guard let session = session, let builder = builder, let startDate = startDate else {
            throw WorkoutError.noActiveWorkout
        }
        guard !isEnding else { throw WorkoutError.noActiveWorkout }

        // Immediately block UI interaction and stop the timer
        isEnding = true
        stopTimer()

        let endDate = Date()

        // If user ended while paused, close out the in-progress pause interval
        // so it's included in accumulatedPauseTime below, and resume the HealthKit
        // session before ending it. Without the resume, session.end() on a paused
        // session can leave the workout in a state where finishRoute(with:) fails
        // and the GPS route is lost.
        let wasPaused = isPaused
        if let pauseStart = lastPauseDate {
            accumulatedPauseTime += endDate.timeIntervalSince(pauseStart)
            lastPauseDate = nil
        }
        if wasPaused {
            session.resume()
        }
        isPaused = false

        // Capture all metric values NOW, before the slow HealthKit async calls,
        // so they can't be lost if something goes wrong.
        let capturedCalories = Int(activeCalories)
        let capturedAvgHr = Int(averageHeartRate)
        let capturedMaxHr = Int(maxHeartRate)
        let capturedDistance = distance / 1609.34
        // Active time only — exclude paused intervals so pace and total time
        // reflect actual effort, not wall-clock time.
        let activeSeconds = max(0, endDate.timeIntervalSince(startDate) - accumulatedPauseTime)
        let totalDuration = Int(activeSeconds / 60)

        session.end()

        // These HealthKit calls can take 3-5+ seconds
        do {
            try await builder.endCollection(at: endDate)
        } catch {
            print("[WorkoutManager] endCollection error: \(error.localizedDescription)")
        }
        // Nothing after `isEnding = true` may throw. A finishWorkout throw used to escape
        // here with isEnding and isActive still set: End stuck on "Saving..." for good, no
        // summary, and the workout never reached DaySeven. If HealthKit can't store it, keep
        // going with the metrics captured above so it is at least saved here.
        var workout: HKWorkout?
        do {
            workout = try await builder.finishWorkout()
        } catch {
            print("[WorkoutManager] finishWorkout error — saving from captured metrics: \(error.localizedDescription)")
        }

        // Stop GPS, and finalize the route if this was an outdoor workout HealthKit stored
        locationManager?.stopUpdatingLocation()
        locationManager = nil
        if isOutdoorWorkout, let rb = routeBuilder, let finishedWorkout = workout {
            do {
                try await rb.finishRoute(with: finishedWorkout, metadata: nil)
            } catch {
                print("[WorkoutManager] Route finalization error: \(error.localizedDescription)")
            }
        }
        routeBuilder = nil
        isOutdoorWorkout = false

        let result = WorkoutResult(
            workoutUUID: workout?.uuid.uuidString ?? UUID().uuidString,
            startDate: startDate,
            duration: max(totalDuration, 1),
            durationSeconds: activeSeconds,
            calories: capturedCalories,
            avgHr: capturedAvgHr,
            maxHr: capturedMaxHr,
            distance: capturedDistance > 0.01 ? capturedDistance : nil,
            endedFromPhone: endedFromPhone
        )

        // IMPORTANT: Publish result BEFORE setting isActive = false
        // so observers see lastResult != nil when isActive transitions,
        // preventing a brief "no workout, no result" state that could
        // re-trigger startWorkout or show wrong dot count.
        self.lastResult = result
        isActive = false
        isEnding = false
        clearRecoveryInfo()

        // Clean up
        self.session = nil
        self.builder = nil
        self.startDate = nil
        self.activeStartDate = nil
        self.zoneStartDate = nil
        self.lastPauseDate = nil

        return result
    }

    // MARK: - Pause / Resume

    // Both are no-ops unless they change the state. The phone's sendMessage handlers call
    // them without checking, and a second pause restarted lastPauseDate, dropping every
    // paused second so far from accumulatedPauseTime (that time then counted as active).
    // A stray resume started a second 30fps timer next to the running one.

    func pause() {
        guard isActive, !isPaused, !isEnding else { return }
        session?.pause()
        isPaused = true
        lastPauseDate = Date()
        stopTimer()
        updateElapsed()
        // Notify phone to update Live Activity
        PhoneConnectivityService.shared.notifyPhoneWorkoutPaused(true, accumulatedPauseTime: accumulatedPauseTime)
    }

    func resume() {
        guard isActive, isPaused, !isEnding else { return }
        session?.resume()
        isPaused = false
        if let pauseStart = lastPauseDate {
            accumulatedPauseTime += Date().timeIntervalSince(pauseStart)
        }
        lastPauseDate = nil
        startTimer()
        // Notify phone to update Live Activity with accumulated pause time
        PhoneConnectivityService.shared.notifyPhoneWorkoutPaused(false, accumulatedPauseTime: accumulatedPauseTime)
    }

    // MARK: - Cancel Workout

    func cancelWorkout() {
        // Don't cancel while endWorkout() is in progress — that would zero out metrics
        guard !isEnding else {
            print("[WorkoutManager] cancelWorkout ignored — endWorkout in progress")
            return
        }
        locationManager?.stopUpdatingLocation()
        locationManager = nil
        routeBuilder = nil
        isOutdoorWorkout = false
        session?.end()
        builder?.discardWorkout()
        stopTimer()
        resetMetrics()
        isActive = false
        isPaused = false
        session = nil
        builder = nil
        activeStartDate = nil
        zoneStartDate = nil
        lastPauseDate = nil
        clearRecoveryInfo()
        // Clear summary metadata
        summaryActivityType = ""
        summaryStrengthType = nil
        summarySubtype = nil
        summaryFocusAreas = nil
        summaryCountToward = nil
        workoutPageIndex = 1
        isDismissingSummary = false
    }

    // MARK: - Timer
    // Uses wall-clock difference so elapsed time is always accurate,
    // even if watchOS throttles the timer frequency.
    //
    // It used to tick 30 times a second for the hundredths on the clock, for the whole
    // workout: screen dimmed, wrist down, app in the background. Every tick published
    // elapsedTime, so SwiftUI re-diffed the workout screen at 30Hz for an hour-long run
    // nobody was looking at. Now it ticks once a second (zone time, the phone's metrics,
    // splits) and the clock draws itself from activeElapsed(at:).

    /// Active (unpaused) time at `date`. Freezes while paused, because the pause in
    /// progress counts as paused time up to `date`.
    func activeElapsed(at date: Date) -> TimeInterval {
        guard let start = startDate else { return elapsedTime }
        var paused = accumulatedPauseTime
        if let pauseStart = lastPauseDate {
            paused += max(0, date.timeIntervalSince(pauseStart))
        }
        return max(0, date.timeIntervalSince(start) - paused)
    }

    private func startTimer() {
        // Never leave a running timer behind: it would keep firing unreferenced
        timer?.invalidate()

        // Record the reference point so we can compute elapsed on each tick
        if activeStartDate == nil {
            activeStartDate = Date()
        }

        updateElapsed()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let mgr = self else { return }
            Task { @MainActor in
                mgr.updateElapsed()
            }
        }
        // Ensure the timer fires even during tracking scroll
        if let timer = timer {
            RunLoop.current.add(timer, forMode: .common)
        }
    }

    private func updateElapsed() {
        guard startDate != nil else { return }
        let now = Date()
        elapsedTime = activeElapsed(at: now)

        // Update whole-second counter (only fires @Published when value changes)
        let newSeconds = Int(elapsedTime)
        if newSeconds != elapsedSeconds {
            elapsedSeconds = newSeconds
        }

        // Update zone seconds from zone start date
        if let zs = zoneStartDate {
            currentZoneSeconds = max(0, Int(now.timeIntervalSince(zs)))
        }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    // MARK: - GPS Route Helpers

    private static func isOutdoorActivityType(_ type: HKWorkoutActivityType) -> Bool {
        switch type {
        case .running, .walking, .cycling, .hiking,
             .soccer, .basketball, .americanFootball, .tennis, .golf:
            return true
        default:
            return false
        }
    }

    /// Whether this activity relies on GPS to record distance. Used by the
    /// start-workout pre-flight check on the watch so we can warn the user if
    /// they've denied location auth — distance would silently be 0 otherwise.
    /// Mirrors the isOutdoor logic in startWorkout but exposed for callers.
    static func needsLocationForDistance(activityType: HKWorkoutActivityType, isIndoor: Bool, subtype: String?) -> Bool {
        if activityType == .swimming {
            return subtype?.lowercased() == "open water"
        }
        return !isIndoor && isOutdoorActivityType(activityType)
    }

    /// Whether the user has explicitly denied or had location restricted for
    /// the watch app. Returns false for .notDetermined (the system prompt will
    /// fire naturally when startLocationCollection() runs) and for granted
    /// statuses.
    static func isLocationAuthDenied() -> Bool {
        let status = CLLocationManager().authorizationStatus
        return status == .denied || status == .restricted
    }

    private func startLocationCollection() {
        locationManager = CLLocationManager()
        locationManager?.delegate = self
        locationManager?.desiredAccuracy = kCLLocationAccuracyBest
        locationManager?.distanceFilter = kCLDistanceFilterNone
        locationManager?.requestWhenInUseAuthorization()
        locationManager?.startUpdatingLocation()
    }

    // MARK: - Reset

    private func resetMetrics() {
        elapsedTime = 0
        elapsedSeconds = 0
        heartRate = 0
        activeCalories = 0
        distance = 0
        averageHeartRate = 0
        maxHeartRate = 0
        heartRateSamples = []
        accumulatedPauseTime = 0
        currentZone = .recovery
        currentZoneSeconds = 0
        latestSplit = nil
        lastSplitAnnounced = 0
        lastSplitElapsedAt = 0
        // Snapshot the user's preferred unit so splits stay consistent for the
        // life of this workout even if the phone toggles km mid-run.
        workoutDistanceUnit = SharedDefaults.readDistanceUnit()
    }

    // MARK: - Distance Splits

    /// Called whenever HealthKit reports a new cumulative distance value. If the
    /// user has crossed one or more whole-unit boundaries (mile or km, per their
    /// preference) since the last update, fires a split for the most recent one.
    /// Multi-unit jumps in a single update are rare (only on long stat coalesces)
    /// — we collapse them to the highest unit so we don't spam haptics.
    private func checkMileSplit(distanceMeters: Double) {
        let unit = workoutDistanceUnit
        let metersPerUnit = unit == "km" ? metersPerKm : metersPerMile
        let totalUnits = distanceMeters / metersPerUnit
        let crossed = Int(totalUnits.rounded(.down))
        guard crossed > lastSplitAnnounced else { return }

        // Exact, not the once-a-second elapsedTime
        let elapsedNow = activeElapsed(at: Date())
        let splitSeconds = elapsedNow - lastSplitElapsedAt
        // Guard against zero/negative splits from clock drift or coalesced updates.
        guard splitSeconds > 0 else {
            lastSplitAnnounced = crossed
            lastSplitElapsedAt = elapsedNow
            return
        }

        // Overall pace at this moment: total elapsed / total units covered.
        // Falls back to the split pace itself if we're somehow at zero units
        // (shouldn't happen because crossed >= 1 by the guard above).
        let overallSecondsPerUnit = totalUnits > 0 ? elapsedNow / totalUnits : splitSeconds

        let split = WorkoutSplit(
            splitNumber: crossed,
            unit: unit,
            splitSecondsPerUnit: splitSeconds, // one-unit split: split time == pace per unit
            overallSecondsPerUnit: overallSecondsPerUnit,
            firedAt: Date()
        )
        latestSplit = split
        lastSplitAnnounced = crossed
        lastSplitElapsedAt = elapsedNow

        // Apple's split haptic is a short distinct ping — `.notification` is the
        // closest single-shot match in the WatchKit catalog.
        WKInterfaceDevice.current().play(.notification)
    }
}

// MARK: - HKWorkoutSessionDelegate

extension WorkoutManager: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {
        // Handle state changes if needed
    }

    nonisolated func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didFailWithError error: Error
    ) {
        let failedSession = ObjectIdentifier(workoutSession)
        let reason = error.localizedDescription
        Task { @MainActor in
            print("[WorkoutManager] Workout session failed: \(reason)")
            guard self.session.map(ObjectIdentifier.init) == failedSession,
                  self.isActive, !self.isEnding else { return }
            // End it instead of discarding it. cancelWorkout() threw away everything the
            // user had done so far; ending publishes the result, and the summary saves it.
            do {
                _ = try await self.endWorkout()
            } catch {
                self.cancelWorkout()
            }
        }
    }
}

// MARK: - HKLiveWorkoutBuilderDelegate

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilder(
        _ workoutBuilder: HKLiveWorkoutBuilder,
        didCollectDataOf collectedTypes: Set<HKSampleType>
    ) {
        for type in collectedTypes {
            guard let quantityType = type as? HKQuantityType else { continue }

            let statistics = workoutBuilder.statistics(for: quantityType)

            Task { @MainActor in
                switch quantityType {
                case HKQuantityType(.heartRate):
                    let hrUnit = HKUnit.count().unitDivided(by: .minute())
                    if let value = statistics?.mostRecentQuantity()?.doubleValue(for: hrUnit) {
                        self.heartRate = value
                        self.heartRateSamples.append(value)
                        // The builder's average covers the whole workout, including samples
                        // from before a crash recovery that heartRateSamples never saw.
                        self.averageHeartRate = statistics?.averageQuantity()?.doubleValue(for: hrUnit)
                            ?? self.heartRateSamples.reduce(0, +) / Double(self.heartRateSamples.count)
                        self.maxHeartRate = max(self.maxHeartRate, statistics?.maximumQuantity()?.doubleValue(for: hrUnit) ?? value)

                        // Update heart rate zone
                        let newZone = HeartRateZone.zone(for: value, maxHR: self.estimatedMaxHR)
                        if newZone != self.currentZone {
                            self.currentZone = newZone
                            self.zoneStartDate = Date()
                            self.currentZoneSeconds = 0
                        }
                    }

                case HKQuantityType(.activeEnergyBurned):
                    if let value = statistics?.sumQuantity()?.doubleValue(for: .kilocalorie()) {
                        self.activeCalories = value
                    }

                case HKQuantityType(.distanceWalkingRunning),
                     HKQuantityType(.distanceCycling),
                     HKQuantityType(.distanceSwimming):
                    if let value = statistics?.sumQuantity()?.doubleValue(for: .meter()) {
                        print("[WorkoutManager] Distance update: \(value)m (\(value / metersPerMile) mi)")
                        self.distance = value
                        self.checkMileSplit(distanceMeters: value)
                    }

                default:
                    break
                }
            }
        }
    }

    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {
        // Handle workout events if needed
    }
}

// MARK: - CLLocationManagerDelegate

extension WorkoutManager: CLLocationManagerDelegate {
    nonisolated func locationManager(
        _ manager: CLLocationManager,
        didUpdateLocations locations: [CLLocation]
    ) {
        guard !locations.isEmpty else { return }
        // Filter out locations with poor accuracy (>50m horizontal uncertainty)
        let filtered = locations.filter { $0.horizontalAccuracy > 0 && $0.horizontalAccuracy < 50 }
        guard !filtered.isEmpty else { return }

        Task { @MainActor in
            // Skip insertion while paused. Otherwise a dense cluster of stationary
            // points lands inside the workout's paused interval, which makes
            // finishRoute(with:) reject the whole route — users report losing
            // the entire route polyline after any pause/resume cycle.
            guard !self.isPaused else { return }
            do {
                try await self.routeBuilder?.insertRouteData(filtered)
            } catch {
                print("[WorkoutManager] insertRouteData error: \(error.localizedDescription)")
            }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        if status == .authorizedWhenInUse || status == .authorizedAlways {
            manager.startUpdatingLocation()
        } else if status != .notDetermined {
            // Location denied — silently degrade, workout continues without GPS
            print("[WorkoutManager] Location authorization denied: \(status.rawValue)")
            Task { @MainActor in
                self.locationManager = nil
                self.routeBuilder = nil
                self.isOutdoorWorkout = false
            }
        }
    }
}
