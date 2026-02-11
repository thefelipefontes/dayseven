import Foundation
import Combine
import HealthKit

// MARK: - Workout Result

struct WorkoutResult {
    var workoutUUID: String
    var duration: Int // minutes
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
    private var timer: Timer?
    private var startDate: Date?
    private var workoutActivityType: HKWorkoutActivityType = .other
    private var accumulatedSeconds: Int = 0
    private var pauseDate: Date?

    // MARK: - Start Workout

    func startWorkout(activityType: HKWorkoutActivityType) async throws {
        guard !isActive else { throw WorkoutError.alreadyActive }
        guard HKHealthStore.isHealthDataAvailable() else { throw WorkoutError.healthKitNotAvailable }

        let config = HKWorkoutConfiguration()
        config.activityType = activityType
        config.locationType = .unknown

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
        startDate = Date()

        // Reset metrics
        resetMetrics()

        let start = startDate!
        session.startActivity(with: start)
        try await builder.beginCollection(at: start)

        isActive = true
        isPaused = false
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

        let totalDuration = Int(endDate.timeIntervalSince(startDate) / 60)
        let distanceMiles = distance / 1609.34

        let result = WorkoutResult(
            workoutUUID: workout?.uuid.uuidString ?? UUID().uuidString,
            duration: max(totalDuration, 1),
            calories: Int(activeCalories),
            avgHr: heartRateSamples.isEmpty ? 0 : Int(averageHeartRate),
            maxHr: Int(maxHeartRate),
            distance: distanceMiles > 0.01 ? distanceMiles : nil
        )

        // Clean up
        self.session = nil
        self.builder = nil
        self.startDate = nil

        return result
    }

    // MARK: - Pause / Resume

    func pause() {
        session?.pause()
        isPaused = true
        pauseDate = Date()
        stopTimer()
    }

    func resume() {
        session?.resume()
        isPaused = false
        pauseDate = nil
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
    }

    // MARK: - Timer

    private func startTimer() {
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.elapsedSeconds += 1
                self?.currentZoneSeconds += 1
            }
        }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    // MARK: - Reset

    private func resetMetrics() {
        elapsedSeconds = 0
        heartRate = 0
        activeCalories = 0
        distance = 0
        averageHeartRate = 0
        maxHeartRate = 0
        heartRateSamples = []
        accumulatedSeconds = 0
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
                            self.currentZoneSeconds = 0
                        }
                    }

                case HKQuantityType(.activeEnergyBurned):
                    if let value = statistics?.sumQuantity()?.doubleValue(for: .kilocalorie()) {
                        self.activeCalories = value
                    }

                case HKQuantityType(.distanceWalkingRunning), HKQuantityType(.distanceCycling):
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
