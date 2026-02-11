import Foundation
import HealthKit

// MARK: - HealthKit Service (for dashboard queries, not live workouts)

class HealthKitService {
    let healthStore = HKHealthStore()

    // MARK: - Request Authorization

    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitError.notAvailable
        }

        let workoutType = HKObjectType.workoutType()
        let heartRateType = HKQuantityType(.heartRate)
        let caloriesType = HKQuantityType(.activeEnergyBurned)
        let stepsType = HKQuantityType(.stepCount)
        let distanceWalkRunType = HKQuantityType(.distanceWalkingRunning)
        let distanceCyclingType = HKQuantityType(.distanceCycling)

        let typesToShare: Set<HKSampleType> = [workoutType]
        let typesToRead: Set<HKObjectType> = [
            workoutType, heartRateType, caloriesType, stepsType,
            distanceWalkRunType, distanceCyclingType
        ]

        try await healthStore.requestAuthorization(toShare: typesToShare, read: typesToRead)
    }

    // MARK: - Today's Steps

    func fetchTodaySteps() async throws -> Int {
        let stepsType = HKQuantityType(.stepCount)
        let predicate = HKQuery.predicateForSamples(
            withStart: startOfToday(),
            end: Date(),
            options: .strictStartDate
        )

        let result = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Int, Error>) in
            let query = HKStatisticsQuery(
                quantityType: stepsType,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum
            ) { _, statistics, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                let steps = statistics?.sumQuantity()?.doubleValue(for: .count()) ?? 0
                continuation.resume(returning: Int(steps))
            }
            healthStore.execute(query)
        }

        return result
    }

    // MARK: - Today's Calories

    func fetchTodayCalories() async throws -> Int {
        let caloriesType = HKQuantityType(.activeEnergyBurned)
        let predicate = HKQuery.predicateForSamples(
            withStart: startOfToday(),
            end: Date(),
            options: .strictStartDate
        )

        let result = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Int, Error>) in
            let query = HKStatisticsQuery(
                quantityType: caloriesType,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum
            ) { _, statistics, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                let calories = statistics?.sumQuantity()?.doubleValue(for: .kilocalorie()) ?? 0
                continuation.resume(returning: Int(calories))
            }
            healthStore.execute(query)
        }

        return result
    }

    // MARK: - Today's Distance (miles)

    func fetchTodayDistance() async throws -> Double {
        let distanceType = HKQuantityType(.distanceWalkingRunning)
        let predicate = HKQuery.predicateForSamples(
            withStart: startOfToday(),
            end: Date(),
            options: .strictStartDate
        )

        let result = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Double, Error>) in
            let query = HKStatisticsQuery(
                quantityType: distanceType,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum
            ) { _, statistics, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                let distance = statistics?.sumQuantity()?.doubleValue(for: .mile()) ?? 0
                continuation.resume(returning: distance)
            }
            healthStore.execute(query)
        }

        return result
    }

    // MARK: - Weekly Distance (miles)

    func fetchWeekDistance() async throws -> Double {
        let distanceType = HKQuantityType(.distanceWalkingRunning)
        let predicate = HKQuery.predicateForSamples(
            withStart: startOfCurrentWeek(),
            end: Date(),
            options: .strictStartDate
        )

        let result = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Double, Error>) in
            let query = HKStatisticsQuery(
                quantityType: distanceType,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum
            ) { _, statistics, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                let distance = statistics?.sumQuantity()?.doubleValue(for: .mile()) ?? 0
                continuation.resume(returning: distance)
            }
            healthStore.execute(query)
        }

        return result
    }
}

// MARK: - HealthKit Errors

enum HealthKitError: Error, LocalizedError {
    case notAvailable
    case authorizationFailed

    var errorDescription: String? {
        switch self {
        case .notAvailable: return "HealthKit not available"
        case .authorizationFailed: return "HealthKit authorization failed"
        }
    }
}
