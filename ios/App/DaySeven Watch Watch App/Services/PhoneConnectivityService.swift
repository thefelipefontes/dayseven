import Foundation
import WatchConnectivity
import FirebaseAuth
import HealthKit
import Combine

/// Manages WatchConnectivity on the Apple Watch side.
/// Requests a Firebase custom auth token from the paired iPhone
/// so the watch can sign in as the same user (even if they use Google Sign-In on the phone).
/// Also handles remote workout commands from the phone.
final class PhoneConnectivityService: NSObject, ObservableObject, WCSessionDelegate {
    @Published var isReachable = false
    @Published var isRequesting = false
    @Published var errorMessage: String?

    /// Published when a remote workout start is requested from the phone
    @Published var remoteWorkoutRequest: RemoteWorkoutRequest?

    /// Published when a remote workout end/cancel is completed from the phone
    @Published var remoteWorkoutEnded = false

    private var wcSession: WCSession?

    /// Reference to the workout manager — set by the app on launch
    var workoutManager: WorkoutManager?

    override init() {
        super.init()
        activateSession()
    }

    // MARK: - Remote Workout Request

    struct RemoteWorkoutRequest: Equatable {
        let activityType: String
        let strengthType: String?
        let id: UUID = UUID() // unique so @Published always fires
        static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id }
    }

    // MARK: - Send Notifications TO Phone

    /// Notify the phone that a workout was started on the watch
    func notifyPhoneWorkoutStarted(activityType: String, strengthType: String?) {
        guard let session = wcSession, session.isReachable else {
            print("[PhoneConnect] Phone not reachable for workout notification")
            return
        }
        var message: [String: Any] = [
            "action": "workoutStarted",
            "activityType": activityType
        ]
        if let strengthType = strengthType {
            message["strengthType"] = strengthType
        }
        // Fire-and-forget — no reply needed
        session.sendMessage(message, replyHandler: nil, errorHandler: { error in
            print("[PhoneConnect] Failed to notify phone of workout start: \(error.localizedDescription)")
        })
    }

    /// Notify the phone that a workout was ended/cancelled on the watch
    func notifyPhoneWorkoutEnded() {
        guard let session = wcSession, session.isReachable else {
            print("[PhoneConnect] Phone not reachable for workout end notification")
            return
        }
        let message: [String: Any] = ["action": "workoutEnded"]
        session.sendMessage(message, replyHandler: nil, errorHandler: { error in
            print("[PhoneConnect] Failed to notify phone of workout end: \(error.localizedDescription)")
        })
    }

    // MARK: - Activate WCSession

    private func activateSession() {
        guard WCSession.isSupported() else {
            print("[PhoneConnect] WCSession not supported")
            return
        }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        wcSession = session
    }

    // MARK: - Request Auth Token from iPhone

    /// Sends a message to the paired iPhone requesting a Firebase custom auth token.
    /// On success, signs in to Firebase on the watch with the same UID.
    func requestSignInFromPhone() async -> Bool {
        guard let session = wcSession, session.isReachable else {
            await MainActor.run {
                errorMessage = "iPhone not reachable. Open DaySeven on your iPhone and try again."
            }
            print("[PhoneConnect] iPhone not reachable")
            return false
        }

        await MainActor.run {
            isRequesting = true
            errorMessage = nil
        }

        let message: [String: Any] = ["action": "requestAuthToken"]

        do {
            let reply = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[String: Any], Error>) in
                session.sendMessage(message, replyHandler: { reply in
                    continuation.resume(returning: reply)
                }, errorHandler: { error in
                    continuation.resume(throwing: error)
                })
            }

            if let error = reply["error"] as? String {
                await MainActor.run {
                    errorMessage = error
                    isRequesting = false
                }
                print("[PhoneConnect] Error from phone: \(error)")
                return false
            }

            guard let token = reply["token"] as? String else {
                await MainActor.run {
                    errorMessage = "No token received from iPhone"
                    isRequesting = false
                }
                return false
            }

            let uid = reply["uid"] as? String ?? "unknown"
            print("[PhoneConnect] Received custom token for uid: \(uid)")

            // Sign in to Firebase with the custom token
            try await Auth.auth().signIn(withCustomToken: token)
            print("[PhoneConnect] Successfully signed in as uid: \(uid)")

            await MainActor.run {
                isRequesting = false
            }
            return true

        } catch {
            await MainActor.run {
                errorMessage = "Connection failed: \(error.localizedDescription)"
                isRequesting = false
            }
            print("[PhoneConnect] Failed: \(error.localizedDescription)")
            return false
        }
    }

    // MARK: - WCSessionDelegate

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        if let error = error {
            print("[PhoneConnect] Activation error: \(error.localizedDescription)")
        } else {
            print("[PhoneConnect] Activated: state=\(activationState.rawValue)")
            let reachable = session.isReachable
            DispatchQueue.main.async {
                self.isReachable = reachable
            }
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        print("[PhoneConnect] Reachability changed: \(reachable)")
        DispatchQueue.main.async {
            self.isReachable = reachable
        }
    }

    // MARK: - Handle Messages FROM Phone (Workout Commands)

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        guard let action = message["action"] as? String else {
            replyHandler(["error": "No action specified"])
            return
        }

        print("[PhoneConnect] Received action: \(action)")

        switch action {
        case "startWorkout":
            handleStartWorkout(message: message, replyHandler: replyHandler)
        case "endWorkout":
            handleEndWorkout(replyHandler: replyHandler)
        case "pauseWorkout":
            handlePauseWorkout(replyHandler: replyHandler)
        case "resumeWorkout":
            handleResumeWorkout(replyHandler: replyHandler)
        case "getMetrics":
            handleGetMetrics(replyHandler: replyHandler)
        case "cancelWorkout":
            handleCancelWorkout(replyHandler: replyHandler)
        default:
            replyHandler(["error": "Unknown action: \(action)"])
        }
    }

    // MARK: - Workout Command Handlers

    private func handleStartWorkout(message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        guard let wm = workoutManager else {
            replyHandler(["error": "WorkoutManager not available"])
            return
        }

        guard let activityTypeString = message["activityType"] as? String else {
            replyHandler(["error": "Missing activityType"])
            return
        }

        let strengthType = message["strengthType"] as? String

        Task { @MainActor in
            // Check if already active
            if wm.isActive {
                replyHandler(["error": "A workout is already active"])
                return
            }

            let hkType = ActivityTypes.mapToHKActivityType(activityTypeString, subtype: nil)

            do {
                try await wm.startWorkout(activityType: hkType)

                // Publish remote workout request so the watch UI navigates
                self.remoteWorkoutRequest = RemoteWorkoutRequest(
                    activityType: activityTypeString,
                    strengthType: strengthType
                )

                replyHandler([
                    "success": true,
                    "activityType": activityTypeString
                ])
            } catch {
                replyHandler(["error": error.localizedDescription])
            }
        }
    }

    private func handleEndWorkout(replyHandler: @escaping ([String: Any]) -> Void) {
        guard let wm = workoutManager else {
            replyHandler(["error": "WorkoutManager not available"])
            return
        }

        Task { @MainActor in
            do {
                let result = try await wm.endWorkout()
                // Signal the watch UI to navigate back to the start screen
                self.remoteWorkoutEnded = true
                replyHandler([
                    "success": true,
                    "workoutUUID": result.workoutUUID,
                    "duration": result.duration,
                    "calories": result.calories,
                    "avgHr": result.avgHr,
                    "maxHr": result.maxHr,
                    "distance": result.distance ?? 0
                ])
            } catch {
                replyHandler(["error": error.localizedDescription])
            }
        }
    }

    private func handlePauseWorkout(replyHandler: @escaping ([String: Any]) -> Void) {
        guard let wm = workoutManager else {
            replyHandler(["error": "WorkoutManager not available"])
            return
        }

        Task { @MainActor in
            wm.pause()
            replyHandler(["success": true, "isPaused": true])
        }
    }

    private func handleResumeWorkout(replyHandler: @escaping ([String: Any]) -> Void) {
        guard let wm = workoutManager else {
            replyHandler(["error": "WorkoutManager not available"])
            return
        }

        Task { @MainActor in
            wm.resume()
            replyHandler(["success": true, "isPaused": false])
        }
    }

    private func handleGetMetrics(replyHandler: @escaping ([String: Any]) -> Void) {
        guard let wm = workoutManager else {
            replyHandler(["isActive": false])
            return
        }

        Task { @MainActor in
            guard wm.isActive else {
                replyHandler(["isActive": false])
                return
            }

            replyHandler([
                "isActive": true,
                "isPaused": wm.isPaused,
                "elapsedSeconds": Int(wm.elapsedTime),
                "heartRate": Int(wm.heartRate),
                "avgHeartRate": Int(wm.averageHeartRate),
                "maxHeartRate": Int(wm.maxHeartRate),
                "calories": Int(wm.activeCalories),
                "distance": wm.distance, // meters
                "currentZone": wm.currentZone.label,
                "zoneSeconds": wm.currentZoneSeconds
            ])
        }
    }

    private func handleCancelWorkout(replyHandler: @escaping ([String: Any]) -> Void) {
        guard let wm = workoutManager else {
            replyHandler(["error": "WorkoutManager not available"])
            return
        }

        Task { @MainActor in
            wm.cancelWorkout()
            // Signal the watch UI to navigate back to the start screen
            self.remoteWorkoutEnded = true
            replyHandler(["success": true])
        }
    }
}
