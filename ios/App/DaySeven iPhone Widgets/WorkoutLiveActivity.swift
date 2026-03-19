import ActivityKit
import WidgetKit
import SwiftUI

// MARK: - ActivityKit Attributes

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

// MARK: - Category Color Helper

private func colorForCategory(_ category: String) -> Color {
    switch category {
    case "strength":
        return WidgetColors.strength
    case "cardio":
        return WidgetColors.cardio
    case "recovery":
        return WidgetColors.recovery
    default:
        return WidgetColors.cardio
    }
}

// MARK: - Lock Screen View

@available(iOS 16.1, *)
struct WorkoutLockScreenView: View {
    let context: ActivityViewContext<WorkoutActivityAttributes>

    var body: some View {
        HStack(spacing: 14) {
            // Activity icon + name
            HStack(spacing: 8) {
                Image(systemName: context.attributes.activityIcon)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(colorForCategory(context.attributes.categoryColor))

                VStack(alignment: .leading, spacing: 2) {
                    Text(context.attributes.activityType)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundColor(.white)
                        .lineLimit(1)

                    if context.state.isPaused {
                        Text("Paused")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.secondary)
                    } else {
                        Text("In Progress")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(colorForCategory(context.attributes.categoryColor))
                    }
                }
            }

            Spacer()

            // Timer
            if context.state.isPaused {
                Image(systemName: "pause.fill")
                    .font(.system(size: 24))
                    .foregroundColor(.secondary)
            } else {
                Text(context.attributes.startTime.addingTimeInterval(context.state.accumulatedPauseTime), style: .timer)
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                    .foregroundColor(colorForCategory(context.attributes.categoryColor))
                    .monospacedDigit()
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
        .activityBackgroundTint(Color.black.opacity(0.8))
    }
}

// MARK: - Live Activity Widget

@available(iOS 16.1, *)
struct WorkoutLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutActivityAttributes.self) { context in
            WorkoutLockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded: leading
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        Image(systemName: context.attributes.activityIcon)
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundColor(colorForCategory(context.attributes.categoryColor))
                        Text(context.attributes.activityType)
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                            .foregroundColor(.white)
                            .lineLimit(1)
                    }
                }

                // Expanded: trailing
                DynamicIslandExpandedRegion(.trailing) {
                    if context.state.isPaused {
                        Image(systemName: "pause.fill")
                            .font(.system(size: 20))
                            .foregroundColor(.secondary)
                    } else {
                        Text(context.attributes.startTime.addingTimeInterval(context.state.accumulatedPauseTime), style: .timer)
                            .font(.system(size: 20, weight: .bold, design: .rounded))
                            .foregroundColor(colorForCategory(context.attributes.categoryColor))
                            .monospacedDigit()
                    }
                }

                // Expanded: bottom
                DynamicIslandExpandedRegion(.bottom) {
                    if context.state.isPaused {
                        Text("Workout Paused")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(.secondary)
                    }
                }
            } compactLeading: {
                Image(systemName: context.attributes.activityIcon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(colorForCategory(context.attributes.categoryColor))
            } compactTrailing: {
                if context.state.isPaused {
                    Image(systemName: "pause.fill")
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                } else {
                    Text(context.attributes.startTime.addingTimeInterval(context.state.accumulatedPauseTime), style: .timer)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundColor(colorForCategory(context.attributes.categoryColor))
                        .monospacedDigit()
                }
            } minimal: {
                Image(systemName: context.attributes.activityIcon)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(colorForCategory(context.attributes.categoryColor))
            }
        }
    }
}
