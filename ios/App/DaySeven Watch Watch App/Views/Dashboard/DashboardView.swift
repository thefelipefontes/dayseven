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
                        // The week: its %, the streak, and Strength, Cardio and Steps (board 20)
                        weekSection

                        // Daily Details Link (today's steps, calories and workouts)
                        todayButton
                            .padding(.top, 6)

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

            // Not during a workout: signed out, the watch shows the sign-in screen and the
            // workout would keep running with no End button and nobody to save it for.
            if !appVM.workoutManager.isActive {
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
                        appVM.signOut()
                    }
                    Button("Cancel", role: .cancel) { }
                } message: {
                    Text("You can sign back in anytime.")
                }
            }
        }
    }

    // MARK: - The Week

    /// The same week as Home and the widgets: the % averages Strength, Cardio and the week's
    /// steps (each capped at 100%), and the week is won once all three are met.
    private var week: WeekModel {
        WeekModel(
            liftsDone: appVM.weeklyProgress.lifts.completed, liftsGoal: appVM.weeklyProgress.lifts.goal,
            cardioDone: appVM.weeklyProgress.cardio.completed, cardioGoal: appVM.weeklyProgress.cardio.goal,
            weekSteps: appVM.weekSteps, weekStepsGoal: appVM.goals.stepsPerDay * 7,
            todaySteps: appVM.todaySteps,
            streak: appVM.streaks.master, streakPaused: appVM.injuryModeActive
        )
    }

    private var weekSection: some View {
        WeekHomeSection(model: week)
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
}
