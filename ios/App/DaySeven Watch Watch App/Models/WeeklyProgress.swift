import Foundation

// MARK: - Category Progress

struct CategoryProgress {
    var completed: Int
    var goal: Int

    var isComplete: Bool {
        completed >= goal
    }

    var progress: Double {
        guard goal > 0 else { return 0 }
        return min(Double(completed) / Double(goal), 1.0)
    }
}

// MARK: - Weekly Progress

struct WeeklyProgress {
    var lifts: CategoryProgress
    var cardio: CategoryProgress
    var recovery: CategoryProgress

    var allGoalsMet: Bool {
        lifts.isComplete && cardio.isComplete && recovery.isComplete
    }

    static let empty = WeeklyProgress(
        lifts: CategoryProgress(completed: 0, goal: 4),
        cardio: CategoryProgress(completed: 0, goal: 3),
        recovery: CategoryProgress(completed: 0, goal: 2)
    )
}

// MARK: - Weekly Progress Calculation (matches App.jsx line 17161)

func calculateWeeklyProgress(activities: [Activity], goals: UserGoals) -> WeeklyProgress {
    let calendar = Calendar.current
    let today = Date()

    // Get start of week (Sunday)
    let weekday = calendar.component(.weekday, from: today) // 1 = Sunday
    let startOfWeek = calendar.date(byAdding: .day, value: -(weekday - 1), to: calendar.startOfDay(for: today))!

    // Filter activities for current week
    let weekActivities = activities.filter { activity in
        guard let date = parseLocalDate(activity.date) else { return false }
        return date >= startOfWeek && date <= today
    }

    // Count by category
    let liftsCount = weekActivities.filter { ActivityTypes.getActivityCategory($0) == "lifting" }.count
    let cardioCount = weekActivities.filter { ActivityTypes.getActivityCategory($0) == "cardio" }.count
    let recoveryCount = weekActivities.filter { ActivityTypes.getActivityCategory($0) == "recovery" }.count

    return WeeklyProgress(
        lifts: CategoryProgress(completed: liftsCount, goal: goals.liftsPerWeek),
        cardio: CategoryProgress(completed: cardioCount, goal: goals.cardioPerWeek),
        recovery: CategoryProgress(completed: recoveryCount, goal: goals.recoveryPerWeek)
    )
}

// MARK: - Weekly Stats

struct WeeklyStats {
    var totalWorkouts: Int
    var totalCalories: Int
    var totalMiles: Double
    var strengthCount: Int
    var cardioCount: Int
    var recoveryCount: Int
}

func calculateWeeklyStats(activities: [Activity]) -> WeeklyStats {
    let calendar = Calendar.current
    let today = Date()
    let weekday = calendar.component(.weekday, from: today)
    let startOfWeek = calendar.date(byAdding: .day, value: -(weekday - 1), to: calendar.startOfDay(for: today))!

    let weekActivities = activities.filter { activity in
        guard let date = parseLocalDate(activity.date) else { return false }
        return date >= startOfWeek && date <= today
    }

    let totalCalories = weekActivities.reduce(0) { $0 + ($1.calories ?? 0) }
    let totalMiles = weekActivities.reduce(0.0) { $0 + ($1.distance ?? 0) }
    let strengthCount = weekActivities.filter { ActivityTypes.getActivityCategory($0) == "lifting" }.count
    let cardioCount = weekActivities.filter { ActivityTypes.getActivityCategory($0) == "cardio" }.count
    let recoveryCount = weekActivities.filter { ActivityTypes.getActivityCategory($0) == "recovery" }.count

    return WeeklyStats(
        totalWorkouts: weekActivities.count,
        totalCalories: totalCalories,
        totalMiles: totalMiles,
        strengthCount: strengthCount,
        cardioCount: cardioCount,
        recoveryCount: recoveryCount
    )
}
