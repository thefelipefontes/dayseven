import SwiftUI

// MARK: - Dashboard View

struct DashboardView: View {
    @EnvironmentObject var appVM: AppViewModel

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                if appVM.isLoading {
                    ProgressView()
                        .tint(.green)
                        .padding(.top, 40)
                } else {
                    // Master Streak
                    streakSection

                    // Progress Rings
                    ringsSection

                    // Quick Health Stats
                    healthStatsSection

                    // Daily Details Link
                    todayButton
                }
            }
            .padding(.horizontal, 4)
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Text("DaySeven")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(.gray)
            }
        }
    }

    // MARK: - Streak Section

    private var streakSection: some View {
        HStack(spacing: 4) {
            Image(systemName: "flame.fill")
                .foregroundColor(.yellow)
                .font(.system(size: 18))
            Text("\(appVM.streaks.master)")
                .font(.system(size: 28, weight: .black, design: .rounded))
                .foregroundColor(.white)
            Text("week streak")
                .font(.system(size: 11))
                .foregroundColor(.gray)
        }
    }

    // MARK: - Rings Section

    private var ringsSection: some View {
        HStack(spacing: 12) {
            ProgressRingView(
                progress: appVM.weeklyProgress.lifts.progress,
                color: AppColors.strength,
                label: "Strength",
                count: "\(appVM.weeklyProgress.lifts.completed)/\(appVM.weeklyProgress.lifts.goal)"
            )
            ProgressRingView(
                progress: appVM.weeklyProgress.cardio.progress,
                color: AppColors.cardio,
                label: "Cardio",
                count: "\(appVM.weeklyProgress.cardio.completed)/\(appVM.weeklyProgress.cardio.goal)"
            )
            ProgressRingView(
                progress: appVM.weeklyProgress.recovery.progress,
                color: AppColors.recovery,
                label: "Recovery",
                count: "\(appVM.weeklyProgress.recovery.completed)/\(appVM.weeklyProgress.recovery.goal)"
            )
        }
    }

    // MARK: - Health Stats

    private var healthStatsSection: some View {
        HStack(spacing: 12) {
            HStack(spacing: 3) {
                Image(systemName: "figure.walk")
                    .font(.system(size: 10))
                    .foregroundColor(.green)
                Text(formatNumber(appVM.todaySteps))
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundColor(.white)
            }

            HStack(spacing: 3) {
                Image(systemName: "flame")
                    .font(.system(size: 10))
                    .foregroundColor(.orange)
                Text("\(appVM.todayCalories)")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundColor(.white)
            }

            if appVM.todayDistance > 0.1 {
                HStack(spacing: 3) {
                    Image(systemName: "figure.run")
                        .font(.system(size: 10))
                        .foregroundColor(.blue)
                    Text(String(format: "%.1f mi", appVM.todayDistance))
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundColor(.white)
                }
            }
        }
    }

    // MARK: - Today Button

    private var todayButton: some View {
        NavigationLink {
            DailyDetailView()
        } label: {
            Text("Today")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.green)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Number Formatting

    private func formatNumber(_ num: Int) -> String {
        if num >= 1000 {
            let k = Double(num) / 1000.0
            return String(format: "%.1fk", k)
        }
        return "\(num)"
    }
}
