import WidgetKit
import SwiftUI

// MARK: - Timeline Entry

struct DaySevenEntry: TimelineEntry {
    let date: Date
    let data: WidgetStreakData
}

// MARK: - Timeline Provider

struct DaySevenTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> DaySevenEntry {
        DaySevenEntry(date: .now, data: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (DaySevenEntry) -> Void) {
        let data = SharedDefaults.readStreakData()
        completion(DaySevenEntry(date: .now, data: data))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DaySevenEntry>) -> Void) {
        let data = SharedDefaults.readStreakData()
        let entry = DaySevenEntry(date: .now, data: data)
        // Refresh every 30 minutes (the app also triggers reloads on save)
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: .now)!
        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }
}

// MARK: - Placeholder data for widget gallery

extension WidgetStreakData {
    static let placeholder = WidgetStreakData(
        masterStreak: 7, liftsStreak: 12, cardioStreak: 9, recoveryStreak: 5,
        liftsCompleted: 3, liftsGoal: 4,
        cardioCompleted: 2, cardioGoal: 3,
        recoveryCompleted: 2, recoveryGoal: 2,
        todaySteps: 8432, stepsGoal: 10000, todayCalories: 347,
        lastUpdated: Date().timeIntervalSince1970
    )
}

// MARK: - Widget Colors (matching the watch app)

struct WidgetColors {
    static let strength = Color(red: 0.0, green: 1.0, blue: 0.58)    // #00FF94
    static let cardio = Color(red: 1.0, green: 0.58, blue: 0.0)      // #FF9500
    static let recovery = Color(red: 0.0, green: 0.82, blue: 1.0)    // #00D1FF
    static let streak = Color.yellow
    static let steps = Color.purple
    static let calories = Color.orange
}

// MARK: - Accessory Circular (three progress rings + overall %)

struct CircularComplicationView: View {
    let data: WidgetStreakData

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()

            // Recovery ring (outermost)
            Circle()
                .trim(from: 0, to: data.recoveryProgress)
                .stroke(WidgetColors.recovery, style: StrokeStyle(lineWidth: 4.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .padding(1.5)

            // Cardio ring (middle)
            Circle()
                .trim(from: 0, to: data.cardioProgress)
                .stroke(WidgetColors.cardio, style: StrokeStyle(lineWidth: 4.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .padding(6.5)

            // Strength ring (innermost)
            Circle()
                .trim(from: 0, to: data.liftsProgress)
                .stroke(WidgetColors.strength, style: StrokeStyle(lineWidth: 4.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .padding(11.5)

            // Center: master streak
            VStack(spacing: -2) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 7))
                    .foregroundColor(WidgetColors.streak)
                Text("\(data.masterStreak)")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
            }
        }
    }
}

// MARK: - Accessory Corner (three rings like Apple Fitness + steps/calories label)

struct CornerComplicationView: View {
    let data: WidgetStreakData

    private let ringSize: CGFloat = 30
    private let ringWidth: CGFloat = 3.5
    private let ringSpacing: CGFloat = 4

    var body: some View {
        ZStack {
            // Recovery (outermost)
            ringView(progress: data.recoveryProgress, color: WidgetColors.recovery, diameter: ringSize)
            // Cardio (middle)
            ringView(progress: data.cardioProgress, color: WidgetColors.cardio, diameter: ringSize - ringSpacing * 2)
            // Strength (innermost)
            ringView(progress: data.liftsProgress, color: WidgetColors.strength, diameter: ringSize - ringSpacing * 4)
        }
        .frame(width: ringSize, height: ringSize)
        .widgetLabel {
            ProgressView(value: data.stepsProgress) {
                Text("👟 \(formatSteps(data.todaySteps))")
            }
        }
    }

    private func ringView(progress: Double, color: Color, diameter: CGFloat) -> some View {
        ZStack {
            Circle()
                .stroke(color.opacity(0.2), lineWidth: ringWidth)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(color, style: StrokeStyle(lineWidth: ringWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: diameter, height: diameter)
    }

    private func formatSteps(_ steps: Int) -> String {
        if steps >= 1000 {
            return String(format: "%.1fk", Double(steps) / 1000.0)
        }
        return "\(steps)"
    }
}

// MARK: - Accessory Rectangular (streak badge + thicker progress bars)

struct RectangularComplicationView: View {
    let data: WidgetStreakData

    var body: some View {
        HStack(spacing: 6) {
            // Streak badge
            VStack(spacing: 1) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 12))
                    .foregroundColor(WidgetColors.streak)
                Text("\(data.masterStreak)")
                    .font(.system(size: 18, weight: .black, design: .rounded))
                Text("weeks")
                    .font(.system(size: 8))
                    .foregroundColor(.secondary)
            }
            .frame(width: 38)

            // Category progress bars
            VStack(alignment: .leading, spacing: 4) {
                CategoryBarView(
                    label: "STR",
                    completed: data.liftsCompleted,
                    goal: data.liftsGoal,
                    progress: data.liftsProgress,
                    color: WidgetColors.strength
                )
                CategoryBarView(
                    label: "CDO",
                    completed: data.cardioCompleted,
                    goal: data.cardioGoal,
                    progress: data.cardioProgress,
                    color: WidgetColors.cardio
                )
                CategoryBarView(
                    label: "REC",
                    completed: data.recoveryCompleted,
                    goal: data.recoveryGoal,
                    progress: data.recoveryProgress,
                    color: WidgetColors.recovery
                )
            }
        }
    }
}

struct CategoryBarView: View {
    let label: String
    let completed: Int
    let goal: Int
    let progress: Double
    let color: Color

    var body: some View {
        HStack(spacing: 3) {
            Text(label)
                .font(.system(size: 8, weight: .semibold, design: .rounded))
                .foregroundColor(.secondary)
                .frame(width: 22, alignment: .leading)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(color.opacity(0.25))
                        .frame(height: 7)

                    Capsule()
                        .fill(color)
                        .frame(width: geo.size.width * progress, height: 7)
                }
            }
            .frame(height: 7)

            Text("\(completed)/\(goal)")
                .font(.system(size: 8, weight: .medium, design: .rounded))
                .foregroundColor(completed >= goal ? color : .secondary)
                .frame(width: 18, alignment: .trailing)
        }
    }
}

// MARK: - Accessory Inline (single line text)

struct InlineComplicationView: View {
    let data: WidgetStreakData

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "flame.fill")
            Text("\(data.totalCategoriesCompleted)/3 goals")
            Text("\u{00B7}")
            Text("\(formatSteps(data.todaySteps)) steps")
        }
    }

    private func formatSteps(_ steps: Int) -> String {
        if steps >= 1000 {
            return String(format: "%.1fk", Double(steps) / 1000.0)
        }
        return "\(steps)"
    }
}

// MARK: - Widget Definition

@main
struct DaySevenWidgets: Widget {
    let kind = "DaySevenComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DaySevenTimelineProvider()) { entry in
            DaySevenWidgetEntryView(entry: entry)
                .containerBackground(.black, for: .widget)
        }
        .configurationDisplayName("DaySeven")
        .description("Track your weekly workout goals and daily activity.")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryCorner,
            .accessoryRectangular,
            .accessoryInline
        ])
    }
}

// MARK: - Entry View (routes to correct complication)

struct DaySevenWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: DaySevenEntry

    var body: some View {
        switch family {
        case .accessoryCircular:
            CircularComplicationView(data: entry.data)
        case .accessoryCorner:
            CornerComplicationView(data: entry.data)
        case .accessoryRectangular:
            RectangularComplicationView(data: entry.data)
        case .accessoryInline:
            InlineComplicationView(data: entry.data)
        default:
            CircularComplicationView(data: entry.data)
        }
    }
}

// MARK: - Previews

#Preview("Circular", as: .accessoryCircular) {
    DaySevenWidgets()
} timeline: {
    DaySevenEntry(date: .now, data: .placeholder)
}

#Preview("Corner", as: .accessoryCorner) {
    DaySevenWidgets()
} timeline: {
    DaySevenEntry(date: .now, data: .placeholder)
}

#Preview("Rectangular", as: .accessoryRectangular) {
    DaySevenWidgets()
} timeline: {
    DaySevenEntry(date: .now, data: .placeholder)
}

#Preview("Inline", as: .accessoryInline) {
    DaySevenWidgets()
} timeline: {
    DaySevenEntry(date: .now, data: .placeholder)
}
