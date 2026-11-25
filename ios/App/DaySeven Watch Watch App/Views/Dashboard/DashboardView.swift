import SwiftUI
import FirebaseAuth

// MARK: - Dashboard View

struct DashboardView: View {
    @EnvironmentObject var appVM: AppViewModel

    var body: some View {
        WeekHomePage(model: week, isLoading: appVM.isLoading) {
            todaySection
        } footer: {
            accountSection
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

    // MARK: - Today

    private var todaySection: some View {
        TodaySection(
            todaySteps: appVM.todaySteps,
            todayTarget: todayStepTarget,
            weekGoal: appVM.goals.stepsPerDay * 7,
            calories: appVM.todayCalories,
            distance: appVM.distanceUnit == "km" ? appVM.todayDistance * 1.60934 : appVM.todayDistance,
            distanceUnit: appVM.distanceUnit,
            workouts: todayWorkouts
        )
    }

    /// Today's step target, same rule as the phone's Plan tab: what the week still needed at the
    /// start of today, split over the days left (today included), rounded up to 100. Nil once
    /// the week's steps are done: then there's no target and the bar is full.
    private var todayStepTarget: Int? {
        let weekGoal = appVM.goals.stepsPerDay * 7
        guard appVM.weekSteps < weekGoal else { return nil }
        let dayIndex = Calendar.current.component(.weekday, from: Date()) - 1 // 0 = Sunday
        let daysLeft = max(7 - dayIndex, 1)
        let beforeToday = max(appVM.weekSteps - appVM.todaySteps, 0)
        let needed = max(weekGoal - beforeToday, 0)
        return Int((Double(needed) / Double(daysLeft) / 100).rounded(.up)) * 100
    }

    private var todayWorkouts: [TodayWorkoutItem] {
        let today = formatDateString(Date())
        return appVM.activities.filter { $0.date == today }.map { activity in
            let category = ActivityTypes.getActivityCategory(activity)
            let color: Color
            let icon: WeekLineIcon.Icon
            switch category {
            case "lifting", "lifting+cardio": color = AppColors.strength; icon = .dumbbell
            case "recovery": color = AppColors.recovery; icon = .snowflake
            default: color = AppColors.cardio; icon = .run
            }
            // "Chest, Back · 52 min"
            var meta: [String] = []
            let areas = activity.effectiveFocusAreas
            if !areas.isEmpty { meta.append(areas.joined(separator: ", ")) }
            else if let subtype = activity.subtype, !subtype.isEmpty { meta.append(subtype) }
            if let minutes = activity.duration, minutes > 0 {
                meta.append(minutes >= 60 ? formatDuration(minutes) : "\(minutes) min")
            }
            return TodayWorkoutItem(
                id: "\(activity.id)",
                name: activity.strengthType ?? activity.type,
                meta: meta.joined(separator: " · "),
                color: color,
                icon: icon
            )
        }
    }
}
