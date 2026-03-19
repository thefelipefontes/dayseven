import ActivityKit
import Foundation

struct WorkoutActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var isPaused: Bool
        var accumulatedPauseTime: Double = 0
    }

    // Static context (set at start, never changes)
    var activityType: String
    var activityIcon: String
    var startTime: Date
    var categoryColor: String // "strength", "cardio", "recovery"

    // Custom Codable to encode startTime as timeIntervalSince1970
    // (matches the JSON payload from APNs push-to-start)
    enum CodingKeys: String, CodingKey {
        case activityType, activityIcon, startTime, categoryColor
    }

    init(activityType: String, activityIcon: String, startTime: Date, categoryColor: String) {
        self.activityType = activityType
        self.activityIcon = activityIcon
        self.startTime = startTime
        self.categoryColor = categoryColor
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        activityType = try container.decode(String.self, forKey: .activityType)
        activityIcon = try container.decode(String.self, forKey: .activityIcon)
        let timestamp = try container.decode(Double.self, forKey: .startTime)
        startTime = Date(timeIntervalSince1970: timestamp)
        categoryColor = try container.decode(String.self, forKey: .categoryColor)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(activityType, forKey: .activityType)
        try container.encode(activityIcon, forKey: .activityIcon)
        try container.encode(startTime.timeIntervalSince1970, forKey: .startTime)
        try container.encode(categoryColor, forKey: .categoryColor)
    }
}
