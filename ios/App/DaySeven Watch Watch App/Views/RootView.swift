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
    @State private var startPath = NavigationPath()

    var body: some View {
        TabView {
            // Start Activity (landing page)
            NavigationStack(path: $startPath) {
                StartActivityView(path: $startPath)
            }

            // Dashboard
            NavigationStack {
                DashboardView()
            }
        }
        .tabViewStyle(.page)
        .task {
            if appVM.activities.isEmpty {
                await appVM.loadUserData()
            }
        }
    }
}
