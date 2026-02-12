import Foundation
import Combine
import HealthKit

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
    @Published var elapsedTime: TimeInterval = 0
    /// Whole-second counter for always-on display — only publishes on second boundaries
    @Published var elapsedSeconds: Int = 0
    @Published var heartRate: Double = 0
    @Published var activeCalories: Double = 0
    @Published var distance: Double = 0 // meters
    @Published var averageHeartRate: Double = 0
    @Published var maxHeartRate: Double = 0

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

        builder.dataSource = HKLiveWorkoutDataSource(
            healthStore: healthStore,
            workoutConfiguration: config
        )

        workoutActivityType = activityType
        let now = Date()
        startDate = now

        // Reset metrics
        resetMetrics()

        session.startActivity(with: now)
        try await builder.beginCollection(at: now)

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

        let endDate = Date()
        session.end()

        try await builder.endCollection(at: endDate)
        let workout = try await builder.finishWorkout()

        stopTimer()
        isActive = false
        isPaused = false

        let totalSeconds = endDate.timeIntervalSince(startDate)
        let totalDuration = Int(totalSeconds / 60)
        let distanceMiles = distance / 1609.34

        let result = WorkoutResult(
            workoutUUID: workout?.uuid.uuidString ?? UUID().uuidString,
            startDate: startDate,
            duration: max(totalDuration, 1),
            durationSeconds: totalSeconds,
            calories: Int(activeCalories),
            avgHr: heartRateSamples.isEmpty ? 0 : Int(averageHeartRate),
            maxHr: Int(maxHeartRate),
            distance: distanceMiles > 0.01 ? distanceMiles : nil
        )

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
    }

    func resume() {
        session?.resume()
        isPaused = false
        if let pauseStart = lastPauseDate {
            accumulatedPauseTime += Date().timeIntervalSince(pauseStart)
        }
        lastPauseDate = nil
        startTimer()
    }

    // MARK: - Cancel Workout

    func cancelWorkout() {
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
