import Foundation

// MARK: - Activity ID (handles both Int and String from Firestore)

enum ActivityID: Codable, Hashable {
    case int(Int)
    case string(String)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let intVal = try? container.decode(Int.self) {
            self = .int(intVal)
        } else if let doubleVal = try? container.decode(Double.self) {
            self = .int(Int(doubleVal))
        } else if let strVal = try? container.decode(String.self) {
            self = .string(strVal)
        } else {
            self = .int(Int(Date().timeIntervalSince1970 * 1000))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .int(let val):
            try container.encode(val)
        case .string(let val):
            try container.encode(val)
        }
    }

    static func newID() -> ActivityID {
        return .int(Int(Date().timeIntervalSince1970 * 1000))
    }
}

// MARK: - User Goals

struct UserGoals: Codable {
    var liftsPerWeek: Int
    var cardioPerWeek: Int
    var recoveryPerWeek: Int
    var stepsPerDay: Int
    var caloriesPerDay: Int

    static let defaults = UserGoals(
        liftsPerWeek: 4,
        cardioPerWeek: 3,
        recoveryPerWeek: 2,
        stepsPerDay: 10000,
        caloriesPerDay: 500
    )
}

// MARK: - User Streaks

struct UserStreaks: Codable {
    var master: Int
    var lifts: Int
    var cardio: Int
    var recovery: Int
    var stepsGoal: Int

    static let defaults = UserStreaks(
        master: 0,
        lifts: 0,
        cardio: 0,
        recovery: 0,
        stepsGoal: 0
    )
}

// MARK: - Personal Records

struct PersonalRecords: Codable {
    var longestMasterStreak: Int?
    var longestStrengthStreak: Int?
    var longestCardioStreak: Int?
    var longestRecoveryStreak: Int?
    var highestCalories: RecordEntry?
    var longestStrength: RecordEntry?
    var longestCardio: RecordEntry?
    var longestDistance: RecordEntry?
    var fastestPace: RecordEntry?
    var fastestCyclingPace: RecordEntry?
    var mostWorkoutsWeek: Int?
    var mostCaloriesWeek: Int?
    var mostMilesWeek: Int?

    static let defaults = PersonalRecords()
}

struct RecordEntry: Codable {
    var value: Double?
    var activityType: String?
}

// MARK: - Activity

struct Activity: Codable, Identifiable {
    var id: ActivityID
    var type: String
    var subtype: String?
    var date: String  // "YYYY-MM-DD"
    var time: String? // "H:MM AM/PM"
    var duration: Int?
    var calories: Int?
    var avgHr: Int?
    var maxHr: Int?
    var distance: Double?
    var source: String?
    var sourceDevice: String?
    var strengthType: String?
    var focusArea: String?
    var notes: String?
    var healthKitUUID: String?
    var linkedHealthKitUUID: String?
    var countToward: String?
    var customActivityCategory: String?
    var customEmoji: String?
    var sportEmoji: String?
    var fromAppleHealth: Bool?
    var healthKitSaved: Bool?
    var smartSaved: Bool?
    var appleWorkoutName: String?
    var photoURL: String?
    var isPhotoPrivate: Bool?

    enum CodingKeys: String, CodingKey {
        case id, type, subtype, date, time, duration, calories, avgHr, maxHr
        case distance, source, sourceDevice, strengthType, focusArea, notes
        case healthKitUUID, linkedHealthKitUUID, countToward, customActivityCategory
        case customEmoji, sportEmoji, fromAppleHealth, healthKitSaved, smartSaved
        case appleWorkoutName, photoURL, isPhotoPrivate
    }

    static func create(
        type: String,
        subtype: String? = nil,
        date: Date = Date(),
        duration: Int = 0,
        calories: Int? = nil,
        avgHr: Int? = nil,
        maxHr: Int? = nil,
        distance: Double? = nil,
        strengthType: String? = nil,
        focusArea: String? = nil,
        notes: String? = nil,
        healthKitUUID: String? = nil,
        countToward: String? = nil
    ) -> Activity {
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        let dateString = dateFormatter.string(from: date)

        let timeFormatter = DateFormatter()
        timeFormatter.dateFormat = "h:mm a"
        let timeString = timeFormatter.string(from: date)

        return Activity(
            id: .newID(),
            type: type,
            subtype: subtype,
            date: dateString,
            time: timeString,
            duration: duration,
            calories: calories,
            avgHr: avgHr,
            maxHr: maxHr,
            distance: distance,
            source: "apple-watch",
            sourceDevice: "Apple Watch",
            strengthType: strengthType,
            focusArea: focusArea,
            notes: notes,
            healthKitUUID: healthKitUUID,
            countToward: countToward
        )
    }
}

// MARK: - Custom Activity

struct CustomActivity: Codable, Identifiable {
    var id: String
    var name: String
    var category: String
    var emoji: String?
}
