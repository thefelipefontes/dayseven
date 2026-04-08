import WidgetKit
import SwiftUI

// MARK: - Timeline Entry

struct DaySevenPhoneEntry: TimelineEntry {
    let date: Date
    let data: WidgetStreakData
}

// MARK: - Timeline Provider

struct DaySevenPhoneTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> DaySevenPhoneEntry {
        DaySevenPhoneEntry(date: .now, data: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (DaySevenPhoneEntry) -> Void) {
        let data = SharedDefaults.readStreakData()
        completion(DaySevenPhoneEntry(date: .now, data: data))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DaySevenPhoneEntry>) -> Void) {
        let data = SharedDefaults.readStreakData()
        let entry = DaySevenPhoneEntry(date: .now, data: data)
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
        daysLeftInWeek: 3,
        lastUpdated: Date().timeIntervalSince1970,
        recentActivities: [
            WidgetActivity(name: "Push Day", category: "lifting", date: "2026-03-19", duration: 55, calories: 320),
            WidgetActivity(name: "Running", category: "cardio", date: "2026-03-18", duration: 32, calories: 285),
            WidgetActivity(name: "Cold Plunge", category: "recovery", date: "2026-03-18", duration: 5, calories: 0),
            WidgetActivity(name: "Pull Day", category: "lifting", date: "2026-03-17", duration: 48, calories: 290),
            WidgetActivity(name: "Yoga", category: "recovery", date: "2026-03-16", duration: 30, calories: 120)
        ]
    )
}

// MARK: - Widget Colors

struct WidgetColors {
    static let strength = Color(red: 0.0, green: 1.0, blue: 0.58)    // #00FF94
    static let cardio = Color(red: 1.0, green: 0.58, blue: 0.0)      // #FF9500
    static let recovery = Color(red: 0.0, green: 0.82, blue: 1.0)    // #00D1FF
    static let streak = Color.yellow
    static let steps = Color.purple
    static let calories = Color.orange
    static let background = Color(red: 0.078, green: 0.078, blue: 0.078)
}

// MARK: - Progress Ring View (reusable)

struct ProgressRingView: View {
    let progress: Double
    let color: Color
    let lineWidth: CGFloat
    let diameter: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .stroke(color.opacity(0.2), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: min(progress, 1.0))
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: diameter, height: diameter)
    }
}

// MARK: - Category Ring (matches app style)

struct CategoryRingView: View {
    let completed: Int
    let goal: Int
    let progress: Double
    let color: Color
    let size: CGFloat
    let lineWidth: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .stroke(color.opacity(0.2), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: min(progress, 1.0))
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(completed)/\(goal)")
                .font(.system(size: size * 0.22, weight: .bold, design: .rounded))
                .foregroundColor(.white)
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Small Widget (Three rings like app)

struct SmallWidgetView: View {
    let data: WidgetStreakData

    private let outerSize: CGFloat = 100
    private let ringWidth: CGFloat = 7
    private let ringGap: CGFloat = 3

    var body: some View {
        VStack(spacing: 8) {
            Spacer(minLength: 0)

            // Streak badge
            HStack(spacing: 3) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 10))
                    .foregroundColor(WidgetColors.streak)
                Text("\(data.masterStreak)")
                    .font(.system(size: 12, weight: .black, design: .rounded))
                    .foregroundColor(WidgetColors.streak)
                Text("weeks")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundColor(.white.opacity(0.7))
            }

            // Concentric rings: outer = strength, middle = cardio, inner = recovery
            ZStack {
                // Outer ring - Strength
                ProgressRingView(progress: data.liftsProgress, color: WidgetColors.strength, lineWidth: ringWidth, diameter: outerSize)
                // Middle ring - Cardio
                ProgressRingView(progress: data.cardioProgress, color: WidgetColors.cardio, lineWidth: ringWidth, diameter: outerSize - (ringWidth + ringGap) * 2)
                // Inner ring - Recovery
                ProgressRingView(progress: data.recoveryProgress, color: WidgetColors.recovery, lineWidth: ringWidth, diameter: outerSize - (ringWidth + ringGap) * 4)
            }
            .frame(width: outerSize, height: outerSize)

            // Steps and calories
            HStack(spacing: 10) {
                HStack(spacing: 2) {
                    Image(systemName: "figure.walk")
                        .font(.system(size: 10))
                    Text(formatSteps(data.todaySteps))
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                }
                .foregroundColor(WidgetColors.steps)
                HStack(spacing: 2) {
                    Image(systemName: "flame")
                        .font(.system(size: 10))
                    Text("\(data.todayCalories)")
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                }
                .foregroundColor(WidgetColors.calories)
            }
            .offset(y: 5)

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func formatSteps(_ steps: Int) -> String {
        if steps >= 10000 {
            return "\(steps / 1000)k"
        } else if steps >= 1000 {
            return String(format: "%.1fk", Double(steps) / 1000.0)
        }
        return "\(steps)"
    }
}

// MARK: - Medium Widget (Rings + Progress Bars)

struct MediumWidgetView: View {
    let data: WidgetStreakData

    var body: some View {
        GeometryReader { geo in
            let availableHeight = geo.size.height
            let ringSize = min(availableHeight * 0.58, 80.0)
            let lineWidth = max(ringSize * 0.088, 5.0)

            VStack(spacing: 0) {
                // Streak badge + daily stats
                HStack(spacing: 4) {
                    Image(systemName: "flame.fill")
                        .font(.system(size: 12))
                        .foregroundColor(WidgetColors.streak)
                    Text("\(data.masterStreak) week hybrid streak")
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundColor(WidgetColors.streak)
                    Spacer()
                    HStack(spacing: 3) {
                        Image(systemName: "figure.walk")
                            .font(.system(size: 10))
                        Text(formatSteps(data.todaySteps))
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                    }
                    .foregroundColor(WidgetColors.steps)
                    HStack(spacing: 3) {
                        Image(systemName: "flame")
                            .font(.system(size: 10))
                        Text("\(data.todayCalories)")
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                    }
                    .foregroundColor(WidgetColors.calories)
                }

                Spacer(minLength: 12)

                // Three category rings in a row
                HStack(spacing: 12) {
                    VStack(spacing: 7) {
                        CategoryRingView(completed: data.liftsCompleted, goal: data.liftsGoal, progress: data.liftsProgress, color: WidgetColors.strength, size: ringSize, lineWidth: lineWidth)
                        HStack(spacing: 2) {
                            Text("\u{1F4AA}")
                                .font(.system(size: 11))
                            Text("Strength")
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                                .foregroundColor(WidgetColors.strength)
                        }
                    }
                    VStack(spacing: 7) {
                        CategoryRingView(completed: data.cardioCompleted, goal: data.cardioGoal, progress: data.cardioProgress, color: WidgetColors.cardio, size: ringSize, lineWidth: lineWidth)
                        HStack(spacing: 2) {
                            Text("\u{2764}\u{FE0F}\u{200D}\u{1F525}")
                                .font(.system(size: 11))
                            Text("Cardio")
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                                .foregroundColor(WidgetColors.cardio)
                        }
                    }
                    VStack(spacing: 7) {
                        CategoryRingView(completed: data.recoveryCompleted, goal: data.recoveryGoal, progress: data.recoveryProgress, color: WidgetColors.recovery, size: ringSize, lineWidth: lineWidth)
                        HStack(spacing: 2) {
                            Text("\u{1F9CA}")
                                .font(.system(size: 11))
                            Text("Recovery")
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                                .foregroundColor(WidgetColors.recovery)
                        }
                    }
                }

                Spacer(minLength: 8)

                // Days left
                Text(data.daysLeftInWeek <= 1 ? "Last day!" : "\(data.daysLeftInWeek) days left")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundColor(.white.opacity(0.35))
            }
            .padding(.horizontal, 4)
            .padding(.vertical, -4)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func formatSteps(_ steps: Int) -> String {
        if steps >= 10000 {
            return "\(steps / 1000)k"
        } else if steps >= 1000 {
            return String(format: "%.1fk", Double(steps) / 1000.0)
        }
        return "\(steps)"
    }
}

// MARK: - Large Widget (Full Layout)

struct LargeWidgetView: View {
    let data: WidgetStreakData

    var body: some View {
        GeometryReader { geo in
        let ringSize = min(geo.size.height * 0.22, 85.0)
        let lineWidth = max(ringSize * 0.094, 6.0)

        VStack(spacing: 10) {
            // Streak badge + steps/calories
            HStack(spacing: 4) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 13))
                    .foregroundColor(WidgetColors.streak)
                Text("\(data.masterStreak) week hybrid streak")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundColor(WidgetColors.streak)
                Spacer()
                HStack(spacing: 3) {
                    Image(systemName: "figure.walk")
                        .font(.system(size: 10))
                    Text(formatNumber(data.todaySteps))
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                }
                .foregroundColor(WidgetColors.steps)
                HStack(spacing: 3) {
                    Image(systemName: "flame")
                        .font(.system(size: 10))
                    Text("\(data.todayCalories)")
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                }
                .foregroundColor(WidgetColors.calories)
            }

            Spacer().frame(height: 6)

            // Three category rings
            HStack(spacing: 16) {
                VStack(spacing: 6) {
                    CategoryRingView(completed: data.liftsCompleted, goal: data.liftsGoal, progress: data.liftsProgress, color: WidgetColors.strength, size: ringSize, lineWidth: lineWidth)
                    HStack(spacing: 3) {
                        Text("\u{1F4AA}")
                            .font(.system(size: 11))
                        Text("Strength")
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .foregroundColor(WidgetColors.strength)
                    }
                }
                VStack(spacing: 6) {
                    CategoryRingView(completed: data.cardioCompleted, goal: data.cardioGoal, progress: data.cardioProgress, color: WidgetColors.cardio, size: ringSize, lineWidth: lineWidth)
                    HStack(spacing: 3) {
                        Text("\u{2764}\u{FE0F}\u{200D}\u{1F525}")
                            .font(.system(size: 11))
                        Text("Cardio")
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .foregroundColor(WidgetColors.cardio)
                    }
                }
                VStack(spacing: 6) {
                    CategoryRingView(completed: data.recoveryCompleted, goal: data.recoveryGoal, progress: data.recoveryProgress, color: WidgetColors.recovery, size: ringSize, lineWidth: lineWidth)
                    HStack(spacing: 3) {
                        Text("\u{1F9CA}")
                            .font(.system(size: 11))
                        Text("Recovery")
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .foregroundColor(WidgetColors.recovery)
                    }
                }
            }

            // Days left
            Text(data.daysLeftInWeek <= 1 ? "Last day!" : "\(data.daysLeftInWeek) days left")
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundColor(.white.opacity(0.4))

            // Divider
            Rectangle()
                .fill(Color.white.opacity(0.1))
                .frame(height: 0.5)
                .padding(.horizontal, 4)

            // Recent activities
            if !data.recentActivities.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(data.recentActivities.prefix(4).enumerated()), id: \.offset) { _, activity in
                        HStack(spacing: 10) {
                            Circle()
                                .fill(colorForCategory(activity.category))
                                .frame(width: 8, height: 8)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(activity.name)
                                    .font(.system(size: 14, weight: .medium, design: .rounded))
                                    .foregroundColor(.white)
                                    .lineLimit(1)
                                HStack(spacing: 8) {
                                    if activity.duration > 0 {
                                        HStack(spacing: 2) {
                                            Image(systemName: "clock")
                                                .font(.system(size: 9))
                                            Text(formatDuration(activity.duration))
                                                .font(.system(size: 10, weight: .regular, design: .rounded))
                                        }
                                        .foregroundColor(.white.opacity(0.4))
                                    }
                                    if activity.calories > 0 {
                                        HStack(spacing: 2) {
                                            Image(systemName: "flame")
                                                .font(.system(size: 9))
                                            Text("\(activity.calories) cal")
                                                .font(.system(size: 10, weight: .regular, design: .rounded))
                                        }
                                        .foregroundColor(.white.opacity(0.4))
                                    }
                                }
                            }
                            Spacer()
                            Text(formatActivityDate(activity.date))
                                .font(.system(size: 11, weight: .regular, design: .rounded))
                                .foregroundColor(.white.opacity(0.4))
                        }
                        .padding(.vertical, 5)
                    }
                }
            } else {
                Spacer()
                Text("No recent activities")
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundColor(.white.opacity(0.4))
                Spacer()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        } // GeometryReader
    }

    private func colorForCategory(_ category: String) -> Color {
        switch category {
        case "lifting": return WidgetColors.strength
        case "cardio": return WidgetColors.cardio
        case "recovery": return WidgetColors.recovery
        default: return .gray
        }
    }

    private func formatDuration(_ minutes: Int) -> String {
        if minutes >= 60 {
            let h = minutes / 60
            let m = minutes % 60
            return m > 0 ? "\(h)h \(m)m" : "\(h)h"
        }
        return "\(minutes)m"
    }

    private func formatActivityDate(_ dateStr: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: dateStr) else { return dateStr }

        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }

        let dayFormatter = DateFormatter()
        dayFormatter.dateFormat = "EEE"
        return dayFormatter.string(from: date)
    }

    private func formatNumber(_ value: Int) -> String {
        if value >= 10000 {
            return "\(value / 1000)k"
        } else if value >= 1000 {
            let formatter = NumberFormatter()
            formatter.numberStyle = .decimal
            return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
        }
        return "\(value)"
    }
}

// MARK: - Phone Category Bar View (for medium widget)

struct PhoneCategoryBarView: View {
    let label: String
    let completed: Int
    let goal: Int
    let progress: Double
    let color: Color

    var body: some View {
        HStack(spacing: 6) {
            Text(label)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundColor(.secondary)
                .frame(width: 28, alignment: .leading)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(color.opacity(0.2))
                        .frame(height: 8)
                    Capsule()
                        .fill(color)
                        .frame(width: geo.size.width * min(progress, 1.0), height: 8)
                }
            }
            .frame(height: 8)

            Text("\(completed)/\(goal)")
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundColor(completed >= goal ? color : .secondary)
                .frame(width: 24, alignment: .trailing)
        }
    }
}

// MARK: - Widget Definition

struct DaySevenProgressWidget: Widget {
    let kind = "DaySevenPhoneWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DaySevenPhoneTimelineProvider()) { entry in
            if #available(iOS 17.0, *) {
                DaySevenPhoneWidgetEntryView(entry: entry)
                    .containerBackground(WidgetColors.background, for: .widget)
            } else {
                DaySevenPhoneWidgetEntryView(entry: entry)
                    .padding()
                    .background(WidgetColors.background)
            }
        }
        .configurationDisplayName("DaySeven Progress")
        .description("Track your weekly workout goals and daily activity.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

// MARK: - Entry View Router

struct DaySevenPhoneWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: DaySevenPhoneEntry

    var body: some View {
        switch family {
        case .systemSmall:
            SmallWidgetView(data: entry.data)
        case .systemMedium:
            MediumWidgetView(data: entry.data)
        case .systemLarge:
            LargeWidgetView(data: entry.data)
        default:
            SmallWidgetView(data: entry.data)
        }
    }
}

// MARK: - Previews

@available(iOS 17.0, *)
#Preview("Small", as: .systemSmall) {
    DaySevenProgressWidget()
} timeline: {
    DaySevenPhoneEntry(date: .now, data: .placeholder)
}

@available(iOS 17.0, *)
#Preview("Medium", as: .systemMedium) {
    DaySevenProgressWidget()
} timeline: {
    DaySevenPhoneEntry(date: .now, data: .placeholder)
}

@available(iOS 17.0, *)
#Preview("Large", as: .systemLarge) {
    DaySevenProgressWidget()
} timeline: {
    DaySevenPhoneEntry(date: .now, data: .placeholder)
}
