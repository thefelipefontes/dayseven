import SwiftUI
import FirebaseCore
import HealthKit
import WatchKit

// MARK: - Application Delegate (handles startWatchApp launches from iPhone)

// WKApplicationDelegate, not WKExtensionDelegate: this is a single-target watch app
// (WKApplication = true in the built Info.plist), so there is no WatchKit extension
// process for the extension-era protocol to belong to. SwiftUI warned about the mismatch
// on every launch — "WKExtensionDelegateAdaptor should only be used within an extension
// based process" — while quietly routing the callbacks through a compatibility path.
// handle(_ workoutConfiguration:) below is how the iPhone starts a workout here, so it
// should not be riding a shim Apple is free to drop.
class ExtensionDelegate: NSObject, WKApplicationDelegate {
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
        let app = ActivityTypes.appActivity(for: workoutConfiguration.activityType)
        let activityType = app.type

        // Swimming: surface the swimmingLocationType the launcher set (defaults to Pool when
        // unspecified) so HK metadata stays correct. Indoor/Outdoor only for the types that
        // have it as a subtype, and only when the phone said which; it sends .unknown otherwise.
        let subtype: String?
        if workoutConfiguration.activityType == .swimming {
            subtype = workoutConfiguration.swimmingLocationType == .openWater ? "Open Water" : "Pool"
        } else if ActivityTypes.all.first(where: { $0.name == activityType })?.subtypes.contains("Indoor") == true,
                  workoutConfiguration.locationType != .unknown {
            subtype = isIndoor ? "Indoor" : "Outdoor"
        } else {
            subtype = nil
        }

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
            // Skip if workout was already started by the sendMessage path
            guard !wm.isActive else {
                print("[ExtDelegate] Workout already active (started via sendMessage), skipping")
                return
            }
            // Also skip if a remote workout request is already pending (sendMessage handler set it)
            guard phoneService.remoteWorkoutRequest == nil else {
                print("[ExtDelegate] remoteWorkoutRequest already pending, skipping")
                return
            }
            do {
                try await wm.startWorkout(activityType: workoutConfiguration.activityType, isIndoor: isIndoor, subtype: subtype)
                phoneService.remoteWorkoutRequest = PhoneConnectivityService.RemoteWorkoutRequest(
                    activityType: activityType,
                    strengthType: app.strengthType,
                    subtype: subtype,
                    focusAreas: nil,
                    countToward: app.countToward
                )
                print("[ExtDelegate] Workout started + remoteWorkoutRequest published")
                // Notify the phone so it can switch from phone to watch source
                phoneService.notifyPhoneWorkoutStarted(activityType: activityType, strengthType: app.strengthType)
                // Also trigger Live Activity via APNs push (works even when phone is backgrounded)
                phoneService.requestLiveActivityPush(activityType: activityType, strengthType: app.strengthType)
                // Success haptic
                WKInterfaceDevice.current().play(.success)
            } catch {
                print("[ExtDelegate] Failed to start workout: \(error.localizedDescription)")
                WKInterfaceDevice.current().play(.failure)
            }
        }
    }
}

// MARK: - Main App

@main
struct DaySeven_Watch_Watch_AppApp: App {
    @WKApplicationDelegateAdaptor(ExtensionDelegate.self) var delegate
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
                .environmentObject(appVM.celebrationManager)
        }
    }
}
