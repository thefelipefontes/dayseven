import SwiftUI

// MARK: - Week Stats View

struct WeekStatsView: View {
    @EnvironmentObject var appVM: AppViewModel

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                // Week summary header
                HStack {
                    Text("This Week")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.white)
                    Spacer()
                    Text("\(appVM.weeklyStats.totalWorkouts) workouts")
                        .font(.system(size: 12))
                        .foregroundColor(.gray)
                }

                // Category breakdown
                categoryRow(
                    emoji: "\u{1F4AA}",
                    label: "Strength",
                    count: appVM.weeklyProgress.lifts.completed,
                    goal: appVM.weeklyProgress.lifts.goal,
                    color: AppColors.strength
                )

                categoryRow(
                    emoji: "\u{1F525}",
                    label: "Cardio",
                    count: appVM.weeklyProgress.cardio.completed,
                    goal: appVM.weeklyProgress.cardio.goal,
                    color: AppColors.cardio
                )

                categoryRow(
                    emoji: "\u{1F9CA}",
                    label: "Recovery",
                    count: appVM.weeklyProgress.recovery.completed,
                    goal: appVM.weeklyProgress.recovery.goal,
                    color: AppColors.recovery
                )

                Divider()
                    .background(Color(white: 0.3))

                // Totals
                HStack {
                    weekStatItem(
                        icon: "flame.fill",
                        value: "\(appVM.weeklyStats.totalCalories)",
                        label: "Calories",
                        color: .orange
                    )
                    Spacer()
                    weekStatItem(
                        icon: "figure.run",
                        value: String(format: "%.1f mi", appVM.weeklyStats.totalMiles),
                        label: "Distance",
                        color: .blue
                    )
                }

                // Streaks section
                Divider()
                    .background(Color(white: 0.3))

                streaksSection

                // Today Stats link
                NavigationLink(destination: TodayStatsView()) {
                    HStack {
                        Text("Today's Stats")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(.white)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10))
                            .foregroundColor(.gray)
                    }
                    .padding(10)
                    .background(Color(white: 0.12))
                    .cornerRadius(10)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 4)
        }
        .navigationTitle("Stats")
    }

    // MARK: - Category Row

    private func categoryRow(emoji: String, label: String, count: Int, goal: Int, color: Color) -> some View {
        HStack {
            Text(emoji)
                .font(.system(size: 14))
            Text(label)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.white)
            Spacer()
            Text("\(count)")
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundColor(count >= goal ? color : .white)
            Text("/ \(goal)")
                .font(.system(size: 12))
                .foregroundColor(.gray)

            if count >= goal {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(color)
                    .font(.system(size: 12))
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: - Week Stat Item

    private func weekStatItem(icon: String, value: String, label: String, color: Color) -> some View {
        VStack(spacing: 4) {
            HStack(spacing: 3) {
                Image(systemName: icon)
                    .foregroundColor(color)
                    .font(.system(size: 11))
                Text(value)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
            }
            Text(label)
                .font(.system(size: 10))
                .foregroundColor(.gray)
        }
    }

    // MARK: - Streaks Section

    private var streaksSection: some View {
        VStack(spacing: 6) {
            HStack {
                Text("Streaks")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(.white)
                Spacer()
            }

            HStack(spacing: 8) {
                streakBadge(label: "Master", count: appVM.streaks.master, color: .yellow)
                streakBadge(label: "Strength", count: appVM.streaks.lifts, color: AppColors.strength)
                streakBadge(label: "Cardio", count: appVM.streaks.cardio, color: AppColors.cardio)
                streakBadge(label: "Recovery", count: appVM.streaks.recovery, color: AppColors.recovery)
            }
        }
    }

    private func streakBadge(label: String, count: Int, color: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(count)")
                .font(.system(size: 16, weight: .black, design: .rounded))
                .foregroundColor(count > 0 ? color : .gray)
            Text(label)
                .font(.system(size: 8, weight: .medium))
                .foregroundColor(.gray)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
    }
}
