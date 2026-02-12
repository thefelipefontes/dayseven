import SwiftUI
import FirebaseCore
import HealthKit
import WatchKit

// MARK: - Extension Delegate (handles startWatchApp launches from iPhone)

class ExtensionDelegate: NSObject, WKExtensionDelegate {
    func applicationDidFinishLaunching() {
        print("[ExtDelegate] applicationDidFinishLaunching — watch app launched")
        // Haptic on launch so we know the delegate is wired up
        WKInterfaceDevice.current().play(.click)
    }

    func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
        print("[ExtDelegate] handle() called with activityType: \(workoutConfiguration.activityType.rawValue)")

        // Haptic buzz so user can feel the watch received the command
        WKInterfaceDevice.current().play(.start)

        let phoneService = PhoneConnectivityService.shared
        let isIndoor = workoutConfiguration.locationType == .indoor
        let activityType = Self.mapHKActivityTypeToString(workoutConfiguration.activityType)

        Task { @MainActor in
            // WorkoutManager may not be set yet if app was just cold-launched
            // Retry up to 5 seconds (cold launch can take a while)
            var wm = phoneService.workoutManager
            if wm == nil {
                print("[ExtDelegate] WorkoutManager not available yet, retrying...")
                for i in 1...5 {
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                    wm = phoneService.workoutManager
                    if wm != nil {
                        print("[ExtDelegate] WorkoutManager available after \(i)s")
                        break
                    }
                }
            }
            guard let wm = wm else {
                print("[ExtDelegate] WorkoutManager still not available after 5s, giving up")
                WKInterfaceDevice.current().play(.failure)
                return
            }
            guard !wm.isActive else {
                print("[ExtDelegate] Workout already active, skipping")
                return
            }
            do {
                try await wm.startWorkout(activityType: workoutConfiguration.activityType, isIndoor: isIndoor)
                phoneService.remoteWorkoutRequest = PhoneConnectivityService.RemoteWorkoutRequest(
                    activityType: activityType,
                    strengthType: nil,
                    subtype: isIndoor ? "Indoor" : "Outdoor",
                    focusArea: nil
                )
                print("[ExtDelegate] Workout started + remoteWorkoutRequest published")
                // Notify the phone so it can switch from phone to watch source
                phoneService.notifyPhoneWorkoutStarted(activityType: activityType, strengthType: nil)
                // Success haptic
                WKInterfaceDevice.current().play(.success)
            } catch {
                print("[ExtDelegate] Failed to start workout: \(error.localizedDescription)")
                WKInterfaceDevice.current().play(.failure)
            }
        }
    }

    /// Reverse-map HKWorkoutActivityType back to our app's activity type string
    static func mapHKActivityTypeToString(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .running: return "Running"
        case .cycling: return "Cycling"
        case .swimming: return "Swimming"
        case .walking: return "Walking"
        case .hiking: return "Hiking"
        case .traditionalStrengthTraining: return "Strength Training"
        case .highIntensityIntervalTraining: return "HIIT"
        case .yoga: return "Yoga"
        case .pilates: return "Pilates"
        case .coreTraining: return "Core Training"
        case .elliptical: return "Elliptical"
        case .stairClimbing: return "Stair Climbing"
        case .crossTraining: return "Cross Training"
        case .flexibility: return "Flexibility"
        case .functionalStrengthTraining: return "Functional Strength"
        case .americanFootball: return "Football"
        case .basketball: return "Basketball"
        case .soccer: return "Soccer"
        case .tennis: return "Tennis"
        case .golf: return "Golf"
        case .baseball: return "Baseball"
        case .boxing: return "Boxing"
        case .martialArts: return "Martial Arts"
        case .rowing: return "Rowing"
        case .socialDance: return "Dance"
        case .badminton: return "Badminton"
        case .volleyball: return "Volleyball"
        case .hockey: return "Hockey"
        case .lacrosse: return "Lacrosse"
        case .rugby: return "Rugby"
        case .softball: return "Softball"
        case .squash: return "Squash"
        case .tableTennis: return "Table Tennis"
        case .racquetball: return "Racquetball"
        case .handball: return "Handball"
        case .cricket: return "Cricket"
        case .mindAndBody: return "Mind and Body"
        case .preparationAndRecovery: return "Preparation"
        case .cooldown: return "Cooldown"
        default: return "Other"
        }
    }
}

// MARK: - Main App

@main
struct DaySeven_Watch_Watch_AppApp: App {
    @WKExtensionDelegateAdaptor(ExtensionDelegate.self) var delegate
    @StateObject private var appVM = AppViewModel()

    init() {
        FirebaseApp.configure()
        // Force-initialize the WCSession singleton ASAP so it's ready
        // to receive messages even when launched in the background by watchOS.
        _ = PhoneConnectivityService.shared
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
