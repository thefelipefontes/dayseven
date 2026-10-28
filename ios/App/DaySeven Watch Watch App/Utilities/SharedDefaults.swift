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
    static let weekStepsKey = "weekSteps"
    static let stepsGoalKey = "stepsGoal"
    static let todayCaloriesKey = "todayCalories"
    static let lastUpdatedKey = "lastUpdated"
    static let injuryModeActiveKey = "injuryModeActive"
    /// Sunday 00:00 of the week the stored progress belongs to (seconds since 1970)
    static let weekStartKey = "weekStart"

    // Distance unit preference ('mi' | 'km'). Mirrored from the phone via WCSession
    // applicationContext + watch-side Firestore load. Widgets can read for distance
    // display when they eventually surface it.
    static let distanceUnitKey = "distanceUnit"

    // Celebration tracking keys (used by CelebrationManager)
    static let dailyGoalsCelebratedKey = "dailyGoalsCelebrated"
    static let weekCategoryCelebratedKey = "weekCategoryCelebrated"

    static var shared: UserDefaults? {
        UserDefaults(suiteName: suiteName)
    }

    /// Read the user's distance-unit preference. Defaults to "mi" if not set.
    static func readDistanceUnit() -> String {
        guard let defaults = shared else { return "mi" }
        let raw = defaults.string(forKey: distanceUnitKey)
        return raw == "km" ? "km" : "mi"
    }

    /// Persist the user's distance-unit preference.
    static func writeDistanceUnit(_ unit: String) {
        guard let defaults = shared else { return }
        defaults.set(unit == "km" ? "km" : "mi", forKey: distanceUnitKey)
    }

    // MARK: - Weeks

    /// Sunday 00:00 of the week containing `date`. The phone's weeks run Sunday to Saturday.
    static func weekStart(containing date: Date) -> Date {
        let calendar = Calendar.current
        let day = calendar.startOfDay(for: date)
        let weekday = calendar.component(.weekday, from: day) // 1 = Sunday
        return calendar.date(byAdding: .day, value: -(weekday - 1), to: day) ?? day
    }

    /// Sunday 00:00 of the week after the one containing `date`.
    static func nextWeekStart(after date: Date) -> Date {
        let start = weekStart(containing: date)
        return Calendar.current.date(byAdding: .day, value: 7, to: start) ?? start.addingTimeInterval(7 * 86_400)
    }

    // MARK: - Write (called from watch app after data loads / activity saves)

    /// What a write changed, as far as the complications can show it.
    enum WidgetDataChange {
        case none
        /// Only the week's step count moved (it moves all day)
        case steps
        /// Rings, goals, streak or the week itself changed
        case other
    }

    @discardableResult
    static func writeStreakData(
        masterStreak: Int, liftsStreak: Int, cardioStreak: Int, recoveryStreak: Int,
        liftsCompleted: Int, liftsGoal: Int,
        cardioCompleted: Int, cardioGoal: Int,
        recoveryCompleted: Int, recoveryGoal: Int,
        todaySteps: Int, stepsGoal: Int, todayCalories: Int,
        weekSteps: Int = 0,
        injuryModeActive: Bool = false
    ) -> WidgetDataChange {
        guard let defaults = shared else { return .none }
        let weekStart = weekStart(containing: Date()).timeIntervalSince1970

        // Compare what the complications draw before overwriting it
        let drawnBefore: [AnyHashable] = [
            defaults.integer(forKey: masterStreakKey), defaults.integer(forKey: liftsCompletedKey),
            defaults.integer(forKey: liftsGoalKey), defaults.integer(forKey: cardioCompletedKey),
            defaults.integer(forKey: cardioGoalKey), defaults.integer(forKey: stepsGoalKey),
            defaults.bool(forKey: injuryModeActiveKey), defaults.double(forKey: weekStartKey)
        ]
        let drawnAfter: [AnyHashable] = [
            masterStreak, liftsCompleted, liftsGoal, cardioCompleted, cardioGoal, stepsGoal,
            injuryModeActive, weekStart
        ]
        let change: WidgetDataChange = drawnBefore != drawnAfter ? .other
            : defaults.integer(forKey: weekStepsKey) != weekSteps ? .steps
            : .none

        defaults.set(weekStart, forKey: weekStartKey)
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
        defaults.set(weekSteps, forKey: weekStepsKey)
        defaults.set(Date().timeIntervalSince1970, forKey: lastUpdatedKey)
        return change
    }

    // MARK: - Read (called from widget extension)

    /// The stored data as it stands at `date`. Progress written in an earlier week reads as
    /// zero: the week rolls over at Sunday midnight whether or not the watch app has run
    /// since, and showing last week's rings until it does made a fresh week look done.
    /// Streak counts carry over (a streak only ends when a week is judged, on the phone).
    static func readStreakData(asOf date: Date = Date()) -> WidgetStreakData {
        guard let defaults = shared else { return .empty }
        let lastUpdated = defaults.double(forKey: lastUpdatedKey)
        // Builds before weekStart existed: the last write happened in the data's own week
        let storedWeek = defaults.double(forKey: weekStartKey)
        let dataWeek = storedWeek > 0 ? storedWeek : lastUpdated
        let sameWeek = dataWeek >= weekStart(containing: date).timeIntervalSince1970
        let sameDay = lastUpdated >= Calendar.current.startOfDay(for: date).timeIntervalSince1970

        return WidgetStreakData(
            masterStreak: defaults.integer(forKey: masterStreakKey),
            liftsStreak: defaults.integer(forKey: liftsStreakKey),
            cardioStreak: defaults.integer(forKey: cardioStreakKey),
            recoveryStreak: defaults.integer(forKey: recoveryStreakKey),
            liftsCompleted: sameWeek ? defaults.integer(forKey: liftsCompletedKey) : 0,
            liftsGoal: max(defaults.integer(forKey: liftsGoalKey), 1),
            cardioCompleted: sameWeek ? defaults.integer(forKey: cardioCompletedKey) : 0,
            cardioGoal: max(defaults.integer(forKey: cardioGoalKey), 1),
            recoveryCompleted: sameWeek ? defaults.integer(forKey: recoveryCompletedKey) : 0,
            recoveryGoal: max(defaults.integer(forKey: recoveryGoalKey), 1),
            todaySteps: sameDay ? defaults.integer(forKey: todayStepsKey) : 0,
            stepsGoal: defaults.integer(forKey: stepsGoalKey) > 0 ? defaults.integer(forKey: stepsGoalKey) : 10000,
            todayCalories: sameDay ? defaults.integer(forKey: todayCaloriesKey) : 0,
            weekSteps: sameWeek ? defaults.integer(forKey: weekStepsKey) : 0,
            lastUpdated: lastUpdated,
            injuryModeActive: defaults.bool(forKey: injuryModeActiveKey)
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
    let weekSteps: Int          // Sunday → now; the Steps ring (stepsGoal × 7)
    let lastUpdated: Double
    let injuryModeActive: Bool

    var weekStepsGoal: Int { stepsGoal * 7 }

    var weekStepsProgress: Double {
        weekStepsGoal > 0 ? min(Double(weekSteps) / Double(weekStepsGoal), 1.0) : 0
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

    // The three goal rings: Strength, Cardio, weekly Steps (Recovery is a bonus, not a ring).
    var totalCategoriesCompleted: Int {
        (liftsCompleted >= liftsGoal ? 1 : 0) +
        (cardioCompleted >= cardioGoal ? 1 : 0) +
        (weekSteps >= weekStepsGoal ? 1 : 0)
    }

    var overallProgress: Double {
        (liftsProgress + cardioProgress + weekStepsProgress) / 3.0
    }

    static let empty = WidgetStreakData(
        masterStreak: 0, liftsStreak: 0, cardioStreak: 0, recoveryStreak: 0,
        liftsCompleted: 0, liftsGoal: 4,
        cardioCompleted: 0, cardioGoal: 3,
        recoveryCompleted: 0, recoveryGoal: 2,
        todaySteps: 0, stepsGoal: 10000, todayCalories: 0,
        weekSteps: 0,
        lastUpdated: 0,
        injuryModeActive: false
    )
}
