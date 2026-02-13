import SwiftUI
import FirebaseAuth

// MARK: - Dashboard View

struct DashboardView: View {
    @EnvironmentObject var appVM: AppViewModel

    @State private var showDailyDetail = false

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(spacing: 10) {
                    // Title
                    Text("DaySeven")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(.gray)
                        .frame(maxWidth: .infinity, alignment: .leading)

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

                        Spacer().frame(height: 8)

                        // Account section
                        accountSection
                    }
                }
                .padding(.horizontal, 4)
                .frame(minHeight: geo.size.height, alignment: .center)
                .offset(y: -14)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .sheet(isPresented: $showDailyDetail) {
            DailyDetailView()
        }
    }

    // MARK: - Account Section

    @State private var showSignOutAlert = false

    private var accountSection: some View {
        VStack(spacing: 6) {
            if let email = appVM.authService.currentUser?.email {
                Text(email)
                    .font(.system(size: 10))
                    .foregroundColor(.gray)
                    .lineLimit(1)
            }

            Button {
                showSignOutAlert = true
            } label: {
                Text("Sign Out")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.red.opacity(0.8))
            }
            .buttonStyle(.plain)
            .alert("Sign Out?", isPresented: $showSignOutAlert) {
                Button("Sign Out", role: .destructive) {
                    appVM.authService.signOut()
                }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("You can sign back in anytime.")
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
        Button {
            showDailyDetail = true
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
