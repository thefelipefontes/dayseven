import Foundation
@preconcurrency import Capacitor
import HealthKit
import WatchConnectivity
import UserNotifications
import WidgetKit
import ActivityKit

@objc(HealthKitWriterPlugin)
public class HealthKitWriterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthKitWriterPlugin"
    public let jsName = "HealthKitWriter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestReadAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestWriteAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkWriteAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startLiveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endLiveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelLiveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLiveWorkoutMetrics", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryHeartRate", returnType: CAPPluginReturnPromise),
        // Watch workout control methods
        CAPPluginMethod(name: "startWatchWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endWatchWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pauseWatchWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resumeWatchWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getWatchWorkoutMetrics", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelWatchWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isWatchReachable", returnType: CAPPluginReturnPromise),
        // Notify watch to refresh data (e.g., after phone deletes an activity)
        CAPPluginMethod(name: "notifyWatchDataChanged", returnType: CAPPluginReturnPromise),
        // Legacy observer methods (keeping for backward compatibility)
        CAPPluginMethod(name: "startObservingMetrics", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopObservingMetrics", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLatestMetrics", returnType: CAPPluginReturnPromise),
        // Resolve raw HKWorkoutActivityType numbers to human-readable names
        CAPPluginMethod(name: "resolveWorkoutTypes", returnType: CAPPluginReturnPromise),
        // GPS route query
        CAPPluginMethod(name: "getWorkoutRoute", returnType: CAPPluginReturnPromise),
        // Widget data
        CAPPluginMethod(name: "updateWidgetData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateLiveActivityState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startWatchWorkoutLiveActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endAllLiveActivities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkActiveLiveActivity", returnType: CAPPluginReturnPromise)
    ]

    private let healthStore = HKHealthStore()
    // Retain active route queries to prevent premature deallocation
    private var activeRouteQueries: [HKWorkoutRouteQuery] = []

    // MARK: - Plugin Lifecycle

    override public func load() {
        // Listen for watch workout notifications from WatchSessionManager
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleWatchWorkoutStarted(_:)),
            name: .watchWorkoutStarted,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleWatchWorkoutEnded(_:)),
            name: .watchWorkoutEnded,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleWatchActivitySaved),
            name: .watchActivitySaved,
            object: nil
        )

        // Start background workout detection for local push notifications
        setupWorkoutBackgroundDelivery()
    }

    @objc private func handleWatchActivitySaved() {
        print("[HealthKitWriter] Watch activity saved — notifying JS")
        notifyListeners("watchActivitySaved", data: [:])
    }

    @objc private func handleWatchWorkoutStarted(_ notification: Notification) {
        let activityType = notification.userInfo?["activityType"] as? String ?? "Other"
        let strengthType = notification.userInfo?["strengthType"] as? String
        var data: [String: Any] = [
            "activityType": activityType,
            "startTime": ISO8601DateFormatter().string(from: Date())
        ]
        if let strengthType = strengthType {
            data["strengthType"] = strengthType
        }
        notifyListeners("watchWorkoutStarted", data: data)
        // Live Activity is started by WatchSessionManager directly
    }

    @objc private func handleWatchWorkoutEnded(_ notification: Notification) {
        notifyListeners("watchWorkoutEnded", data: [:])
        // Live Activity is ended by WatchSessionManager directly
    }

    // Live workout session
    private var workoutBuilder: HKWorkoutBuilder?
    private var liveWorkoutStartDate: Date?
    private var liveWorkoutActivityType: HKWorkoutActivityType = .other

    // Observer queries for real-time monitoring during live workout
    private var heartRateQuery: HKObserverQuery?
    private var caloriesQuery: HKObserverQuery?
    private var distanceQuery: HKObserverQuery?
    private var observerStartDate: Date?

    // Background workout detection
    private var workoutObserverQuery: HKObserverQuery?
    private static let lastWorkoutCheckKey = "dayseven_lastWorkoutNotificationCheck"
    private static let workoutNotificationId = "dayseven-workout-detected"

    // Accumulated metrics during observation
    private var accumulatedCalories: Double = 0
    private var accumulatedDistance: Double = 0  // in meters
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

    deinit {
        stopObserverQueries()
        if let query = workoutObserverQuery {
            healthStore.stop(query)
            workoutObserverQuery = nil
        }
    }

    // MARK: - Background Workout Detection

    private func setupWorkoutBackgroundDelivery() {
        guard HKHealthStore.isHealthDataAvailable() else {
            print("[HealthKitWriter] HealthKit not available, skipping background workout setup")
            return
        }

        let workoutType = HKWorkoutType.workoutType()

        // Create observer query — fires whenever any workout is saved to HealthKit
        workoutObserverQuery = HKObserverQuery(
            sampleType: workoutType,
            predicate: nil
        ) { [weak self] _, completionHandler, error in
            guard let self = self else {
                completionHandler()
                return
            }

            if let error = error {
                print("[HealthKitWriter] Workout observer error: \(error.localizedDescription)")
                completionHandler()
                return
            }

            print("[HealthKitWriter] Workout observer fired")
            self.checkForNewWorkouts {
                completionHandler()
            }
        }

        if let query = workoutObserverQuery {
            healthStore.execute(query)
            print("[HealthKitWriter] Workout observer query started")
        }

        // Enable background delivery so iOS wakes the app when workouts are saved
        healthStore.enableBackgroundDelivery(
            for: workoutType,
            frequency: .immediate
        ) { success, error in
            if let error = error {
                print("[HealthKitWriter] Failed to enable background delivery: \(error.localizedDescription)")
            } else {
                print("[HealthKitWriter] Background delivery for workouts enabled: \(success)")
            }
        }
    }

    private func checkForNewWorkouts(completion: @escaping () -> Void) {
        // Check app state on main thread — only notify if app is NOT in the foreground
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                completion()
                return
            }

            let state = UIApplication.shared.applicationState
            guard state != .active else {
                print("[HealthKitWriter] App is active, skipping notification (in-app banner handles this)")
                completion()
                return
            }

            self.queryAndNotifyNewWorkouts(completion: completion)
        }
    }

    private func queryAndNotifyNewWorkouts(completion: @escaping () -> Void) {
        let workoutType = HKWorkoutType.workoutType()
        let defaults = UserDefaults.standard

        // Start date: last check time, or 7 days ago as fallback
        let lastCheck: Date
        if let stored = defaults.object(forKey: Self.lastWorkoutCheckKey) as? Date {
            lastCheck = stored
        } else {
            lastCheck = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
        }

        let predicate = HKQuery.predicateForSamples(
            withStart: lastCheck,
            end: nil,
            options: .strictStartDate
        )
        let sortDescriptor = NSSortDescriptor(
            key: HKSampleSortIdentifierEndDate,
            ascending: false
        )

        let query = HKSampleQuery(
            sampleType: workoutType,
            predicate: predicate,
            limit: 20,
            sortDescriptors: [sortDescriptor]
        ) { [weak self] _, samples, error in
            guard let self = self else {
                completion()
                return
            }

            if let error = error {
                print("[HealthKitWriter] Workout query error: \(error.localizedDescription)")
                completion()
                return
            }

            guard let workouts = samples as? [HKWorkout], !workouts.isEmpty else {
                print("[HealthKitWriter] No new workouts found")
                completion()
                return
            }

            // Filter out workouts created by DaySeven (matches JS-side source filter)
            let externalWorkouts = workouts.filter { workout in
                let sourceName = workout.sourceRevision.source.name.lowercased()
                let bundleId = workout.sourceRevision.source.bundleIdentifier.lowercased()
                return !sourceName.contains("dayseven") && !bundleId.contains("dayseven")
            }

            guard !externalWorkouts.isEmpty else {
                print("[HealthKitWriter] All new workouts are from DaySeven, skipping notification")
                defaults.set(Date(), forKey: Self.lastWorkoutCheckKey)
                completion()
                return
            }

            print("[HealthKitWriter] Found \(externalWorkouts.count) new external workout(s)")

            // Update timestamp so we don't re-notify about these
            defaults.set(Date(), forKey: Self.lastWorkoutCheckKey)

            // Schedule local push notification
            self.scheduleWorkoutNotification(count: externalWorkouts.count)
            completion()
        }

        healthStore.execute(query)
    }

    private func scheduleWorkoutNotification(count: Int) {
        let content = UNMutableNotificationContent()
        content.title = "New Workout Detected"
        if count == 1 {
            content.body = "A new workout was saved to Apple Health. Open DaySeven to import it."
        } else {
            content.body = "\(count) new workouts were saved to Apple Health. Open DaySeven to import them."
        }
        content.sound = .default

        // Fixed identifier: new notifications replace previous ones (no stacking)
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        let request = UNNotificationRequest(
            identifier: Self.workoutNotificationId,
            content: content,
            trigger: trigger
        )

        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                print("[HealthKitWriter] Failed to schedule notification: \(error.localizedDescription)")
            } else {
                print("[HealthKitWriter] Workout notification scheduled (count: \(count))")
            }
        }
    }

    // MARK: - Authorization

    /// Comprehensive HealthKit authorization — used on first app launch.
    /// Requests ALL read + write types the app will ever need in a single dialog
    /// so the user can "Turn On All" once and never deal with permissions again.
    @objc func requestReadAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit not available on this device")
            return
        }

        guard let stepsType = HKObjectType.quantityType(forIdentifier: .stepCount),
              let caloriesType = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned),
              let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate),
              let distanceWRType = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning) else {
            call.reject("Could not create HealthKit types")
            return
        }

        // READ: everything the app reads from HealthKit
        let typesToRead: Set<HKObjectType> = [
            stepsType,
            caloriesType,
            heartRateType,
            HKObjectType.workoutType(),
            HKSeriesType.workoutRoute()
        ]

        // WRITE: workout saving (workouts, calories, distance)
        let typesToWrite: Set<HKSampleType> = [
            HKObjectType.workoutType(),
            caloriesType,
            distanceWRType
        ]

        healthStore.requestAuthorization(toShare: typesToWrite, read: typesToRead) { success, error in
            DispatchQueue.main.async {
                if let error = error {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve(["authorized": success])
                }
            }
        }
    }

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
        let typesToRead: Set<HKObjectType> = [heartRateType, caloriesType, workoutType, HKSeriesType.workoutRoute()]

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
        let subtype = call.getString("subtype")

        // Request authorization first
        let workoutType = HKObjectType.workoutType()
        guard let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate),
              let caloriesType = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) else {
            call.reject("Could not create HealthKit types")
            return
        }

        var typesToRead: Set<HKObjectType> = [heartRateType, caloriesType]
        // Add distance to read types for activities that track it
        if let distanceType = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning) {
            typesToRead.insert(distanceType)
        }
        let typesToShare: Set<HKSampleType> = [workoutType]

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
            if subtype?.lowercased() == "indoor" {
                configuration.locationType = .indoor
            } else if subtype?.lowercased() == "outdoor" {
                configuration.locationType = .outdoor
            } else {
                configuration.locationType = .unknown
            }

            // Create workout builder
            let builder = HKWorkoutBuilder(healthStore: self.healthStore, configuration: configuration, device: .local())

            self.workoutBuilder = builder
            self.liveWorkoutActivityType = activityType
            self.liveWorkoutStartDate = Date()

            // Reset metrics
            self.accumulatedCalories = 0
            self.accumulatedDistance = 0
            self.heartRateSamples = []
            self.heartRateHKSamples = []
            self.lastHeartRate = 0
            self.observerStartDate = self.liveWorkoutStartDate

            // Begin workout data collection
            guard let startDate = self.liveWorkoutStartDate else {
                DispatchQueue.main.async {
                    call.reject("Failed to initialize workout start date")
                }
                return
            }

            builder.beginCollection(withStart: startDate) { success, error in
                if !success {
                    DispatchQueue.main.async {
                        self.workoutBuilder = nil
                        self.liveWorkoutStartDate = nil
                        call.reject(error?.localizedDescription ?? "Failed to start workout collection")
                    }
                    return
                }

                // Start observing heart rate, calories, and distance
                self.startHeartRateObserver(from: startDate)
                self.startCaloriesObserver(from: startDate)
                self.startDistanceObserver(from: startDate)

                // Start Live Activity on lock screen
                if #available(iOS 16.2, *) {
                    self.startWorkoutLiveActivity(activityType: activityTypeString, startTime: startDate)
                }

                DispatchQueue.main.async {
                    call.resolve([
                        "success": true,
                        "startDate": self.isoFormatter.string(from: startDate),
                        "activityType": activityTypeString
                    ])
                }
            }
        }
    }

    @objc func endLiveWorkout(_ call: CAPPluginCall) {
        guard let builder = workoutBuilder, let startDate = liveWorkoutStartDate else {
            // Always dismiss Live Activity even if workout state is gone
            if #available(iOS 16.2, *) {
                endWorkoutLiveActivity()
            }
            call.reject("No active workout to end")
            return
        }

        let endDate = Date()

        // Stop observer queries
        stopObserverQueries()

        // Optional: get user-provided distance (we don't write calories to avoid double-counting)
        let userDistance = call.getDouble("distance") // in meters

        // Store the accumulated calories for reporting (but we won't write them)
        let finalCalories = self.accumulatedCalories

        // End the workout collection
        builder.endCollection(withEnd: endDate) { [weak self] success, error in
            guard let self = self else { return }

            if !success {
                // Still dismiss Live Activity even if collection end fails
                if #available(iOS 16.2, *) {
                    self.endWorkoutLiveActivity()
                }
                DispatchQueue.main.async {
                    call.reject(error?.localizedDescription ?? "Failed to end workout collection")
                }
                return
            }

            // Add samples before finishing
            // NOTE: We intentionally do NOT write calories here to avoid double-counting.
            // The user's Apple Watch/device has already written calorie samples to HealthKit
            // during the workout. Writing them again would duplicate the values.
            var samples: [HKSample] = []

            // Add distance if provided (this doesn't cause double-counting issues)
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

            // NOTE: We also don't add heart rate samples here - they're already in HealthKit
            // from the Apple Watch. Adding them again would create duplicates.

            let finishWorkout = { [weak self] in
                guard let self = self else { return }

                builder.finishWorkout { workout, error in
                    // Calculate final metrics for reporting back to the app
                    let avgHr = self.heartRateSamples.isEmpty ? 0 : self.heartRateSamples.reduce(0, +) / Double(self.heartRateSamples.count)
                    let maxHr = self.heartRateSamples.max() ?? 0
                    let duration = endDate.timeIntervalSince(startDate) / 60.0 // in minutes

                    // End Live Activity
                    if #available(iOS 16.2, *) {
                        self.endWorkoutLiveActivity()
                    }

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
                                "distance": self.accumulatedDistance, // meters
                                "sampleCount": self.heartRateSamples.count
                            ])
                        } else {
                            call.reject(error?.localizedDescription ?? "Failed to save workout")
                        }

                        // Reset metrics
                        self.accumulatedCalories = 0
                        self.accumulatedDistance = 0
                        self.heartRateSamples = []
                        self.heartRateHKSamples = []
                        self.lastHeartRate = 0
                    }
                }
            }

            if !samples.isEmpty {
                builder.add(samples) { success, error in
                    if !success {
                        // Sample addition failed, continuing with workout finish
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

        // Dismiss Live Activity immediately
        if #available(iOS 16.2, *) {
            dismissWorkoutLiveActivity()
        }

        // Clean up
        workoutBuilder = nil
        liveWorkoutStartDate = nil
        observerStartDate = nil
        accumulatedCalories = 0
        accumulatedDistance = 0
        heartRateSamples = []
        heartRateHKSamples = []
        lastHeartRate = 0

        call.resolve(["success": true])
    }

    // MARK: - Widget Data

    @objc func updateWidgetData(_ call: CAPPluginCall) {
        let suiteName = "group.app.dayseven.fitness"
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            call.reject("Failed to access app group defaults")
            return
        }

        defaults.set(call.getInt("masterStreak") ?? 0, forKey: "masterStreak")
        defaults.set(call.getInt("liftsStreak") ?? 0, forKey: "liftsStreak")
        defaults.set(call.getInt("cardioStreak") ?? 0, forKey: "cardioStreak")
        defaults.set(call.getInt("recoveryStreak") ?? 0, forKey: "recoveryStreak")
        defaults.set(call.getInt("liftsCompleted") ?? 0, forKey: "liftsCompleted")
        defaults.set(call.getInt("liftsGoal") ?? 4, forKey: "liftsGoal")
        defaults.set(call.getInt("cardioCompleted") ?? 0, forKey: "cardioCompleted")
        defaults.set(call.getInt("cardioGoal") ?? 3, forKey: "cardioGoal")
        defaults.set(call.getInt("recoveryCompleted") ?? 0, forKey: "recoveryCompleted")
        defaults.set(call.getInt("recoveryGoal") ?? 2, forKey: "recoveryGoal")
        defaults.set(call.getInt("todaySteps") ?? 0, forKey: "todaySteps")
        defaults.set(call.getInt("stepsGoal") ?? 10000, forKey: "stepsGoal")
        defaults.set(call.getInt("todayCalories") ?? 0, forKey: "todayCalories")
        defaults.set(call.getInt("daysLeftInWeek") ?? 0, forKey: "daysLeftInWeek")
        defaults.set(Date().timeIntervalSince1970, forKey: "lastUpdated")

        // Recent activities for large widget (array of JSON strings)
        if let recentActivities = call.getArray("recentActivities") as? [String] {
            defaults.set(recentActivities, forKey: "recentActivities")
        }

        WidgetCenter.shared.reloadAllTimelines()

        call.resolve(["success": true])
    }

    // MARK: - Live Activity

    @available(iOS 16.2, *)
    private func startWorkoutLiveActivity(activityType: String, startTime: Date) {
        let icon = liveActivityIconForType(activityType)
        let category = liveActivityCategoryForType(activityType)

        let attributes = WorkoutActivityAttributes(
            activityType: activityType,
            activityIcon: icon,
            startTime: startTime,
            categoryColor: category
        )
        let initialState = WorkoutActivityAttributes.ContentState(isPaused: false)

        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: .init(state: initialState, staleDate: nil),
                pushType: nil
            )
            liveActivityId = activity.id
        } catch {
            print("[LiveActivity] Failed to start: \(error)")
        }
    }

    @available(iOS 16.2, *)
    private func endWorkoutLiveActivity() {
        let targetId = liveActivityId
        let finalState = WorkoutActivityAttributes.ContentState(isPaused: false)

        Task {
            if let targetId = targetId {
                // End only the phone workout's Live Activity
                for activity in Activity<WorkoutActivityAttributes>.activities {
                    if activity.id == targetId {
                        await activity.end(
                            .init(state: finalState, staleDate: nil),
                            dismissalPolicy: .immediate
                        )
                        print("[LiveActivity] Ended phone activity: \(activity.id)")
                        break
                    }
                }
            } else {
                // No ID — end ALL as fallback cleanup
                for activity in Activity<WorkoutActivityAttributes>.activities {
                    await activity.end(
                        .init(state: finalState, staleDate: nil),
                        dismissalPolicy: .immediate
                    )
                    print("[LiveActivity] Ended activity (fallback): \(activity.id)")
                }
            }
            self.liveActivityId = nil
        }
    }

    @available(iOS 16.2, *)
    private func updateLiveActivityPaused(_ isPaused: Bool, accumulatedPauseTime: Double = 0) {
        guard let activityId = liveActivityId else { return }
        let newState = WorkoutActivityAttributes.ContentState(isPaused: isPaused, accumulatedPauseTime: accumulatedPauseTime)

        Task {
            for activity in Activity<WorkoutActivityAttributes>.activities {
                if activity.id == activityId {
                    await activity.update(.init(state: newState, staleDate: nil))
                    break
                }
            }
        }
    }

    @available(iOS 16.2, *)
    private func dismissWorkoutLiveActivity() {
        let targetId = liveActivityId
        let finalState = WorkoutActivityAttributes.ContentState(isPaused: false)

        Task {
            if let targetId = targetId {
                // Dismiss only the phone workout's Live Activity
                for activity in Activity<WorkoutActivityAttributes>.activities {
                    if activity.id == targetId {
                        await activity.end(
                            .init(state: finalState, staleDate: nil),
                            dismissalPolicy: .immediate
                        )
                        print("[LiveActivity] Dismissed phone activity: \(activity.id)")
                        break
                    }
                }
            } else {
                // No ID — end ALL as fallback cleanup
                for activity in Activity<WorkoutActivityAttributes>.activities {
                    await activity.end(
                        .init(state: finalState, staleDate: nil),
                        dismissalPolicy: .immediate
                    )
                    print("[LiveActivity] Dismissed activity (fallback): \(activity.id)")
                }
            }
            self.liveActivityId = nil
        }
    }

    @objc func endAllLiveActivities(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            let finalState = WorkoutActivityAttributes.ContentState(isPaused: false)
            let activities = Activity<WorkoutActivityAttributes>.activities
            let count = activities.count
            print("[LiveActivity] endAllLiveActivities called, found \(count) active activities")

            if activities.isEmpty {
                call.resolve(["success": true, "ended": 0])
                return
            }

            Task {
                var ended = 0
                for activity in activities {
                    await activity.end(
                        .init(state: finalState, staleDate: nil),
                        dismissalPolicy: .immediate
                    )
                    ended += 1
                    print("[LiveActivity] Force-ended activity: \(activity.id)")
                }
                self.liveActivityId = nil
                DispatchQueue.main.async {
                    call.resolve(["success": true, "ended": ended])
                }
            }
        } else {
            call.resolve(["success": true, "ended": 0])
        }
    }

    @objc func checkActiveLiveActivity(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            let activities = Activity<WorkoutActivityAttributes>.activities
            if let active = activities.first {
                let attrs = active.attributes
                call.resolve([
                    "isActive": true,
                    "activityType": attrs.activityType,
                    "startTime": ISO8601DateFormatter().string(from: attrs.startTime)
                ])
            } else {
                call.resolve(["isActive": false])
            }
        } else {
            call.resolve(["isActive": false])
        }
    }

    private func liveActivityIconForType(_ type: String) -> String {
        let lowered = type.lowercased()
        if lowered.contains("run") { return "figure.run" }
        if lowered.contains("cycl") || lowered.contains("bik") { return "figure.outdoor.cycle" }
        if lowered.contains("swim") { return "figure.pool.swim" }
        if lowered.contains("hik") { return "figure.hiking" }
        if lowered.contains("walk") { return "figure.walk" }
        if lowered.contains("yoga") { return "figure.yoga" }
        if lowered.contains("strength") || lowered.contains("weight") || lowered.contains("lift") { return "dumbbell.fill" }
        if lowered.contains("pilates") { return "figure.pilates" }
        if lowered.contains("row") { return "figure.rower" }
        if lowered.contains("stretch") || lowered.contains("cool") || lowered.contains("recover") { return "figure.cooldown" }
        if lowered.contains("hiit") || lowered.contains("interval") || lowered.contains("cross") { return "flame.fill" }
        if lowered.contains("dance") { return "figure.dance" }
        if lowered.contains("box") || lowered.contains("martial") || lowered.contains("kickbox") { return "figure.boxing" }
        if lowered.contains("elliptical") { return "figure.elliptical" }
        if lowered.contains("stair") { return "figure.stair.stepper" }
        return "figure.mixed.cardio"
    }

    private func liveActivityCategoryForType(_ type: String) -> String {
        let lowered = type.lowercased()
        if lowered.contains("strength") || lowered.contains("weight") || lowered.contains("lift")
            || lowered.contains("bodyweight") || lowered.contains("calisthenics") {
            return "strength"
        }
        if lowered.contains("yoga") || lowered.contains("stretch") || lowered.contains("pilates")
            || lowered.contains("cool") || lowered.contains("recover") || lowered.contains("meditation")
            || lowered.contains("foam") || lowered.contains("mobility") {
            return "recovery"
        }
        return "cardio"
    }

    @objc func startWatchWorkoutLiveActivity(_ call: CAPPluginCall) {
        let activityType = call.getString("activityType") ?? "Other"
        if #available(iOS 16.2, *) {
            DispatchQueue.main.async {
                let mgr = WatchSessionManager.shared

                // Check if push-to-start already created one
                if mgr.watchWorkoutLiveActivityId == nil {
                    let existing = Activity<WorkoutActivityAttributes>.activities
                    if let pushStarted = existing.first {
                        mgr.watchWorkoutLiveActivityId = pushStarted.id
                        print("[LiveActivity] Adopted push-started Live Activity from JS: \(pushStarted.id)")
                        return
                    }
                }

                guard mgr.watchWorkoutLiveActivityId == nil else {
                    print("[LiveActivity] Watch Live Activity already active, skipping")
                    return
                }

                let icon = mgr.liveActivityIconForType(activityType)
                let category = mgr.liveActivityCategoryForType(activityType)
                let attributes = WorkoutActivityAttributes(
                    activityType: activityType,
                    activityIcon: icon,
                    startTime: Date(),
                    categoryColor: category
                )
                let initialState = WorkoutActivityAttributes.ContentState(isPaused: false)
                do {
                    let activity = try Activity.request(
                        attributes: attributes,
                        content: .init(state: initialState, staleDate: nil),
                        pushType: nil
                    )
                    mgr.watchWorkoutLiveActivityId = activity.id
                    print("[LiveActivity] Started watch workout Live Activity from JS: \(activity.id)")
                } catch {
                    print("[LiveActivity] Failed to start from JS: \(error)")
                }
            }
        }
        call.resolve(["success": true])
    }

    @objc func updateLiveActivityState(_ call: CAPPluginCall) {
        let isPaused = call.getBool("isPaused") ?? false
        let accumulatedPauseTime = call.getDouble("accumulatedPauseTime") ?? 0
        if #available(iOS 16.2, *) {
            // Update phone-started workout Live Activity
            updateLiveActivityPaused(isPaused, accumulatedPauseTime: accumulatedPauseTime)
            // Update watch-started workout Live Activity
            WatchSessionManager.shared.updateWatchWorkoutLiveActivityPaused(isPaused, accumulatedPauseTime: accumulatedPauseTime)
        }
        call.resolve(["success": true])
    }

    private var liveActivityId: String?

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

        guard let startDate = liveWorkoutStartDate else {
            call.resolve(["isActive": false, "calories": 0, "avgHr": 0, "maxHr": 0, "lastHr": 0, "sampleCount": 0])
            return
        }

        let avgHr = heartRateSamples.isEmpty ? 0 : heartRateSamples.reduce(0, +) / Double(heartRateSamples.count)
        let maxHr = heartRateSamples.max() ?? 0
        let elapsed = Date().timeIntervalSince(startDate) / 60.0

        call.resolve([
            "isActive": true,
            "elapsed": Int(round(elapsed)),
            "calories": Int(round(accumulatedCalories)),
            "avgHr": Int(round(avgHr)),
            "maxHr": Int(round(maxHr)),
            "lastHr": Int(round(lastHeartRate)),
            "distance": accumulatedDistance, // meters
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
                        // Sample addition failed, continuing with workout finish
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
        if let existingStart = liveWorkoutStartDate {
            call.resolve([
                "success": true,
                "startDate": isoFormatter.string(from: existingStart),
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

            let observerStart = Date()
            self.observerStartDate = observerStart
            self.accumulatedCalories = 0
            self.accumulatedDistance = 0
            self.heartRateSamples = []
            self.heartRateHKSamples = []
            self.lastHeartRate = 0

            self.startHeartRateObserver(from: observerStart)
            self.startCaloriesObserver(from: observerStart)

            DispatchQueue.main.async {
                call.resolve([
                    "success": true,
                    "startDate": self.isoFormatter.string(from: observerStart)
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
        accumulatedDistance = 0
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
        if let query = distanceQuery {
            healthStore.stop(query)
            distanceQuery = nil
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

    private func startDistanceObserver(from startDate: Date) {
        guard let distanceType = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning) else { return }

        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: nil, options: .strictStartDate)

        distanceQuery = HKObserverQuery(sampleType: distanceType, predicate: predicate) { [weak self] query, completionHandler, error in
            guard let self = self else {
                completionHandler()
                return
            }

            if error != nil {
                completionHandler()
                return
            }

            self.fetchDistanceSamples(from: startDate)
            completionHandler()
        }

        if let query = distanceQuery {
            healthStore.execute(query)
            fetchDistanceSamples(from: startDate)
        }
    }

    private func fetchDistanceSamples(from startDate: Date) {
        guard let distanceType = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning) else { return }

        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: nil, options: .strictStartDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)

        let query = HKSampleQuery(sampleType: distanceType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sortDescriptor]) { [weak self] _, samples, error in
            guard let self = self, error == nil, let samples = samples as? [HKQuantitySample] else { return }

            let meterUnit = HKUnit.meter()
            var totalDistance: Double = 0

            for sample in samples {
                totalDistance += sample.quantity.doubleValue(for: meterUnit)
            }

            if totalDistance > 0 {
                self.accumulatedDistance = totalDistance
            }
        }

        healthStore.execute(query)
    }

    // MARK: - Heart Rate Query

    @objc func queryHeartRate(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["hasData": false])
            return
        }

        guard let startDateString = call.getString("startDate"),
              let endDateString = call.getString("endDate"),
              let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate) else {
            call.resolve(["hasData": false])
            return
        }

        guard let startDate = isoFormatter.date(from: startDateString) ?? isoFormatterNoFraction.date(from: startDateString),
              let endDate = isoFormatter.date(from: endDateString) ?? isoFormatterNoFraction.date(from: endDateString) else {
            call.reject("Invalid date format. Use ISO 8601 (e.g., 2024-01-15T14:30:00.000Z)")
            return
        }

        // Request read authorization for heart rate
        let typesToRead: Set<HKObjectType> = [heartRateType]

        healthStore.requestAuthorization(toShare: nil, read: typesToRead) { [weak self] success, error in
            guard let self = self else { return }

            if !success {
                DispatchQueue.main.async {
                    call.resolve(["hasData": false])
                }
                return
            }

            let predicate = HKQuery.predicateForSamples(
                withStart: startDate,
                end: endDate,
                options: [.strictStartDate, .strictEndDate]
            )

            let query = HKSampleQuery(
                sampleType: heartRateType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, samples, _ in
                DispatchQueue.main.async {
                    guard let samples = samples as? [HKQuantitySample], !samples.isEmpty else {
                        call.resolve(["hasData": false])
                        return
                    }

                    let hrUnit = HKUnit.count().unitDivided(by: .minute())
                    let hrValues = samples.map { $0.quantity.doubleValue(for: hrUnit) }

                    let avgHr = hrValues.reduce(0, +) / Double(hrValues.count)
                    let maxHr = hrValues.max() ?? 0

                    call.resolve([
                        "hasData": true,
                        "avgHr": Int(round(avgHr)),
                        "maxHr": Int(round(maxHr)),
                        "sampleCount": hrValues.count
                    ])
                }
            }

            self.healthStore.execute(query)
        }
    }

    // MARK: - Watch Workout Control (via WatchConnectivity)

    @objc func isWatchReachable(_ call: CAPPluginCall) {
        call.resolve(["reachable": WatchSessionManager.shared.isWatchReachable])
    }

    @objc func startWatchWorkout(_ call: CAPPluginCall) {
        guard let activityType = call.getString("activityType") else {
            call.reject("Missing required parameter: activityType")
            return
        }

        let strengthType = call.getString("strengthType")
        let subtype = call.getString("subtype")
        let focusArea = call.getString("focusArea")
        let focusAreas = call.getArray("focusAreas") as? [String]

        var message: [String: Any] = [
            "action": "startWorkout",
            "activityType": activityType
        ]
        if let st = strengthType {
            message["strengthType"] = st
        }
        if let sub = subtype {
            message["subtype"] = sub
        }
        if let areas = focusAreas, !areas.isEmpty {
            message["focusAreas"] = areas
            message["focusArea"] = areas[0]
        } else if let fa = focusArea {
            message["focusArea"] = fa
        }

        WatchSessionManager.shared.sendToWatch(
            message: message,
            replyHandler: { reply in
                DispatchQueue.main.async {
                    if let error = reply["error"] as? String {
                        call.reject(error)
                    } else {
                        call.resolve(reply)
                        // sendMessage already started the workout on the watch —
                        // do NOT also call startWatchApp, as that causes a race condition
                        // where handle(_ workoutConfiguration:) tries to start a second session.
                    }
                }
            },
            errorHandler: { [weak self] error in
                // Reject so JS falls back to phone workout (with working timer)
                DispatchQueue.main.async {
                    call.reject(error.localizedDescription)
                }
                // Fire-and-forget: try to wake the watch app in the background
                // Even if this fails, the phone workout is already running
                self?.attemptWatchAppLaunch(activityType: activityType, subtype: subtype)
            }
        )
    }

    /// Fire-and-forget attempt to launch the watch app via HealthKit.
    /// This does NOT affect the Capacitor call — the phone workout is already the source of truth.
    /// If the watch wakes up and starts tracking, it will send a workoutStarted message
    /// and the phone will cancel its own session and switch to watch source.
    private func attemptWatchAppLaunch(activityType: String, subtype: String?) {
        let hkType = mapActivityType(activityType)
        let config = HKWorkoutConfiguration()
        config.activityType = hkType
        // Only set indoor/outdoor for activities that have location-based subtypes
        if subtype?.lowercased() == "indoor" {
            config.locationType = .indoor
        } else if subtype?.lowercased() == "outdoor" {
            config.locationType = .outdoor
        } else {
            config.locationType = .unknown
        }

        print("[HealthKitWriter] attemptWatchAppLaunch: activityType=\(activityType), hkType=\(hkType.rawValue)")

        Task { @MainActor in
            do {
                try await self.healthStore.startWatchApp(toHandle: config)
                print("[HealthKitWriter] startWatchApp succeeded ✓")
            } catch {
                print("[HealthKitWriter] startWatchApp failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func endWatchWorkout(_ call: CAPPluginCall) {
        // Immediately dismiss Live Activity on the phone — don't wait for watch confirmation
        if #available(iOS 16.2, *) {
            WatchSessionManager.shared.endWatchWorkoutLiveActivity()
        }

        let message: [String: Any] = ["action": "endWorkout"]

        WatchSessionManager.shared.sendToWatch(
            message: message,
            replyHandler: { reply in
                DispatchQueue.main.async {
                    if let error = reply["error"] as? String {
                        call.reject(error)
                    } else {
                        call.resolve(reply)
                    }
                }
            },
            errorHandler: { error in
                // First attempt failed — retry once after 1 second
                // (watch may have gone to sleep between pause and end)
                print("[HealthKitWriter] endWatchWorkout first attempt failed, retrying in 1s: \(error.localizedDescription)")
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    WatchSessionManager.shared.sendToWatch(
                        message: message,
                        replyHandler: { reply in
                            DispatchQueue.main.async {
                                if let error = reply["error"] as? String {
                                    call.reject(error)
                                } else {
                                    call.resolve(reply)
                                }
                            }
                        },
                        errorHandler: { retryError in
                            // Both attempts failed — applicationContext fallback was already queued
                            // by sendToWatch, so the watch will end the workout when it wakes up
                            print("[HealthKitWriter] endWatchWorkout retry also failed: \(retryError.localizedDescription)")
                            DispatchQueue.main.async {
                                // Resolve with a special flag so JS knows the command was queued
                                call.resolve([
                                    "success": true,
                                    "queued": true,
                                    "message": "Watch not reachable. Workout will end when watch wakes up."
                                ])
                            }
                        }
                    )
                }
            }
        )
    }

    @objc func pauseWatchWorkout(_ call: CAPPluginCall) {
        WatchSessionManager.shared.sendToWatch(
            message: ["action": "pauseWorkout"],
            replyHandler: { reply in
                DispatchQueue.main.async {
                    if let error = reply["error"] as? String {
                        call.reject(error)
                    } else {
                        call.resolve(reply)
                    }
                }
            },
            errorHandler: { error in
                DispatchQueue.main.async {
                    call.reject(error.localizedDescription)
                }
            }
        )
    }

    @objc func resumeWatchWorkout(_ call: CAPPluginCall) {
        WatchSessionManager.shared.sendToWatch(
            message: ["action": "resumeWorkout"],
            replyHandler: { reply in
                DispatchQueue.main.async {
                    if let error = reply["error"] as? String {
                        call.reject(error)
                    } else {
                        call.resolve(reply)
                    }
                }
            },
            errorHandler: { error in
                DispatchQueue.main.async {
                    call.reject(error.localizedDescription)
                }
            }
        )
    }

    @objc func getWatchWorkoutMetrics(_ call: CAPPluginCall) {
        // Don't guard on isWatchReachable — sendMessage can wake the watch even
        // when isReachable is false. If it truly can't reach, the error handler fires.
        let session = WCSession.default
        guard session.activationState == .activated else {
            call.resolve(["isActive": false, "reachable": false])
            return
        }

        WatchSessionManager.shared.sendToWatch(
            message: ["action": "getMetrics"],
            replyHandler: { reply in
                DispatchQueue.main.async {
                    call.resolve(reply)
                }
            },
            errorHandler: { error in
                DispatchQueue.main.async {
                    call.resolve(["isActive": false, "error": error.localizedDescription])
                }
            }
        )
    }

    @objc func cancelWatchWorkout(_ call: CAPPluginCall) {
        // Immediately dismiss Live Activity on the phone — don't wait for watch confirmation
        if #available(iOS 16.2, *) {
            WatchSessionManager.shared.endWatchWorkoutLiveActivity()
        }

        let message: [String: Any] = ["action": "cancelWorkout"]

        WatchSessionManager.shared.sendToWatch(
            message: message,
            replyHandler: { reply in
                DispatchQueue.main.async {
                    if let error = reply["error"] as? String {
                        call.reject(error)
                    } else {
                        call.resolve(reply)
                    }
                }
            },
            errorHandler: { error in
                // Retry once after 1 second (same pattern as endWatchWorkout)
                print("[HealthKitWriter] cancelWatchWorkout first attempt failed, retrying in 1s")
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    WatchSessionManager.shared.sendToWatch(
                        message: message,
                        replyHandler: { reply in
                            DispatchQueue.main.async {
                                if let error = reply["error"] as? String {
                                    call.reject(error)
                                } else {
                                    call.resolve(reply)
                                }
                            }
                        },
                        errorHandler: { retryError in
                            // applicationContext fallback was already queued by sendToWatch
                            print("[HealthKitWriter] cancelWatchWorkout retry also failed: \(retryError.localizedDescription)")
                            DispatchQueue.main.async {
                                call.resolve([
                                    "success": true,
                                    "queued": true,
                                    "message": "Watch not reachable. Workout will cancel when watch wakes up."
                                ])
                            }
                        }
                    )
                }
            }
        )
    }

    // MARK: - Notify Watch Data Changed

    /// Tells the watch to refresh its data from Firestore.
    /// Called when the phone deletes/modifies activities so the watch doesn't operate on stale data.
    @objc func notifyWatchDataChanged(_ call: CAPPluginCall) {
        print("[HealthKitWriter] notifyWatchDataChanged called from JS")
        let session = WCSession.default

        guard session.activationState == .activated else {
            print("[HealthKitWriter] notifyWatchDataChanged: session not activated")
            call.resolve(["sent": false, "reason": "not_activated"])
            return
        }

        // Use transferUserInfo — it's queued and reliably delivered even when
        // the watch app is in the foreground or background. Unlike sendMessage
        // (which requires isReachable=true) or applicationContext (which only
        // delivers on fresh launches), transferUserInfo always gets delivered.
        let userInfo: [String: Any] = [
            "action": "dataChanged",
            "timestamp": Date().timeIntervalSince1970
        ]
        session.transferUserInfo(userInfo)
        print("[HealthKitWriter] notifyWatchDataChanged: queued via transferUserInfo")
        call.resolve(["sent": true, "method": "transferUserInfo"])
    }

    // MARK: - Resolve Raw HKWorkoutActivityType Values

    /// Resolves raw HKWorkoutActivityType integers to camelCase keys + human-readable names.
    /// Uses the native Swift SDK so it's always up to date — no JS-side mapping needed.
    @objc func resolveWorkoutTypes(_ call: CAPPluginCall) {
        guard let rawValues = call.getArray("rawValues", Int.self) else {
            call.reject("Missing rawValues array")
            return
        }

        var results: [String: [String: String]] = [:]
        for raw in rawValues {
            guard let activityType = HKWorkoutActivityType(rawValue: UInt(raw)) else {
                results[String(raw)] = ["key": "other", "name": "Workout"]
                continue
            }
            let (key, name) = workoutTypeInfo(activityType)
            results[String(raw)] = ["key": key, "name": name]
        }

        call.resolve(["types": results])
    }

    /// Maps an HKWorkoutActivityType to a (camelCase key, human-readable name) pair.
    private func workoutTypeInfo(_ type: HKWorkoutActivityType) -> (String, String) {
        switch type {
        // Cardio
        case .running:                          return ("running", "Running")
        case .cycling:                          return ("cycling", "Cycling")
        case .swimming:                         return ("swimming", "Swimming")
        case .walking:                          return ("walking", "Walking")
        case .hiking:                           return ("hiking", "Hiking")
        case .elliptical:                       return ("elliptical", "Elliptical")
        case .rowing:                           return ("rowing", "Rowing")
        case .stairClimbing:                    return ("stairClimbing", "Stair Climbing")
        case .jumpRope:                         return ("jumpRope", "Jump Rope")
        case .stairs:                           return ("stairs", "Stairs")
        case .stepTraining:                     return ("stepTraining", "Step Training")
        case .handCycling:                      return ("handCycling", "Hand Cycling")

        // Strength
        case .traditionalStrengthTraining:      return ("traditionalStrengthTraining", "Strength Training")
        case .functionalStrengthTraining:       return ("functionalStrengthTraining", "Functional Training")
        case .highIntensityIntervalTraining:    return ("highIntensityIntervalTraining", "HIIT")
        case .crossTraining:                    return ("crossTraining", "Cross Training")
        case .coreTraining:                     return ("coreTraining", "Core Training")

        // Mind & Body
        case .yoga:                             return ("yoga", "Yoga")
        case .pilates:                          return ("pilates", "Pilates")
        case .flexibility:                      return ("flexibility", "Flexibility")
        case .mindAndBody:                      return ("mindAndBody", "Mind & Body")
        case .taiChi:                           return ("taiChi", "Tai Chi")
        case .barre:                            return ("barre", "Barre")

        // Dance
        case .dance:                            return ("dance", "Dance")
        case .cardioDance:                      return ("dance", "Dance")
        case .socialDance:                      return ("dance", "Dance")

        // Sports
        case .basketball:                       return ("basketball", "Basketball")
        case .soccer:                           return ("soccer", "Soccer")
        case .americanFootball:                 return ("americanFootball", "Football")
        case .tennis:                           return ("tennis", "Tennis")
        case .golf:                             return ("golf", "Golf")
        case .baseball:                         return ("baseball", "Baseball")
        case .badminton:                        return ("badminton", "Badminton")
        case .volleyball:                       return ("volleyball", "Volleyball")
        case .hockey:                           return ("hockey", "Hockey")
        case .lacrosse:                         return ("lacrosse", "Lacrosse")
        case .rugby:                            return ("rugby", "Rugby")
        case .softball:                         return ("softball", "Softball")
        case .squash:                           return ("squash", "Squash")
        case .tableTennis:                      return ("tableTennis", "Table Tennis")
        case .racquetball:                      return ("racquetball", "Racquetball")
        case .handball:                         return ("handball", "Handball")
        case .cricket:                          return ("cricket", "Cricket")
        case .boxing:                           return ("boxing", "Boxing")
        case .martialArts:                      return ("martialArts", "Martial Arts")
        case .kickboxing:                       return ("kickboxing", "Kickboxing")
        case .wrestling:                        return ("wrestling", "Wrestling")
        case .fencing:                          return ("fencing", "Fencing")
        case .archery:                          return ("archery", "Archery")
        case .discSports:                       return ("discSports", "Disc Sports")
        case .pickleball:                       return ("pickleball", "Pickleball")

        // Water Sports
        case .surfingSports:                    return ("surfing", "Surfing")
        case .waterFitness:                     return ("waterFitness", "Water Fitness")
        case .waterPolo:                        return ("waterPolo", "Water Polo")
        case .waterSports:                      return ("waterSports", "Water Sports")
        case .sailing:                          return ("sailing", "Sailing")
        case .paddleSports:                     return ("paddleSports", "Paddle Sports")
        case .fishing:                          return ("fishing", "Fishing")

        // Winter Sports
        case .snowSports:                       return ("snowSports", "Snow Sports")
        case .crossCountrySkiing:               return ("crossCountrySkiing", "Cross Country Skiing")
        case .downhillSkiing:                   return ("downhillSkiing", "Downhill Skiing")
        case .snowboarding:                     return ("snowboarding", "Snowboarding")
        case .skatingSports:                    return ("skating", "Skating")

        // Other
        case .cooldown:                         return ("cooldown", "Cooldown")
        case .preparationAndRecovery:           return ("preparationAndRecovery", "Recovery")
        case .fitnessGaming:                    return ("fitnessGaming", "Fitness Gaming")
        case .play:                             return ("play", "Play")
        case .equestrianSports:                 return ("equestrianSports", "Equestrian")
        case .hunting:                          return ("hunting", "Hunting")
        case .gymnastics:                       return ("gymnastics", "Gymnastics")
        case .trackAndField:                    return ("trackAndField", "Track & Field")
        case .australianFootball:               return ("australianFootball", "Australian Football")
        case .bowling:                          return ("bowling", "Bowling")
        case .climbing:                         return ("climbing", "Climbing")
        case .curling:                          return ("curling", "Curling")
        case .mixedCardio:                      return ("mixedCardio", "Mixed Cardio")
        case .wheelchairWalkPace:               return ("wheelchairWalk", "Wheelchair Walk")
        case .wheelchairRunPace:                return ("wheelchairRun", "Wheelchair Run")
        case .swimBikeRun:                      return ("swimBikeRun", "Triathlon")
        case .transition:                       return ("transition", "Transition")
        case .underwaterDiving:                 return ("underwaterDiving", "Underwater Diving")

        // Deprecated types (still in SDK)
        case .mixedMetabolicCardioTraining:     return ("mixedCardio", "Mixed Cardio")
        case .danceInspiredTraining:            return ("dance", "Dance")
        case .other:                            return ("other", "Workout")

        // Catch-all for any future types Apple adds
        @unknown default:                       return ("other", "Workout")
        }
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
        case "strength training", "weightlifting", "lifting", "bodyweight", "circuit":
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

        // Recovery
        case "cold plunge", "sauna":
            return .preparationAndRecovery

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

    // MARK: - Workout Route Query

    private func resolveNoRoute(_ call: CAPPluginCall, reason: String) {
        DispatchQueue.main.async {
            call.resolve(["coordinates": [] as [[String: Any]], "hasRoute": false, "reason": reason])
        }
    }

    @objc func getWorkoutRoute(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            resolveNoRoute(call, reason: "health_data_unavailable")
            return
        }

        guard let uuidString = call.getString("workoutUUID") else {
            resolveNoRoute(call, reason: "invalid_uuid")
            return
        }

        // Try parsing as a real UUID first; if that fails, fall back to startDate-based lookup
        if let workoutUUID = UUID(uuidString: uuidString) {
            print("[HealthKitWriter] getWorkoutRoute called for UUID: \(uuidString)")
            fetchWorkoutAndRoute(uuid: workoutUUID, call: call)
        } else if let startDateStr = call.getString("startDate") {
            print("[HealthKitWriter] getWorkoutRoute falling back to startDate lookup: \(startDateStr)")
            fetchWorkoutByStartDate(startDateStr, call: call)
        } else {
            resolveNoRoute(call, reason: "invalid_uuid")
        }
    }

    private func fetchWorkoutByStartDate(_ startDateStr: String, call: CAPPluginCall) {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var startDate = formatter.date(from: startDateStr)
        if startDate == nil {
            formatter.formatOptions = [.withInternetDateTime]
            startDate = formatter.date(from: startDateStr)
        }
        guard let date = startDate else {
            resolveNoRoute(call, reason: "invalid_start_date")
            return
        }

        // Query workouts in a narrow window around the start date (±30 seconds)
        let predicate = HKQuery.predicateForSamples(
            withStart: date.addingTimeInterval(-30),
            end: date.addingTimeInterval(30),
            options: .strictStartDate
        )
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        let query = HKSampleQuery(
            sampleType: HKObjectType.workoutType(),
            predicate: predicate,
            limit: 5,
            sortDescriptors: [sortDescriptor]
        ) { [weak self] _, samples, error in
            guard let self = self else { return }

            if let error = error {
                print("[HealthKitWriter] StartDate workout query error: \(error.localizedDescription)")
                self.resolveNoRoute(call, reason: "workout_query_error")
                return
            }

            // Pick the workout closest to the exact start date
            guard let workouts = samples as? [HKWorkout],
                  let closest = workouts.min(by: { abs($0.startDate.timeIntervalSince(date)) < abs($1.startDate.timeIntervalSince(date)) }) else {
                print("[HealthKitWriter] No workout found near startDate: \(startDateStr)")
                self.resolveNoRoute(call, reason: "workout_not_found")
                return
            }

            print("[HealthKitWriter] Found workout by startDate, looking for routes...")
            self.fetchRouteForWorkout(closest, call: call)
        }
        healthStore.execute(query)
    }

    private func fetchWorkoutAndRoute(uuid: UUID, call: CAPPluginCall) {
        let predicate = HKQuery.predicateForObject(with: uuid)
        let workoutQuery = HKSampleQuery(
            sampleType: HKObjectType.workoutType(),
            predicate: predicate,
            limit: 1,
            sortDescriptors: nil
        ) { [weak self] _, samples, error in
            guard let self = self else { return }

            if let error = error {
                print("[HealthKitWriter] Workout query error: \(error.localizedDescription)")
                self.resolveNoRoute(call, reason: "workout_query_error")
                return
            }

            guard let workout = samples?.first as? HKWorkout else {
                print("[HealthKitWriter] Workout not found for UUID: \(uuid.uuidString)")
                self.resolveNoRoute(call, reason: "workout_not_found")
                return
            }

            print("[HealthKitWriter] Found workout, looking for routes...")
            self.fetchRouteForWorkout(workout, call: call)
        }
        healthStore.execute(workoutQuery)
    }

    private func fetchRouteForWorkout(_ workout: HKWorkout, call: CAPPluginCall) {
        let routeType = HKSeriesType.workoutRoute()
        let workoutPredicate = HKQuery.predicateForObjects(from: workout)

        let routeQuery = HKSampleQuery(
            sampleType: routeType,
            predicate: workoutPredicate,
            limit: 1,
            sortDescriptors: nil
        ) { [weak self] _, samples, error in
            guard let self = self else { return }

            if let error = error {
                print("[HealthKitWriter] Route sample query error: \(error.localizedDescription)")
                self.resolveNoRoute(call, reason: "route_query_error")
                return
            }

            guard let route = samples?.first as? HKWorkoutRoute else {
                print("[HealthKitWriter] No route data found for workout")
                self.resolveNoRoute(call, reason: "no_route_data")
                return
            }

            print("[HealthKitWriter] Found route, extracting coordinates...")
            self.extractSingleRoute(route, call: call)
        }
        healthStore.execute(routeQuery)
    }

    private func extractSingleRoute(_ route: HKWorkoutRoute, call: CAPPluginCall) {
        var allCoords: [[String: Any]] = []

        let query = HKWorkoutRouteQuery(route: route) { [weak self] query, locations, done, error in
            guard let self = self else { return }

            if let error = error {
                print("[HealthKitWriter] Route extraction error: \(error.localizedDescription)")
                if done {
                    self.removeRouteQuery(query)
                    self.resolveNoRoute(call, reason: "extraction_error")
                }
                return
            }

            if let locations = locations {
                for loc in locations {
                    let lat = loc.coordinate.latitude
                    let lng = loc.coordinate.longitude
                    guard lat.isFinite, lng.isFinite, lat != 0 || lng != 0 else { continue }

                    allCoords.append([
                        "lat": lat,
                        "lng": lng
                    ])
                }
            }

            if done {
                self.removeRouteQuery(query)
                print("[HealthKitWriter] Route extraction complete: \(allCoords.count) points")

                // Downsample if too many points
                var result = allCoords
                let maxPoints = 500
                if result.count > maxPoints {
                    var downsampled: [[String: Any]] = []
                    let step = Double(result.count) / Double(maxPoints)
                    for i in 0..<maxPoints {
                        let idx = min(Int(Double(i) * step), result.count - 1)
                        downsampled.append(result[idx])
                    }
                    if let last = result.last { downsampled.append(last) }
                    result = downsampled
                }

                DispatchQueue.main.async {
                    call.resolve([
                        "hasRoute": !result.isEmpty,
                        "coordinates": result,
                        "count": result.count
                    ])
                }
            }
        }

        // Retain query to prevent deallocation before callback completes
        activeRouteQueries.append(query)
        healthStore.execute(query)
    }

    private func removeRouteQuery(_ query: HKWorkoutRouteQuery) {
        activeRouteQueries.removeAll { $0 === query }
    }
}
