import Foundation
import Combine
import HealthKit
import CoreLocation

// MARK: - Workout Result

struct WorkoutResult {
    var workoutUUID: String
    var startDate: Date
    var duration: Int // minutes
    var durationSeconds: TimeInterval // precise seconds for pace calculation
    var calories: Int
    var avgHr: Int
    var maxHr: Int
    var distance: Double? // miles
}

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

    // Workout metadata — set by ActiveWorkoutView at start, read by summary overlay in RootView
    @Published var summaryActivityType: String = ""
    @Published var summaryStrengthType: String? = nil
    @Published var summarySubtype: String? = nil
    @Published var summaryFocusAreas: [String]? = nil
    @Published var summaryCountToward: String? = nil

    // Heart rate zone tracking
    @Published var currentZone: HeartRateZone = .recovery
    @Published var currentZoneSeconds: Int = 0
    var estimatedMaxHR: Double = 190.0

    // Internal state
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var heartRateSamples: [Double] = []
    private var startDate: Date?
    private var workoutActivityType: HKWorkoutActivityType = .other
    private var accumulatedPauseTime: TimeInterval = 0
    private var lastPauseDate: Date?

    // Route tracking
    private var locationManager: CLLocationManager?
    private var routeBuilder: HKWorkoutRouteBuilder?
    private var isOutdoorWorkout: Bool = false

    // Timer — use a display-link style timer that reads wall-clock time
    // so elapsed time stays accurate even if watchOS throttles the timer
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

    func startWorkout(activityType: HKWorkoutActivityType, isIndoor: Bool = false) async throws {
        // If there's a stale session lingering, clean it up before starting
        if session != nil && !isActive {
            cancelWorkout()
        }
        guard !isActive else { throw WorkoutError.alreadyActive }
        guard HKHealthStore.isHealthDataAvailable() else { throw WorkoutError.healthKitNotAvailable }

        let config = HKWorkoutConfiguration()
        config.activityType = activityType
        config.locationType = isIndoor ? .indoor : WorkoutManager.locationType(for: activityType)

        // For swimming, set a default lap length
        if activityType == .swimming {
            config.swimmingLocationType = .pool
            config.lapLength = HKQuantity(unit: .yard(), doubleValue: 25)
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
        } else if activityType == .cycling {
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

        // Clear any previous result and reset metrics
        lastResult = nil
        resetMetrics()

        session.startActivity(with: now)
        try await builder.beginCollection(at: now)

        // Also try enabling distance AFTER beginCollection as a belt-and-suspenders approach
        if activityType == .walking || activityType == .running || activityType == .hiking {
            let distanceType = HKQuantityType(.distanceWalkingRunning)
            dataSource.enableCollection(for: distanceType, predicate: nil)
        } else if activityType == .cycling {
            let distanceType = HKQuantityType(.distanceCycling)
            dataSource.enableCollection(for: distanceType, predicate: nil)
        } else if activityType == .swimming {
            let distanceType = HKQuantityType(.distanceSwimming)
            dataSource.enableCollection(for: distanceType, predicate: nil)
        }

        // Log what the data source is actually collecting
        print("[WorkoutManager] typesToCollect: \(dataSource.typesToCollect.map { $0.identifier })")

        // Start GPS route collection for outdoor workouts
        let isOutdoor = !isIndoor && WorkoutManager.isOutdoorActivityType(activityType)
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
    }

    // MARK: - End Workout

    func endWorkout() async throws -> WorkoutResult {
        guard let session = session, let builder = builder, let startDate = startDate else {
            throw WorkoutError.noActiveWorkout
        }
        guard !isEnding else { throw WorkoutError.noActiveWorkout }

        // Immediately block UI interaction and stop the timer
        isEnding = true
        stopTimer()
        isPaused = false

        let endDate = Date()

        // Capture all metric values NOW, before the slow HealthKit async calls,
        // so they can't be lost if something goes wrong.
        let capturedCalories = Int(activeCalories)
        let capturedAvgHr = heartRateSamples.isEmpty ? 0 : Int(averageHeartRate)
        let capturedMaxHr = Int(maxHeartRate)
        let capturedDistance = distance / 1609.34
        let totalSeconds = endDate.timeIntervalSince(startDate)
        let totalDuration = Int(totalSeconds / 60)

        session.end()

        // These HealthKit calls can take 3-5+ seconds
        do {
            try await builder.endCollection(at: endDate)
        } catch {
            print("[WorkoutManager] endCollection error: \(error.localizedDescription)")
        }
        let workout = try await builder.finishWorkout()

        // Finalize GPS route if this was an outdoor workout
        if isOutdoorWorkout, let rb = routeBuilder, let finishedWorkout = workout {
            locationManager?.stopUpdatingLocation()
            locationManager = nil
            do {
                try await rb.finishRoute(with: finishedWorkout, metadata: nil)
            } catch {
                print("[WorkoutManager] Route finalization error: \(error.localizedDescription)")
            }
            routeBuilder = nil
        }
        isOutdoorWorkout = false

        let result = WorkoutResult(
            workoutUUID: workout?.uuid.uuidString ?? UUID().uuidString,
            startDate: startDate,
            duration: max(totalDuration, 1),
            durationSeconds: totalSeconds,
            calories: capturedCalories,
            avgHr: capturedAvgHr,
            maxHr: capturedMaxHr,
            distance: capturedDistance > 0.01 ? capturedDistance : nil
        )

        // IMPORTANT: Publish result BEFORE setting isActive = false
        // so observers see lastResult != nil when isActive transitions,
        // preventing a brief "no workout, no result" state that could
        // re-trigger startWorkout or show wrong dot count.
        self.lastResult = result
        isActive = false
        isEnding = false

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

    func pause() {
        session?.pause()
        isPaused = true
        lastPauseDate = Date()
        stopTimer()
        // Notify phone to update Live Activity
        PhoneConnectivityService.shared.notifyPhoneWorkoutPaused(true, accumulatedPauseTime: accumulatedPauseTime)
    }

    func resume() {
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

    private func startTimer() {
        // Record the reference point so we can compute elapsed on each tick
        if activeStartDate == nil {
            activeStartDate = Date()
        }

        // ~30 fps for smooth hundredths-of-second display (like Apple Workout app)
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            guard let mgr = self else { return }
            Task { @MainActor in
                guard let start = mgr.startDate else { return }
                let now = Date()
                let totalInterval = now.timeIntervalSince(start)
                let activeInterval = totalInterval - mgr.accumulatedPauseTime
                mgr.elapsedTime = max(0, activeInterval)

                // Update whole-second counter (only fires @Published when value changes)
                let newSeconds = Int(mgr.elapsedTime)
                if newSeconds != mgr.elapsedSeconds {
                    mgr.elapsedSeconds = newSeconds
                }

                // Update zone seconds from zone start date
                if let zs = mgr.zoneStartDate {
                    mgr.currentZoneSeconds = max(0, Int(now.timeIntervalSince(zs)))
                }
            }
        }
        // Ensure the timer fires even during tracking scroll
        if let timer = timer {
            RunLoop.current.add(timer, forMode: .common)
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
        Task { @MainActor in
            self.cancelWorkout()
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
                        self.averageHeartRate = self.heartRateSamples.reduce(0, +) / Double(self.heartRateSamples.count)
                        self.maxHeartRate = max(self.maxHeartRate, value)

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
                        print("[WorkoutManager] Distance update: \(value)m (\(value / 1609.34) mi)")
                        self.distance = value
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
