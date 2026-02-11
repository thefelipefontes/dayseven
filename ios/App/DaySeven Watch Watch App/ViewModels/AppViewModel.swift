import Foundation
import Combine
import FirebaseAuth

// MARK: - App View Model

@MainActor
class AppViewModel: ObservableObject {
    // Services
    let authService = AuthService()
    let firestoreService = FirestoreService()
    let healthKitService = HealthKitService()
    let workoutManager = WorkoutManager()

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
        // Forward authService changes to trigger view updates
        authService.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.objectWillChange.send()
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
        guard let uid = authService.currentUser?.uid else { return }

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
        updateStreaksIfNeeded(oldProgress: oldProgress, newProgress: newProgress, category: category, recordUpdates: &recordUpdates)

        // Save to Firestore
        do {
            try await firestoreService.batchSave(
                uid: uid,
                activities: updatedActivities,
                streaks: streaks,
                recordUpdates: recordUpdates
            )
        } catch {
            errorMessage = "Failed to save: \(error.localizedDescription)"
        }
    }

    // MARK: - Streak Update Logic (matches App.jsx lines 17555-17703)

    private func updateStreaksIfNeeded(
        oldProgress: WeeklyProgress,
        newProgress: WeeklyProgress,
        category: String,
        recordUpdates: inout [String: Any]?
    ) {
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

        if allGoalsMet && !wasAllGoalsMet {
            streaks.master += 1
            if streaks.master > (personalRecords.longestMasterStreak ?? 0) {
                personalRecords.longestMasterStreak = streaks.master
                updates["longestMasterStreak"] = streaks.master
            }
        }

        if !updates.isEmpty {
            recordUpdates = updates
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
}
