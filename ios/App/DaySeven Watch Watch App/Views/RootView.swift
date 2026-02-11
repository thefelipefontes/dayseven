import SwiftUI

// MARK: - Root View (Auth Gate)

struct RootView: View {
    @EnvironmentObject var appVM: AppViewModel

    var body: some View {
        Group {
            if appVM.authService.isLoading {
                ProgressView()
                    .tint(.green)
            } else if appVM.authService.isSignedIn {
                MainTabView()
            } else {
                SignInView()
            }
        }
        .onChange(of: appVM.authService.isSignedIn) { _, signedIn in
            if signedIn {
                Task {
                    await appVM.requestHealthKitPermissions()
                    await appVM.loadUserData()
                }
            }
        }
    }
}

// MARK: - Main Tab View

struct MainTabView: View {
    @EnvironmentObject var appVM: AppViewModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var startPath = NavigationPath()
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            // Start Activity (landing page)
            NavigationStack(path: $startPath) {
                StartActivityView(path: $startPath)
            }
            .tag(0)

            // Dashboard
            NavigationStack {
                DashboardView()
            }
            .tag(1)
        }
        .tabViewStyle(.page)
        .task {
            if appVM.activities.isEmpty {
                await appVM.loadUserData()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            // When returning to the app with an active workout, snap to the workout tab
            if phase == .active && !startPath.isEmpty {
                selectedTab = 0
            }
        }
        .onChange(of: appVM.phoneService.remoteWorkoutRequest) { _, request in
            // When phone sends a startWorkout command, auto-navigate to the active workout
            if let request = request {
                // Make sure we're on tab 0 and navigate to the workout
                selectedTab = 0
                // Clear any existing navigation and push to the workout view
                startPath = NavigationPath()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    startPath.append(WorkoutDestination.quickStart(
                        activityType: request.activityType,
                        strengthType: request.strengthType
                    ))
                }
            }
        }
        .onChange(of: appVM.phoneService.remoteWorkoutEnded) { _, ended in
            // When phone ends/cancels the workout, navigate back to the start screen
            if ended {
                startPath = NavigationPath()
                appVM.phoneService.remoteWorkoutEnded = false
            }
        }
    }
}
