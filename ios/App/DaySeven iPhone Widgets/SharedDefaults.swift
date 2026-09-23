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
    static let recentActivitiesKey = "recentActivities"
    static let daysLeftInWeekKey = "daysLeftInWeek"
    static let injuryModeActiveKey = "injuryModeActive"
    static let weekStepsKey = "weekSteps"
    static let weekStartDateKey = "weekStartDate"
    static let showCaloriesKey = "showCalories"

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
        todaySteps: Int, stepsGoal: Int, todayCalories: Int,
        injuryModeActive: Bool = false
    ) {
        guard let defaults = shared else { return }
        defaults.set(injuryModeActive, forKey: injuryModeActiveKey)
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
            daysLeftInWeek: defaults.integer(forKey: daysLeftInWeekKey),
            lastUpdated: defaults.double(forKey: lastUpdatedKey),
            injuryModeActive: defaults.bool(forKey: injuryModeActiveKey),
            recentActivities: Self.readRecentActivities(from: defaults),
            weekSteps: defaults.integer(forKey: weekStepsKey),
            weekStartDate: defaults.string(forKey: weekStartDateKey) ?? "",
            showCalories: defaults.bool(forKey: showCaloriesKey)
        ).rolledOverIfNewWeek()
    }
    private static func readRecentActivities(from defaults: UserDefaults) -> [WidgetActivity] {
        guard let jsonStrings = defaults.stringArray(forKey: recentActivitiesKey) else { return [] }
        return jsonStrings.compactMap { jsonString in
            guard let data = jsonString.data(using: .utf8),
                  let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
            return WidgetActivity(
                name: dict["name"] as? String ?? "",
                category: dict["category"] as? String ?? "other",
                date: dict["date"] as? String ?? "",
                duration: dict["duration"] as? Int ?? 0,
                calories: dict["calories"] as? Int ?? 0
            )
        }
    }
}

// MARK: - Widget Activity Model

struct WidgetActivity {
    let name: String
    let category: String  // "lifting", "cardio", "recovery"
    let date: String      // "YYYY-MM-DD"
    let duration: Int     // minutes
    let calories: Int
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
    let daysLeftInWeek: Int
    let lastUpdated: Double
    let injuryModeActive: Bool
    let recentActivities: [WidgetActivity]
    let weekSteps: Int
    let weekStartDate: String   // "YYYY-MM-DD", the Sunday of the week the app last wrote
    let showCalories: Bool      // mirrors the app's "Active calories on Home" setting

    // MARK: Week, computed from the clock rather than the last app write, so the widget
    // stays right on days the app isn't opened. The app's week runs Sunday–Saturday.

    private static var weekCalendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        return cal
    }

    /// Days of this week already finished (Sunday = 0 … Saturday = 6).
    static var finishedDaysThisWeek: Int {
        weekCalendar.component(.weekday, from: Date()) - 1
    }

    static var currentWeekStartKey: String {
        let cal = weekCalendar
        let start = cal.date(byAdding: .day, value: -finishedDaysThisWeek, to: cal.startOfDay(for: Date())) ?? Date()
        let c = cal.dateComponents([.year, .month, .day], from: start)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Days left including today.
    var daysLeftThisWeek: Int { 7 - Self.finishedDaysThisWeek }

    var weekStepsGoal: Int { stepsGoal * 7 }

    /// Week steps vs. the daily goal × finished days. Today can only put you ahead.
    var stepsAheadBy: Int { weekSteps - stepsGoal * Self.finishedDaysThisWeek }

    /// Last write was for an earlier week (the app wasn't opened since Sunday): this week
    /// starts from zero instead of showing last week's rings and steps.
    func rolledOverIfNewWeek() -> WidgetStreakData {
        guard !weekStartDate.isEmpty, weekStartDate != Self.currentWeekStartKey else { return self }
        return WidgetStreakData(
            masterStreak: masterStreak, liftsStreak: liftsStreak, cardioStreak: cardioStreak, recoveryStreak: recoveryStreak,
            liftsCompleted: 0, liftsGoal: liftsGoal,
            cardioCompleted: 0, cardioGoal: cardioGoal,
            recoveryCompleted: 0, recoveryGoal: recoveryGoal,
            todaySteps: 0, stepsGoal: stepsGoal, todayCalories: 0,
            daysLeftInWeek: daysLeftInWeek, lastUpdated: lastUpdated,
            injuryModeActive: injuryModeActive, recentActivities: recentActivities,
            weekSteps: 0, weekStartDate: Self.currentWeekStartKey, showCalories: showCalories
        )
    }

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
        daysLeftInWeek: 0,
        lastUpdated: 0,
        injuryModeActive: false,
        recentActivities: [],
        weekSteps: 0, weekStartDate: "", showCalories: false
    )
}
