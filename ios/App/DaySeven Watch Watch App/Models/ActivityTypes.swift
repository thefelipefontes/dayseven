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
    let name: String          // Data key — stored in Firestore (e.g. "Weightlifting")
    let displayName: String   // Short label for UI (e.g. "Weights")
    let emoji: String
    let sfSymbol: String
    let subtypes: [String]
    let category: ActivityCategoryType
    let strengthTypes: [String]?
    let focusAreas: [String]?
    let isHybrid: Bool

    init(name: String, displayName: String? = nil, emoji: String, sfSymbol: String, subtypes: [String] = [], category: ActivityCategoryType,
         strengthTypes: [String]? = nil, focusAreas: [String]? = nil, isHybrid: Bool = false) {
        self.name = name
        self.displayName = displayName ?? name
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
        // Strength (flattened — matches web app)
        ActivityTypeDefinition(
            name: "Weightlifting",
            displayName: "Weights",
            emoji: "\u{1F3CB}\u{FE0F}",
            sfSymbol: "dumbbell.fill",
            subtypes: [],
            category: .strength,
            focusAreas: strengthFocusAreas
        ),
        ActivityTypeDefinition(
            name: "Bodyweight",
            emoji: "\u{1F4AA}",
            sfSymbol: "figure.strengthtraining.functional",
            subtypes: [],
            category: .strength,
            focusAreas: strengthFocusAreas
        ),
        ActivityTypeDefinition(
            name: "Circuit",
            emoji: "\u{1F504}",
            sfSymbol: "arrow.triangle.2.circlepath",
            subtypes: [],
            category: .strength,
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
            name: "Swimming",
            emoji: "\u{1F3CA}",
            sfSymbol: "figure.pool.swim",
            subtypes: ["Pool", "Open Water"],
            category: .cardio
        ),
        ActivityTypeDefinition(
            name: "Rowing",
            emoji: "\u{1F6A3}",
            sfSymbol: "figure.rower",
            subtypes: [],
            category: .cardio
        ),
        ActivityTypeDefinition(
            name: "Ski Trainer",
            emoji: "\u{26F7}\u{FE0F}",
            sfSymbol: "figure.skiing.crosscountry",
            subtypes: [],
            category: .cardio
        ),
        ActivityTypeDefinition(
            name: "Walking",
            emoji: "\u{1F6B6}",
            sfSymbol: "figure.walk",
            subtypes: ["Outdoor", "Indoor"],
            category: .cardio,
            isHybrid: true
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
        ActivityTypeDefinition(
            name: "Contrast Therapy",
            emoji: "\u{1F4A7}",
            sfSymbol: "drop.halffull",
            subtypes: [],
            category: .recovery
        ),
        ActivityTypeDefinition(
            name: "Massage",
            emoji: "\u{1F486}",
            sfSymbol: "figure.mind.and.body",
            subtypes: [],
            category: .recovery
        ),
        ActivityTypeDefinition(
            name: "Chiropractic",
            emoji: "\u{1F9B4}",
            sfSymbol: "figure.flexibility",
            subtypes: [],
            category: .recovery
        ),
    ]

    static func forCategory(_ category: ActivityCategoryType) -> [ActivityTypeDefinition] {
        return all.filter { $0.category == category }
    }

    // MARK: - Activity Categorization (matches App.jsx line 17141)

    // Type -> goal category tables. These MUST mirror src/utils/activityCategory.js, the
    // single source of truth on the phone. When they drift, the watch quietly drops whole
    // activity types into "other" and the rings under-count against the phone's — a
    // Hiking or Tennis session filling the cardio ring on the phone and nothing here.
    private static let teamSports: Set<String> = [
        "Basketball", "Soccer", "Football", "Tennis", "Golf", "Badminton", "Boxing", "Martial Arts",
        "Baseball", "Volleyball", "Hockey", "Lacrosse", "Rugby", "Softball", "Squash", "Table Tennis",
        "Racquetball", "Handball", "Pickleball", "Cricket", "Australian Football", "Wrestling",
        "Fencing", "Curling", "Bowling",
    ]

    private static let individualCardioSports: Set<String> = [
        "Track & Field", "Jump Rope", "Downhill Skiing", "Cross Country Skiing", "Snowboarding",
        "Skating", "Surfing", "Water Polo", "Paddle Sports",
    ]

    private static let liftingTypes: Set<String> = ["Strength Training", "Weightlifting", "Bodyweight"]

    private static let cardioTypes: Set<String> = [
        "Running", "Cycle", "Sports", "Stair Climbing", "Elliptical", "Rowing", "Ski Trainer",
        "Swimming", "Hiking", "Dance",
    ]

    private static let recoveryTypes: Set<String> = [
        "Pilates", "Cold Plunge", "Sauna", "Contrast Therapy", "Massage", "Chiropractic",
        "Stretching", "Foam Rolling", "Tai Chi", "Cooldown",
    ]

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
        if liftingTypes.contains(activity.type) { return "lifting" }
        if activity.type == "Circuit" { return "lifting+cardio" }
        if cardioTypes.contains(activity.type) { return "cardio" }
        if teamSports.contains(activity.type) { return "cardio" }
        if individualCardioSports.contains(activity.type) { return "cardio" }
        if activity.type == "Yoga" {
            // Power/Hot/Vinyasa are worked hard enough to count as cardio.
            let sub = activity.subtype ?? ""
            return ["Power", "Hot", "Vinyasa"].contains(sub) ? "cardio" : "recovery"
        }
        if recoveryTypes.contains(activity.type) { return "recovery" }
        // Walking and anything unrecognised fill no ring.
        return "other"
    }

    // MARK: - Default countToward for hybrid activities

    static func getDefaultCountToward(type: String, subtype: String?, countToward: String? = nil) -> String? {
        // If an explicit countToward was provided (e.g. from hybrid picker), use it
        if let ct = countToward, !ct.isEmpty { return ct }
        switch type {
        case "Weightlifting", "Bodyweight":
            return "lifting"
        case "Circuit":
            return "lifting+cardio"
        case "Yoga", "Pilates":
            return "recovery"
        default:
            return nil
        }
    }

    /// The hybrid categories that Yoga/Pilates can count toward
    static let hybridCountTowardOptions = ["Recovery", "Cardio", "Strength"]

    /// Circuit training count-toward options (defaults to both)
    static let circuitCountTowardOptions = ["Strength + Cardio", "Strength", "Cardio"]

    /// Map circuit picker display value to stored countToward value
    static func circuitCountTowardValue(_ display: String) -> String {
        switch display {
        case "Strength + Cardio": return "lifting+cardio"
        case "Strength": return "lifting"
        case "Cardio": return "cardio"
        default: return "lifting+cardio"
        }
    }

    /// Map stored countToward value to circuit picker display value
    static func circuitCountTowardDisplay(_ value: String?) -> String {
        switch value {
        case "lifting": return "Strength"
        case "cardio": return "Cardio"
        default: return "Strength + Cardio"
        }
    }

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
        case "rowing":
            return .rowing
        case "ski trainer":
            return .crossCountrySkiing

        // Strength
        case "strength training", "weightlifting", "lifting", "bodyweight", "circuit":
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
        case "cold plunge", "sauna", "contrast therapy", "massage", "chiropractic":
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
