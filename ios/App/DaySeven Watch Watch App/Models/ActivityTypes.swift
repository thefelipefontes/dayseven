import Foundation
import HealthKit

// MARK: - Activity Category

enum ActivityCategoryType: String {
    case strength = "Strength"
    case cardio = "Cardio"
    case recovery = "Recovery"
}

// MARK: - Activity Type Definition

struct ActivityTypeDefinition: Identifiable {
    let id = UUID()
    let name: String
    let emoji: String
    let sfSymbol: String
    let subtypes: [String]
    let category: ActivityCategoryType
    let strengthTypes: [String]?
    let focusAreas: [String]?
    let isHybrid: Bool

    init(name: String, emoji: String, sfSymbol: String, subtypes: [String] = [], category: ActivityCategoryType,
         strengthTypes: [String]? = nil, focusAreas: [String]? = nil, isHybrid: Bool = false) {
        self.name = name
        self.emoji = emoji
        self.sfSymbol = sfSymbol
        self.subtypes = subtypes
        self.category = category
        self.strengthTypes = strengthTypes
        self.focusAreas = focusAreas
        self.isHybrid = isHybrid
    }
}

// MARK: - All Activity Types (matches iOS App.jsx)

struct ActivityTypes {
    static let strengthFocusAreas = [
        "Full Body", "Upper", "Lower", "Chest", "Back", "Legs", "Shoulders", "Biceps", "Triceps", "Abs"
    ]

    static let all: [ActivityTypeDefinition] = [
        // Strength
        ActivityTypeDefinition(
            name: "Strength Training",
            emoji: "\u{1F3CB}\u{FE0F}",
            sfSymbol: "dumbbell.fill",
            subtypes: [],
            category: .strength,
            strengthTypes: ["Lifting", "Bodyweight"],
            focusAreas: strengthFocusAreas
        ),

        // Cardio
        ActivityTypeDefinition(
            name: "Running",
            emoji: "\u{1F3C3}",
            sfSymbol: "figure.run",
            subtypes: ["Outdoor", "Indoor"],
            category: .cardio
        ),
        ActivityTypeDefinition(
            name: "Cycle",
            emoji: "\u{1F6B4}",
            sfSymbol: "figure.indoor.cycle",
            subtypes: ["Outdoor", "Indoor"],
            category: .cardio
        ),
        ActivityTypeDefinition(
            name: "Sports",
            emoji: "\u{1F3C0}",
            sfSymbol: "figure.basketball",
            subtypes: ["Basketball", "Soccer", "Football", "Tennis", "Golf", "Other"],
            category: .cardio
        ),
        ActivityTypeDefinition(
            name: "Stair Climbing",
            emoji: "\u{1FA9C}",
            sfSymbol: "figure.stair.stepper",
            subtypes: [],
            category: .cardio
        ),
        ActivityTypeDefinition(
            name: "Elliptical",
            emoji: "\u{1F3C3}\u{200D}\u{2642}\u{FE0F}",
            sfSymbol: "figure.elliptical",
            subtypes: [],
            category: .cardio
        ),
        ActivityTypeDefinition(
            name: "Walking",
            emoji: "\u{1F6B6}",
            sfSymbol: "figure.walk",
            subtypes: ["Outdoor", "Indoor"],
            category: .cardio
        ),

        // Recovery
        ActivityTypeDefinition(
            name: "Yoga",
            emoji: "\u{1F9D8}",
            sfSymbol: "figure.yoga",
            subtypes: [],
            category: .recovery,
            isHybrid: true
        ),
        ActivityTypeDefinition(
            name: "Pilates",
            emoji: "\u{1F938}",
            sfSymbol: "figure.pilates",
            subtypes: [],
            category: .recovery,
            isHybrid: true
        ),
        ActivityTypeDefinition(
            name: "Cold Plunge",
            emoji: "\u{1F9CA}",
            sfSymbol: "snowflake",
            subtypes: [],
            category: .recovery
        ),
        ActivityTypeDefinition(
            name: "Sauna",
            emoji: "\u{1F525}",
            sfSymbol: "flame.fill",
            subtypes: [],
            category: .recovery
        ),
    ]

    static func forCategory(_ category: ActivityCategoryType) -> [ActivityTypeDefinition] {
        return all.filter { $0.category == category }
    }

    // MARK: - Activity Categorization (matches App.jsx line 17141)

    static func getActivityCategory(_ activity: Activity) -> String {
        // Priority 1: countToward override
        if let countToward = activity.countToward, !countToward.isEmpty {
            if countToward == "strength" { return "lifting" }
            return countToward
        }
        // Priority 2: Custom activity category
        if let customCat = activity.customActivityCategory, !customCat.isEmpty {
            if customCat == "strength" { return "lifting" }
            return customCat
        }
        // Priority 3: Type-based defaults
        switch activity.type {
        case "Strength Training":
            return "lifting"
        case "Running", "Cycle", "Sports", "Stair Climbing", "Elliptical":
            return "cardio"
        case "Cold Plunge", "Sauna", "Yoga", "Pilates":
            return "recovery"
        default:
            return "other"
        }
    }

    // MARK: - Default countToward for hybrid activities

    static func getDefaultCountToward(type: String, subtype: String?, countToward: String? = nil) -> String? {
        // If an explicit countToward was provided (e.g. from hybrid picker), use it
        if let ct = countToward, !ct.isEmpty { return ct }
        switch type {
        case "Yoga", "Pilates":
            return "recovery"
        default:
            return nil
        }
    }

    /// The hybrid categories that Yoga/Pilates can count toward
    static let hybridCountTowardOptions = ["Recovery", "Cardio", "Strength"]

    // MARK: - HKWorkoutActivityType Mapping (matches HealthKitWriterPlugin.swift line 795)

    static func mapToHKActivityType(_ type: String, subtype: String? = nil) -> HKWorkoutActivityType {
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
        case "stair climbing", "stairclimbing":
            return .stairClimbing

        // Strength
        case "strength training", "lifting", "bodyweight":
            return .traditionalStrengthTraining
        case "hiit":
            return .highIntensityIntervalTraining
        case "core training", "core":
            return .coreTraining
        case "cross training":
            return .crossTraining

        // Mind & Body / Recovery
        case "yoga":
            return .yoga
        case "pilates":
            return .pilates
        case "cold plunge", "sauna":
            return .preparationAndRecovery

        // Sports
        case "sports":
            switch (subtype ?? "").lowercased() {
            case "basketball": return .basketball
            case "soccer": return .soccer
            case "football": return .americanFootball
            case "tennis": return .tennis
            case "golf": return .golf
            default: return .other
            }

        default:
            return .other
        }
    }

    // MARK: - Sports emoji mapping

    static func sportsEmoji(for sport: String) -> String {
        switch sport {
        case "Basketball": return "\u{1F3C0}"
        case "Soccer": return "\u{26BD}"
        case "Football": return "\u{1F3C8}"
        case "Tennis": return "\u{1F3BE}"
        case "Golf": return "\u{26F3}"
        default: return "\u{1F3C0}"
        }
    }
}
