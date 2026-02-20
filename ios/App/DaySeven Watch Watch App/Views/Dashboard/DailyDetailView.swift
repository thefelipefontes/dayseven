import SwiftUI

// MARK: - Daily Detail View

struct DailyDetailView: View {
    @EnvironmentObject var appVM: AppViewModel

    private var todayDateString: String {
        formatDateString(Date())
    }

    private var todayActivities: [Activity] {
        appVM.activities.filter { $0.date == todayDateString }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    // Distance (inline, no card)
                    distanceHeader

                    // Health Stats
                    healthStatsSection

                    // Today's Workouts
                    workoutsSection
                }
                .padding(.horizontal, 4)
            }
            .navigationTitle("Today")
        }
    }

    // MARK: - Distance Header

    private var distanceHeader: some View {
        Group {
            if appVM.todayDistance > 0.1 {
                HStack(spacing: 4) {
                    Image(systemName: "figure.run")
                        .font(.system(size: 11))
                        .foregroundColor(.blue)
                    Text(String(format: "%.1f mi", appVM.todayDistance))
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundColor(.white)
                    Text("today")
                        .font(.system(size: 11))
                        .foregroundColor(.gray)
                }
            }
        }
    }

    // MARK: - Health Stats

    private var healthStatsSection: some View {
        VStack(spacing: 12) {
            statRow(
                icon: "figure.walk",
                iconColor: .green,
                title: "Steps",
                value: formatNumber(appVM.todaySteps),
                goal: "/ \(formatNumber(appVM.goals.stepsPerDay))",
                progress: Double(appVM.todaySteps) / Double(max(appVM.goals.stepsPerDay, 1))
            )

            statRow(
                icon: "flame.fill",
                iconColor: .orange,
                title: "Calories",
                value: "\(appVM.todayCalories)",
                goal: "/ \(appVM.goals.caloriesPerDay)",
                progress: Double(appVM.todayCalories) / Double(max(appVM.goals.caloriesPerDay, 1))
            )
        }
    }

    // MARK: - Stat Row (minimal, no card)

    private func statRow(icon: String, iconColor: Color, title: String, value: String, goal: String, progress: Double) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .foregroundColor(iconColor)
                    .font(.system(size: 11))
                Text(title)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(.gray)
            }

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value)
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
                Text(goal)
                    .font(.system(size: 11))
                    .foregroundColor(.gray)
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color(white: 0.2))
                        .frame(height: 3)
                    RoundedRectangle(cornerRadius: 3)
                        .fill(iconColor)
                        .frame(width: geo.size.width * min(progress, 1.0), height: 3)
                }
            }
            .frame(height: 3)
        }
        .padding(.horizontal, 4)
    }

    // MARK: - Today's Workouts

    private var workoutsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Workouts")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.gray)
                .padding(.leading, 4)

            if todayActivities.isEmpty {
                Text("No workouts yet today")
                    .font(.system(size: 12))
                    .foregroundColor(.gray)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
            } else {
                ForEach(todayActivities) { activity in
                    activityRow(activity)
                }
            }
        }
    }

    // MARK: - Activity Row

    private func activityRow(_ activity: Activity) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            // Activity name with category emoji
            HStack(spacing: 4) {
                Text(categoryEmoji(for: activity))
                    .font(.system(size: 12))
                Text(activityDisplayName(activity))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.white)
                    .lineLimit(1)
            }

            // Detail line: duration · calories · distance
            HStack(spacing: 6) {
                if let duration = activity.duration, duration > 0 {
                    Text(formatDuration(duration))
                        .font(.system(size: 10, design: .rounded))
                        .foregroundColor(.gray)
                }
                if let cal = activity.calories, cal > 0 {
                    Text("\(cal) cal")
                        .font(.system(size: 10, design: .rounded))
                        .foregroundColor(.gray)
                }
                if let dist = activity.distance, dist > 0.01 {
                    Text(String(format: "%.1f mi", dist))
                        .font(.system(size: 10, design: .rounded))
                        .foregroundColor(.gray)
                }
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppColors.cardBackground)
        .cornerRadius(10)
    }

    // MARK: - Helpers

    private func activityDisplayName(_ activity: Activity) -> String {
        var name = activity.strengthType ?? activity.type
        let areas = activity.effectiveFocusAreas
        if !areas.isEmpty {
            name += " - \(areas.joined(separator: ", "))"
        } else if let subtype = activity.subtype {
            name += " - \(subtype)"
        }
        return name
    }

    private func categoryEmoji(for activity: Activity) -> String {
        let cat = ActivityTypes.getActivityCategory(activity)
        switch cat {
        case "lifting": return ActivityCategoryType.strength.emoji
        case "cardio": return ActivityCategoryType.cardio.emoji
        case "recovery": return ActivityCategoryType.recovery.emoji
        default: return ActivityCategoryType.cardio.emoji
        }
    }

    private func formatNumber(_ num: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        return formatter.string(from: NSNumber(value: num)) ?? "\(num)"
    }
}
