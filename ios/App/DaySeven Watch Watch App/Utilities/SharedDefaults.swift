import Foundation

// MARK: - Shared App Group Defaults (Watch App ↔ Widget Extension)

struct SharedDefaults {
    static let suiteName = "group.app.dayseven.fitness"

    // Keys
    static let masterStreakKey = "masterStreak"
    static let liftsStreakKey = "liftsStreak"
    static let cardioStreakKey = "cardioStreak"
    static let recoveryStreakKey = "recoveryStreak"
    static let liftsCompletedKey = "liftsCompleted"
    static let liftsGoalKey = "liftsGoal"
    static let cardioCompletedKey = "cardioCompleted"
    static let cardioGoalKey = "cardioGoal"
    static let recoveryCompletedKey = "recoveryCompleted"
    static let recoveryGoalKey = "recoveryGoal"
    static let todayStepsKey = "todaySteps"
    static let stepsGoalKey = "stepsGoal"
    static let todayCaloriesKey = "todayCalories"
    static let lastUpdatedKey = "lastUpdated"

    // Celebration tracking keys (used by CelebrationManager)
    static let dailyGoalsCelebratedKey = "dailyGoalsCelebrated"
    static let weekCategoryCelebratedKey = "weekCategoryCelebrated"

    static var shared: UserDefaults? {
        UserDefaults(suiteName: suiteName)
    }

    // MARK: - Write (called from watch app after data loads / activity saves)

    static func writeStreakData(
        masterStreak: Int, liftsStreak: Int, cardioStreak: Int, recoveryStreak: Int,
        liftsCompleted: Int, liftsGoal: Int,
        cardioCompleted: Int, cardioGoal: Int,
        recoveryCompleted: Int, recoveryGoal: Int,
        todaySteps: Int, stepsGoal: Int, todayCalories: Int
    ) {
        guard let defaults = shared else { return }
        defaults.set(masterStreak, forKey: masterStreakKey)
        defaults.set(liftsStreak, forKey: liftsStreakKey)
        defaults.set(cardioStreak, forKey: cardioStreakKey)
        defaults.set(recoveryStreak, forKey: recoveryStreakKey)
        defaults.set(liftsCompleted, forKey: liftsCompletedKey)
        defaults.set(liftsGoal, forKey: liftsGoalKey)
        defaults.set(cardioCompleted, forKey: cardioCompletedKey)
        defaults.set(cardioGoal, forKey: cardioGoalKey)
        defaults.set(recoveryCompleted, forKey: recoveryCompletedKey)
        defaults.set(recoveryGoal, forKey: recoveryGoalKey)
        defaults.set(todaySteps, forKey: todayStepsKey)
        defaults.set(stepsGoal, forKey: stepsGoalKey)
        defaults.set(todayCalories, forKey: todayCaloriesKey)
        defaults.set(Date().timeIntervalSince1970, forKey: lastUpdatedKey)
    }

    // MARK: - Read (called from widget extension)

    static func readStreakData() -> WidgetStreakData {
        guard let defaults = shared else { return .empty }
        return WidgetStreakData(
            masterStreak: defaults.integer(forKey: masterStreakKey),
            liftsStreak: defaults.integer(forKey: liftsStreakKey),
            cardioStreak: defaults.integer(forKey: cardioStreakKey),
            recoveryStreak: defaults.integer(forKey: recoveryStreakKey),
            liftsCompleted: defaults.integer(forKey: liftsCompletedKey),
            liftsGoal: max(defaults.integer(forKey: liftsGoalKey), 1),
            cardioCompleted: defaults.integer(forKey: cardioCompletedKey),
            cardioGoal: max(defaults.integer(forKey: cardioGoalKey), 1),
            recoveryCompleted: defaults.integer(forKey: recoveryCompletedKey),
            recoveryGoal: max(defaults.integer(forKey: recoveryGoalKey), 1),
            todaySteps: defaults.integer(forKey: todayStepsKey),
            stepsGoal: defaults.integer(forKey: stepsGoalKey) > 0 ? defaults.integer(forKey: stepsGoalKey) : 10000,
            todayCalories: defaults.integer(forKey: todayCaloriesKey),
            lastUpdated: defaults.double(forKey: lastUpdatedKey)
        )
    }
}

// MARK: - Widget Data Model

struct WidgetStreakData {
    let masterStreak: Int
    let liftsStreak: Int
    let cardioStreak: Int
    let recoveryStreak: Int
    let liftsCompleted: Int
    let liftsGoal: Int
    let cardioCompleted: Int
    let cardioGoal: Int
    let recoveryCompleted: Int
    let recoveryGoal: Int
    let todaySteps: Int
    let stepsGoal: Int
    let todayCalories: Int
    let lastUpdated: Double

    var stepsProgress: Double {
        min(Double(todaySteps) / Double(stepsGoal), 1.0)
    }

    var liftsProgress: Double {
        min(Double(liftsCompleted) / Double(liftsGoal), 1.0)
    }

    var cardioProgress: Double {
        min(Double(cardioCompleted) / Double(cardioGoal), 1.0)
    }

    var recoveryProgress: Double {
        min(Double(recoveryCompleted) / Double(recoveryGoal), 1.0)
    }

    var totalCategoriesCompleted: Int {
        (liftsCompleted >= liftsGoal ? 1 : 0) +
        (cardioCompleted >= cardioGoal ? 1 : 0) +
        (recoveryCompleted >= recoveryGoal ? 1 : 0)
    }

    var overallProgress: Double {
        (liftsProgress + cardioProgress + recoveryProgress) / 3.0
    }

    static let empty = WidgetStreakData(
        masterStreak: 0, liftsStreak: 0, cardioStreak: 0, recoveryStreak: 0,
        liftsCompleted: 0, liftsGoal: 4,
        cardioCompleted: 0, cardioGoal: 3,
        recoveryCompleted: 0, recoveryGoal: 2,
        todaySteps: 0, stepsGoal: 10000, todayCalories: 0,
        lastUpdated: 0
    )
}
