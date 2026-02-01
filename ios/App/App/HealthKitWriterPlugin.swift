import Foundation
import Capacitor
import HealthKit

@objc(HealthKitWriterPlugin)
public class HealthKitWriterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthKitWriterPlugin"
    public let jsName = "HealthKitWriter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestWriteAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkWriteAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startLiveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endLiveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelLiveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLiveWorkoutMetrics", returnType: CAPPluginReturnPromise),
        // Legacy observer methods (keeping for backward compatibility)
        CAPPluginMethod(name: "startObservingMetrics", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopObservingMetrics", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLatestMetrics", returnType: CAPPluginReturnPromise)
    ]

    private let healthStore = HKHealthStore()

    // Live workout session
    private var workoutBuilder: HKWorkoutBuilder?
    private var liveWorkoutStartDate: Date?
    private var liveWorkoutActivityType: HKWorkoutActivityType = .other

    // Observer queries for real-time monitoring during live workout
    private var heartRateQuery: HKObserverQuery?
    private var caloriesQuery: HKObserverQuery?
    private var observerStartDate: Date?

    // Accumulated metrics during observation
    private var accumulatedCalories: Double = 0
    private var heartRateSamples: [Double] = []  // For calculating avg/max
    private var heartRateHKSamples: [HKQuantitySample] = []  // Actual samples to attach to workout
    private var lastHeartRate: Double = 0

    private let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    // Fallback formatter without fractional seconds
    private let isoFormatterNoFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    // MARK: - Authorization

    @objc func requestWriteAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit not available on this device")
            return
        }

        // Request both read and write permissions for full workout tracking
        let workoutType = HKObjectType.workoutType()
        guard let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate),
              let caloriesType = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned),
              let distanceType = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning) else {
            call.reject("Could not create HealthKit types")
            return
        }

        let typesToShare: Set<HKSampleType> = [workoutType, caloriesType, distanceType]
        let typesToRead: Set<HKObjectType> = [heartRateType, caloriesType, workoutType]

        healthStore.requestAuthorization(toShare: typesToShare, read: typesToRead) { success, error in
            DispatchQueue.main.async {
                if let error = error {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve(["authorized": success])
                }
            }
        }
    }

    @objc func checkWriteAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["authorized": false, "reason": "not_available"])
            return
        }

        let workoutType = HKObjectType.workoutType()
        let status = healthStore.authorizationStatus(for: workoutType)

        call.resolve([
            "authorized": status == .sharingAuthorized,
            "status": status.rawValue
        ])
    }

    // MARK: - Live Workout Session (New - triggers Apple Watch)

    @objc func startLiveWorkout(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit not available on this device")
            return
        }

        // Check if there's already an active workout
        if workoutBuilder != nil {
            call.reject("A workout is already in progress")
            return
        }

        guard let activityTypeString = call.getString("activityType") else {
            call.reject("Missing required parameter: activityType")
            return
        }

        let activityType = mapActivityType(activityTypeString)

        // Request authorization first
        let workoutType = HKObjectType.workoutType()
        guard let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate),
              let caloriesType = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) else {
            call.reject("Could not create HealthKit types")
            return
        }

        let typesToShare: Set<HKSampleType> = [workoutType]
        let typesToRead: Set<HKObjectType> = [heartRateType, caloriesType]

        healthStore.requestAuthorization(toShare: typesToShare, read: typesToRead) { [weak self] success, error in
            guard let self = self else { return }

            if let error = error {
                DispatchQueue.main.async {
                    call.reject(error.localizedDescription)
                }
                return
            }

            guard success else {
                DispatchQueue.main.async {
                    call.reject("Authorization denied")
                }
                return
            }

            // Create workout configuration
            let configuration = HKWorkoutConfiguration()
            configuration.activityType = activityType
            configuration.locationType = .unknown

            // Create workout builder
            let builder = HKWorkoutBuilder(healthStore: self.healthStore, configuration: configuration, device: .local())

            self.workoutBuilder = builder
            self.liveWorkoutActivityType = activityType
            self.liveWorkoutStartDate = Date()

            // Reset metrics
            self.accumulatedCalories = 0
            self.heartRateSamples = []
            self.heartRateHKSamples = []
            self.lastHeartRate = 0
            self.observerStartDate = self.liveWorkoutStartDate

            // Begin workout data collection
            builder.beginCollection(withStart: self.liveWorkoutStartDate!) { success, error in
                if !success {
                    DispatchQueue.main.async {
                        self.workoutBuilder = nil
                        self.liveWorkoutStartDate = nil
                        call.reject(error?.localizedDescription ?? "Failed to start workout collection")
                    }
                    return
                }

                // Start observing heart rate and calories
                self.startHeartRateObserver(from: self.liveWorkoutStartDate!)
                self.startCaloriesObserver(from: self.liveWorkoutStartDate!)

                DispatchQueue.main.async {
                    call.resolve([
                        "success": true,
                        "startDate": self.isoFormatter.string(from: self.liveWorkoutStartDate!),
                        "activityType": activityTypeString
                    ])
                }
            }
        }
    }

    @objc func endLiveWorkout(_ call: CAPPluginCall) {
        guard let builder = workoutBuilder, let startDate = liveWorkoutStartDate else {
            call.reject("No active workout to end")
            return
        }

        let endDate = Date()

        // Stop observer queries
        stopObserverQueries()

        // Optional: get user-provided metrics
        let userCalories = call.getDouble("calories")
        let userDistance = call.getDouble("distance") // in meters

        // End the workout collection
        builder.endCollection(withEnd: endDate) { [weak self] success, error in
            guard let self = self else { return }

            if !success {
                DispatchQueue.main.async {
                    call.reject(error?.localizedDescription ?? "Failed to end workout collection")
                }
                return
            }

            // Add samples before finishing
            var samples: [HKSample] = []

            // Use user-provided calories or accumulated calories
            let finalCalories = userCalories ?? self.accumulatedCalories
            if finalCalories > 0 {
                if let energyType = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) {
                    let energyQuantity = HKQuantity(unit: .kilocalorie(), doubleValue: finalCalories)
                    let energySample = HKQuantitySample(
                        type: energyType,
                        quantity: energyQuantity,
                        start: startDate,
                        end: endDate
                    )
                    samples.append(energySample)
                }
            }

            // Add distance if provided
            if let distance = userDistance, distance > 0 {
                if let distanceType = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning) {
                    let distanceQuantity = HKQuantity(unit: .meter(), doubleValue: distance)
                    let distanceSample = HKQuantitySample(
                        type: distanceType,
                        quantity: distanceQuantity,
                        start: startDate,
                        end: endDate
                    )
                    samples.append(distanceSample)
                }
            }

            // Add heart rate samples collected during the workout
            if !self.heartRateHKSamples.isEmpty {
                samples.append(contentsOf: self.heartRateHKSamples)
                print("HealthKitWriter: Adding \(self.heartRateHKSamples.count) heart rate samples to workout")
            }

            let finishWorkout = { [weak self] in
                guard let self = self else { return }

                builder.finishWorkout { workout, error in
                    // Calculate final metrics
                    let avgHr = self.heartRateSamples.isEmpty ? 0 : self.heartRateSamples.reduce(0, +) / Double(self.heartRateSamples.count)
                    let maxHr = self.heartRateSamples.max() ?? 0
                    let duration = endDate.timeIntervalSince(startDate) / 60.0 // in minutes

                    // Clean up
                    self.workoutBuilder = nil
                    self.liveWorkoutStartDate = nil
                    self.observerStartDate = nil

                    DispatchQueue.main.async {
                        if let workout = workout {
                            call.resolve([
                                "success": true,
                                "workoutUUID": workout.uuid.uuidString,
                                "duration": Int(round(duration)),
                                "calories": Int(round(finalCalories)),
                                "avgHr": Int(round(avgHr)),
                                "maxHr": Int(round(maxHr)),
                                "sampleCount": self.heartRateSamples.count
                            ])
                        } else {
                            call.reject(error?.localizedDescription ?? "Failed to save workout")
                        }

                        // Reset metrics
                        self.accumulatedCalories = 0
                        self.heartRateSamples = []
                        self.heartRateHKSamples = []
                        self.lastHeartRate = 0
                    }
                }
            }

            if !samples.isEmpty {
                builder.add(samples) { success, error in
                    if !success {
                        print("HealthKitWriter: Failed to add samples: \(error?.localizedDescription ?? "unknown")")
                    }
                    finishWorkout()
                }
            } else {
                finishWorkout()
            }
        }
    }

    @objc func cancelLiveWorkout(_ call: CAPPluginCall) {
        guard workoutBuilder != nil else {
            call.resolve(["success": true, "message": "No active workout to cancel"])
            return
        }

        // Stop observer queries
        stopObserverQueries()

        // Discard the workout builder without saving
        workoutBuilder?.discardWorkout()

        // Clean up
        workoutBuilder = nil
        liveWorkoutStartDate = nil
        observerStartDate = nil
        accumulatedCalories = 0
        heartRateSamples = []
        heartRateHKSamples = []
        lastHeartRate = 0

        call.resolve(["success": true])
    }

    @objc func getLiveWorkoutMetrics(_ call: CAPPluginCall) {
        guard liveWorkoutStartDate != nil else {
            call.resolve([
                "isActive": false,
                "calories": 0,
                "avgHr": 0,
                "maxHr": 0,
                "lastHr": 0,
                "sampleCount": 0
            ])
            return
        }

        let avgHr = heartRateSamples.isEmpty ? 0 : heartRateSamples.reduce(0, +) / Double(heartRateSamples.count)
        let maxHr = heartRateSamples.max() ?? 0
        let elapsed = Date().timeIntervalSince(liveWorkoutStartDate!) / 60.0

        call.resolve([
            "isActive": true,
            "elapsed": Int(round(elapsed)),
            "calories": Int(round(accumulatedCalories)),
            "avgHr": Int(round(avgHr)),
            "maxHr": Int(round(maxHr)),
            "lastHr": Int(round(lastHeartRate)),
            "sampleCount": heartRateSamples.count
        ])
    }

    // MARK: - Legacy Save Workout (for "Log Completed" flow)

    @objc func saveWorkout(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit not available on this device")
            return
        }

        // Required parameters
        guard let activityType = call.getString("activityType"),
              let startDateString = call.getString("startDate"),
              let endDateString = call.getString("endDate") else {
            call.reject("Missing required parameters: activityType, startDate, endDate")
            return
        }

        // Parse dates (try with fractional seconds first, then without)
        guard let startDate = isoFormatter.date(from: startDateString) ?? isoFormatterNoFraction.date(from: startDateString),
              let endDate = isoFormatter.date(from: endDateString) ?? isoFormatterNoFraction.date(from: endDateString) else {
            call.reject("Invalid date format. Use ISO 8601 (e.g., 2024-01-15T14:30:00.000Z)")
            return
        }

        // Validate dates
        guard endDate > startDate else {
            call.reject("End date must be after start date")
            return
        }

        // Map activity type to HKWorkoutActivityType
        let hkActivityType = mapActivityType(activityType)

        // Optional parameters
        let calories = call.getDouble("calories")
        let distance = call.getDouble("distance") // in meters

        // Create workout configuration
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = hkActivityType

        // Use HKWorkoutBuilder for iOS 12+
        let builder = HKWorkoutBuilder(healthStore: healthStore, configuration: configuration, device: nil)

        builder.beginCollection(withStart: startDate) { success, error in
            guard success else {
                DispatchQueue.main.async {
                    call.reject(error?.localizedDescription ?? "Failed to begin workout collection")
                }
                return
            }

            // Build samples array for optional data
            var samples: [HKSample] = []

            // Add energy burned if provided
            if let calories = calories, calories > 0 {
                if let energyType = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) {
                    let energyQuantity = HKQuantity(unit: .kilocalorie(), doubleValue: calories)
                    let energySample = HKQuantitySample(
                        type: energyType,
                        quantity: energyQuantity,
                        start: startDate,
                        end: endDate
                    )
                    samples.append(energySample)
                }
            }

            // Add distance if provided
            if let distance = distance, distance > 0 {
                if let distanceType = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning) {
                    let distanceQuantity = HKQuantity(unit: .meter(), doubleValue: distance)
                    let distanceSample = HKQuantitySample(
                        type: distanceType,
                        quantity: distanceQuantity,
                        start: startDate,
                        end: endDate
                    )
                    samples.append(distanceSample)
                }
            }

            // Function to finish the workout
            let finishWorkout = {
                builder.endCollection(withEnd: endDate) { success, error in
                    guard success else {
                        DispatchQueue.main.async {
                            call.reject(error?.localizedDescription ?? "Failed to end workout collection")
                        }
                        return
                    }

                    builder.finishWorkout { workout, error in
                        DispatchQueue.main.async {
                            if let workout = workout {
                                call.resolve([
                                    "success": true,
                                    "workoutUUID": workout.uuid.uuidString
                                ])
                            } else {
                                call.reject(error?.localizedDescription ?? "Failed to save workout")
                            }
                        }
                    }
                }
            }

            // Add samples if any, then finish
            if !samples.isEmpty {
                builder.add(samples) { success, error in
                    if !success {
                        print("HealthKitWriter: Failed to add samples: \(error?.localizedDescription ?? "unknown")")
                    }
                    finishWorkout()
                }
            } else {
                finishWorkout()
            }
        }
    }

    // MARK: - Legacy Observer Methods (backward compatibility)

    @objc func startObservingMetrics(_ call: CAPPluginCall) {
        // If there's a live workout, just return its metrics
        if liveWorkoutStartDate != nil {
            call.resolve([
                "success": true,
                "startDate": isoFormatter.string(from: liveWorkoutStartDate!),
                "isLiveWorkout": true
            ])
            return
        }

        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit not available on this device")
            return
        }

        guard let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate),
              let caloriesType = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) else {
            call.reject("Could not create HealthKit types")
            return
        }

        let typesToRead: Set<HKObjectType> = [heartRateType, caloriesType]

        healthStore.requestAuthorization(toShare: nil, read: typesToRead) { [weak self] success, error in
            guard let self = self else { return }

            if let error = error {
                DispatchQueue.main.async {
                    call.reject(error.localizedDescription)
                }
                return
            }

            guard success else {
                DispatchQueue.main.async {
                    call.reject("Authorization denied for reading health data")
                }
                return
            }

            self.stopObserverQueries()

            self.observerStartDate = Date()
            self.accumulatedCalories = 0
            self.heartRateSamples = []
            self.heartRateHKSamples = []
            self.lastHeartRate = 0

            self.startHeartRateObserver(from: self.observerStartDate!)
            self.startCaloriesObserver(from: self.observerStartDate!)

            DispatchQueue.main.async {
                call.resolve([
                    "success": true,
                    "startDate": self.isoFormatter.string(from: self.observerStartDate!)
                ])
            }
        }
    }

    @objc func stopObservingMetrics(_ call: CAPPluginCall) {
        stopObserverQueries()

        let avgHr = heartRateSamples.isEmpty ? 0 : heartRateSamples.reduce(0, +) / Double(heartRateSamples.count)
        let maxHr = heartRateSamples.max() ?? 0

        call.resolve([
            "success": true,
            "calories": Int(round(accumulatedCalories)),
            "avgHr": Int(round(avgHr)),
            "maxHr": Int(round(maxHr)),
            "sampleCount": heartRateSamples.count
        ])

        observerStartDate = nil
        accumulatedCalories = 0
        heartRateSamples = []
        heartRateHKSamples = []
        lastHeartRate = 0
    }

    @objc func getLatestMetrics(_ call: CAPPluginCall) {
        let avgHr = heartRateSamples.isEmpty ? 0 : heartRateSamples.reduce(0, +) / Double(heartRateSamples.count)
        let maxHr = heartRateSamples.max() ?? 0

        call.resolve([
            "calories": Int(round(accumulatedCalories)),
            "avgHr": Int(round(avgHr)),
            "maxHr": Int(round(maxHr)),
            "lastHr": Int(round(lastHeartRate)),
            "sampleCount": heartRateSamples.count,
            "isObserving": heartRateQuery != nil || caloriesQuery != nil,
            "isLiveWorkout": workoutBuilder != nil
        ])
    }

    // MARK: - Observer Query Helpers

    private func stopObserverQueries() {
        if let query = heartRateQuery {
            healthStore.stop(query)
            heartRateQuery = nil
        }
        if let query = caloriesQuery {
            healthStore.stop(query)
            caloriesQuery = nil
        }
    }

    private func startHeartRateObserver(from startDate: Date) {
        guard let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate) else { return }

        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: nil, options: .strictStartDate)

        heartRateQuery = HKObserverQuery(sampleType: heartRateType, predicate: predicate) { [weak self] query, completionHandler, error in
            guard let self = self else {
                completionHandler()
                return
            }

            if error != nil {
                completionHandler()
                return
            }

            self.fetchHeartRateSamples(from: startDate)
            completionHandler()
        }

        if let query = heartRateQuery {
            healthStore.execute(query)
            fetchHeartRateSamples(from: startDate)
        }
    }

    private func fetchHeartRateSamples(from startDate: Date) {
        guard let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate) else { return }

        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: nil, options: .strictStartDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)

        let query = HKSampleQuery(sampleType: heartRateType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sortDescriptor]) { [weak self] _, samples, error in
            guard let self = self, error == nil, let samples = samples as? [HKQuantitySample] else { return }

            let hrUnit = HKUnit.count().unitDivided(by: .minute())
            var newSamples: [Double] = []

            for sample in samples {
                let value = sample.quantity.doubleValue(for: hrUnit)
                newSamples.append(value)
            }

            if !newSamples.isEmpty {
                self.heartRateSamples = newSamples
                self.heartRateHKSamples = samples  // Store actual HK samples for workout attachment
                self.lastHeartRate = newSamples.last ?? 0

                DispatchQueue.main.async {
                    let avgHr = self.heartRateSamples.reduce(0, +) / Double(self.heartRateSamples.count)
                    let maxHr = self.heartRateSamples.max() ?? 0

                    self.notifyListeners("metricsUpdated", data: [
                        "type": "heartRate",
                        "lastHr": Int(round(self.lastHeartRate)),
                        "avgHr": Int(round(avgHr)),
                        "maxHr": Int(round(maxHr)),
                        "sampleCount": self.heartRateSamples.count
                    ])
                }
            }
        }

        healthStore.execute(query)
    }

    private func startCaloriesObserver(from startDate: Date) {
        guard let caloriesType = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) else { return }

        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: nil, options: .strictStartDate)

        caloriesQuery = HKObserverQuery(sampleType: caloriesType, predicate: predicate) { [weak self] query, completionHandler, error in
            guard let self = self else {
                completionHandler()
                return
            }

            if error != nil {
                completionHandler()
                return
            }

            self.fetchCaloriesSamples(from: startDate)
            completionHandler()
        }

        if let query = caloriesQuery {
            healthStore.execute(query)
            fetchCaloriesSamples(from: startDate)
        }
    }

    private func fetchCaloriesSamples(from startDate: Date) {
        guard let caloriesType = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) else { return }

        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: nil, options: .strictStartDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)

        let query = HKSampleQuery(sampleType: caloriesType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sortDescriptor]) { [weak self] _, samples, error in
            guard let self = self, error == nil, let samples = samples as? [HKQuantitySample] else { return }

            let kcalUnit = HKUnit.kilocalorie()
            var totalCalories: Double = 0

            for sample in samples {
                totalCalories += sample.quantity.doubleValue(for: kcalUnit)
            }

            if totalCalories > 0 {
                self.accumulatedCalories = totalCalories

                DispatchQueue.main.async {
                    self.notifyListeners("metricsUpdated", data: [
                        "type": "calories",
                        "calories": Int(round(totalCalories))
                    ])
                }
            }
        }

        healthStore.execute(query)
    }

    // MARK: - Activity Type Mapping

    private func mapActivityType(_ type: String) -> HKWorkoutActivityType {
        switch type.lowercased() {
        // Cardio
        case "running":
            return .running
        case "cycle", "cycling":
            return .cycling
        case "swimming":
            return .swimming
        case "walking":
            return .walking
        case "hiking":
            return .hiking
        case "elliptical":
            return .elliptical
        case "rowing":
            return .rowing
        case "stair climbing", "stairclimbing":
            return .stairClimbing
        case "dance":
            return .socialDance

        // Strength
        case "strength training", "lifting", "bodyweight":
            return .traditionalStrengthTraining
        case "functional strength", "functional":
            return .functionalStrengthTraining
        case "hiit", "high intensity interval training":
            return .highIntensityIntervalTraining
        case "cross training", "crosstraining":
            return .crossTraining
        case "core training", "core":
            return .coreTraining

        // Mind & Body
        case "yoga":
            return .yoga
        case "pilates":
            return .pilates
        case "flexibility":
            return .flexibility
        case "mind and body":
            return .mindAndBody

        // Sports
        case "basketball":
            return .basketball
        case "soccer":
            return .soccer
        case "football", "american football":
            return .americanFootball
        case "tennis":
            return .tennis
        case "golf":
            return .golf
        case "baseball":
            return .baseball
        case "boxing":
            return .boxing
        case "martial arts":
            return .martialArts
        case "badminton":
            return .badminton
        case "volleyball":
            return .volleyball
        case "hockey":
            return .hockey
        case "lacrosse":
            return .lacrosse
        case "rugby":
            return .rugby
        case "softball":
            return .softball
        case "squash":
            return .squash
        case "table tennis":
            return .tableTennis
        case "racquetball":
            return .racquetball
        case "handball":
            return .handball
        case "cricket":
            return .cricket

        // Other
        case "cooldown":
            return .cooldown
        case "preparation":
            return .preparationAndRecovery

        default:
            return .other
        }
    }
}
