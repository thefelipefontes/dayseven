import SwiftUI
import FirebaseCore

@main
struct DaySeven_Watch_Watch_AppApp: App {
    @StateObject private var appVM = AppViewModel()

    init() {
        FirebaseApp.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appVM)
                .environmentObject(appVM.authService)
                .environmentObject(appVM.workoutManager)
        }
    }
}
