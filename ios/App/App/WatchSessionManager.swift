import Foundation
import WatchConnectivity
import FirebaseAuth
import FirebaseFirestore
import ActivityKit

// MARK: - Notification Names for Watch ↔ Phone

extension Notification.Name {
    static let watchWorkoutStarted = Notification.Name("watchWorkoutStarted")
    static let watchWorkoutEnded = Notification.Name("watchWorkoutEnded")
    static let watchActivitySaved = Notification.Name("watchActivitySaved")
}

/// Manages WatchConnectivity on the iPhone side.
/// Listens for auth-token requests from the Apple Watch and responds
/// with a Firebase custom token so the watch can sign in as the same user.
class WatchSessionManager: NSObject, WCSessionDelegate {
    static let shared = WatchSessionManager()

    /// Firebase Cloud Functions v2 callable URL
    /// v2 onCall functions are at: https://<function-name>-<project-hash>.<region>.run.app
    /// But they also respond to the v1-style URL with proper callable protocol
    private let functionsBaseURL = "https://us-central1-dayseven-f1a89.cloudfunctions.net"

    /// Track Live Activity started from watch workout notifications
    var watchWorkoutLiveActivityId: String?

    private override init() {
        super.init()
    }

    // MARK: - Send Message TO Watch

    /// Sends a message to the paired Apple Watch and returns the reply via completion handler.
    /// Single attempt — if it fails, errors out immediately so the phone can fall back to a phone workout.
    func sendToWatch(
        message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void,
        errorHandler: @escaping (Error) -> Void
    ) {
        let session = WCSession.default

        // Re-activate if needed
        if session.activationState != .activated {
            print("[WatchSession] Session not activated (state=\(session.activationState.rawValue)), reactivating...")
            session.delegate = self
            session.activate()
        }

        guard session.activationState == .activated else {
            errorHandler(NSError(domain: "WatchSession", code: -1, userInfo: [NSLocalizedDescriptionKey: "WCSession not activated"]))
            return
        }

        let action = message["action"] as? String ?? "unknown"
        print("[WatchSession] Sending message: \(action), isReachable: \(session.isReachable), isPaired: \(session.isPaired), isWatchAppInstalled: \(session.isWatchAppInstalled)")

        session.sendMessage(message, replyHandler: replyHandler) { [weak self] error in
            print("[WatchSession] Send failed: \(error.localizedDescription)")

            // For critical workout commands, queue via applicationContext as fallback
            // so the command is delivered when the watch wakes up
            if action == "endWorkout" || action == "cancelWorkout" {
                self?.queueCommandViaContext(action: action)
            }

            errorHandler(error)
        }
    }

    /// Queue a workout command via applicationContext so it gets delivered when the watch wakes up.
    /// This is a fallback for when sendMessage fails (watch screen off / app in background).
    func queueCommandViaContext(action: String) {
        let session = WCSession.default
        guard session.activationState == .activated else { return }

        do {
            var context = session.applicationContext
            context["pendingAction"] = action
            context["pendingActionTimestamp"] = Date().timeIntervalSince1970
            try session.updateApplicationContext(context)
            print("[WatchSession] Queued \(action) via applicationContext")
        } catch {
            print("[WatchSession] Failed to queue via applicationContext: \(error.localizedDescription)")
        }
    }

    /// Check if the Apple Watch is reachable
    var isWatchReachable: Bool {
        return WCSession.default.activationState == .activated && WCSession.default.isReachable
    }

    /// Check if Apple Watch is paired
    var isPaired: Bool {
        return WCSession.default.isPaired
    }

    /// Check if the watch app is installed
    var isWatchAppInstalled: Bool {
        return WCSession.default.isWatchAppInstalled
    }

    // MARK: - Activate

    func activate() {
        guard WCSession.isSupported() else {
            print("[WatchSession] WCSession not supported on this device")
            return
        }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        print("[WatchSession] WCSession activating...")
    }

    // MARK: - WCSessionDelegate (required)

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        if let error = error {
            print("[WatchSession] Activation failed: \(error.localizedDescription)")
        } else {
            print("[WatchSession] Activation complete: state=\(activationState.rawValue), isPaired=\(session.isPaired), isWatchAppInstalled=\(session.isWatchAppInstalled), isReachable=\(session.isReachable)")
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {
        print("[WatchSession] Session became inactive")
    }

    func sessionDidDeactivate(_ session: WCSession) {
        print("[WatchSession] Session deactivated, reactivating...")
        // Re-activate for multi-watch support
        WCSession.default.activate()
    }

    func sessionWatchStateDidChange(_ session: WCSession) {
        print("[WatchSession] Watch state changed: isPaired=\(session.isPaired), isWatchAppInstalled=\(session.isWatchAppInstalled), isReachable=\(session.isReachable)")
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        print("[WatchSession] Reachability changed: isReachable=\(session.isReachable)")
    }

    // MARK: - Handle messages from Watch (with reply)

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        guard let action = message["action"] as? String else {
            replyHandler(["error": "No action specified"])
            return
        }

        switch action {
        case "requestAuthToken":
            handleAuthTokenRequest(replyHandler: replyHandler)
        case "activitySaved":
            handleActivitySaved(replyHandler: replyHandler)
        default:
            replyHandler(["error": "Unknown action: \(action)"])
        }
    }

    // MARK: - Handle messages from Watch (fire-and-forget, no reply)

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any]
    ) {
        guard let action = message["action"] as? String else { return }

        switch action {
        case "workoutStarted":
            let activityType = message["activityType"] as? String ?? "Other"
            let strengthType = message["strengthType"] as? String
            print("[WatchSession] Watch workout started: \(activityType)")

            // Live Activity is started from JS when the app is in the foreground
            // (background start fails with "visibility" error)

            DispatchQueue.main.async {
                NotificationCenter.default.post(
                    name: .watchWorkoutStarted,
                    object: nil,
                    userInfo: [
                        "activityType": activityType,
                        "strengthType": strengthType as Any
                    ]
                )
            }
        case "workoutEnded":
            print("[WatchSession] Watch workout ended")

            // End Live Activity immediately on main thread
            if #available(iOS 16.2, *) {
                DispatchQueue.main.async {
                    self.endWatchWorkoutLiveActivity()
                }
            }

            DispatchQueue.main.async {
                NotificationCenter.default.post(
                    name: .watchWorkoutEnded,
                    object: nil
                )
            }
        case "workoutPaused":
            let isPaused = message["isPaused"] as? Bool ?? false
            let accumulatedPauseTime = message["accumulatedPauseTime"] as? Double ?? 0
            print("[WatchSession] Watch workout paused: \(isPaused), accumulatedPauseTime: \(accumulatedPauseTime)")

            if #available(iOS 16.2, *) {
                self.updateWatchWorkoutLiveActivityPaused(isPaused, accumulatedPauseTime: accumulatedPauseTime)
            }
        default:
            print("[WatchSession] Unknown fire-and-forget action: \(action)")
        }
    }

    // MARK: - Handle transferUserInfo from Watch (background delivery)

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        guard let action = userInfo["action"] as? String else {
            print("[WatchSession] Received userInfo with no action: \(userInfo.keys)")
            return
        }

        print("[WatchSession] Received transferUserInfo: action=\(action)")

        switch action {
        case "workoutStarted":
            let activityType = userInfo["activityType"] as? String ?? "Other"
            let strengthType = userInfo["strengthType"] as? String
            print("[WatchSession] transferUserInfo: Watch workout started: \(activityType)")

            // Live Activity is started from JS when the app is in the foreground

            DispatchQueue.main.async {
                NotificationCenter.default.post(
                    name: .watchWorkoutStarted,
                    object: nil,
                    userInfo: [
                        "activityType": activityType,
                        "strengthType": strengthType as Any
                    ]
                )
            }

        case "workoutEnded":
            print("[WatchSession] transferUserInfo: Watch workout ended")

            if #available(iOS 16.2, *) {
                DispatchQueue.main.async {
                    self.endWatchWorkoutLiveActivity()
                }
            }

            DispatchQueue.main.async {
                NotificationCenter.default.post(name: .watchWorkoutEnded, object: nil)
            }

        case "workoutPaused":
            let isPaused = userInfo["isPaused"] as? Bool ?? false
            let accumulatedPauseTime = userInfo["accumulatedPauseTime"] as? Double ?? 0
            print("[WatchSession] transferUserInfo: Watch workout paused: \(isPaused), accumulatedPauseTime: \(accumulatedPauseTime)")

            if #available(iOS 16.2, *) {
                self.updateWatchWorkoutLiveActivityPaused(isPaused, accumulatedPauseTime: accumulatedPauseTime)
            }

        case "activitySaved":
            // Same flow as the real-time message path: refresh Firestore cache and notify JS
            guard let uid = Auth.auth().currentUser?.uid else {
                print("[WatchSession] transferUserInfo activitySaved: no user signed in")
                return
            }

            let docRef = Firestore.firestore().document("users/\(uid)")
            docRef.getDocument(source: .server) { document, error in
                if let error = error {
                    print("[WatchSession] transferUserInfo: cache refresh failed: \(error.localizedDescription)")
                } else {
                    let activityCount = (document?.data()?["activities"] as? [[String: Any]])?.count ?? 0
                    print("[WatchSession] transferUserInfo: cache refreshed, \(activityCount) activities")
                }
                // Notify JS layer regardless — it will fetch fresh data via REST
                DispatchQueue.main.async {
                    NotificationCenter.default.post(name: .watchActivitySaved, object: nil)
                }
            }
        default:
            print("[WatchSession] Unknown transferUserInfo action: \(action)")
        }
    }

    // MARK: - Handle activity saved from watch

    /// When the watch saves an activity, force-refresh the Firestore cache
    /// so the Capacitor WebView reads fresh data on next query
    private func handleActivitySaved(replyHandler: @escaping ([String: Any]) -> Void) {
        guard let uid = Auth.auth().currentUser?.uid else {
            print("[WatchSession] activitySaved: no user signed in")
            replyHandler(["status": "no_user"])
            return
        }

        print("[WatchSession] activitySaved: refreshing Firestore cache for \(uid)")

        // Force read from server to update the native Firestore SDK cache
        let docRef = Firestore.firestore().document("users/\(uid)")
        docRef.getDocument(source: .server) { document, error in
            if let error = error {
                print("[WatchSession] activitySaved: cache refresh failed: \(error.localizedDescription)")
                replyHandler(["status": "refresh_failed"])
            } else {
                let activityCount = (document?.data()?["activities"] as? [[String: Any]])?.count ?? 0
                print("[WatchSession] activitySaved: cache refreshed, \(activityCount) activities")
                replyHandler(["status": "refreshed", "count": activityCount])
                // Notify JS layer so it can re-check celebrations / refresh UI
                DispatchQueue.main.async {
                    NotificationCenter.default.post(name: .watchActivitySaved, object: nil)
                }
            }
        }
    }

    // MARK: - Watch Workout Live Activity

    @available(iOS 16.2, *)
    private func startWatchWorkoutLiveActivity(activityType: String, startTime: Date) {
        // Skip if we're already tracking one
        if watchWorkoutLiveActivityId != nil {
            print("[WatchSession] Live Activity already tracked, skipping duplicate start")
            return
        }

        // Check if the APNs push already started a Live Activity (push-to-start)
        let existingActivities = Activity<WorkoutActivityAttributes>.activities
        if let existing = existingActivities.first {
            watchWorkoutLiveActivityId = existing.id
            print("[WatchSession] Adopted existing push-started Live Activity: \(existing.id)")
            return
        }

        let icon = liveActivityIconForType(activityType)
        let category = liveActivityCategoryForType(activityType)

        let attributes = WorkoutActivityAttributes(
            activityType: activityType,
            activityIcon: icon,
            startTime: startTime,
            categoryColor: category
        )
        let initialState = WorkoutActivityAttributes.ContentState(isPaused: false)

        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: .init(state: initialState, staleDate: nil),
                pushType: nil
            )
            watchWorkoutLiveActivityId = activity.id
            print("[WatchSession] Live Activity started: \(activity.id)")
        } catch {
            print("[WatchSession] Failed to start Live Activity: \(error)")
        }
    }

    @available(iOS 16.2, *)
    func endWatchWorkoutLiveActivity() {
        let finalState = WorkoutActivityAttributes.ContentState(isPaused: false)

        Task {
            // End ALL workout Live Activities (covers both locally-started and push-started)
            for activity in Activity<WorkoutActivityAttributes>.activities {
                await activity.end(
                    .init(state: finalState, staleDate: nil),
                    dismissalPolicy: .immediate
                )
                print("[WatchSession] Ended Live Activity: \(activity.id)")
            }
            watchWorkoutLiveActivityId = nil
        }
    }

    @available(iOS 16.2, *)
    func updateWatchWorkoutLiveActivityPaused(_ isPaused: Bool, accumulatedPauseTime: Double = 0) {
        let newState = WorkoutActivityAttributes.ContentState(isPaused: isPaused, accumulatedPauseTime: accumulatedPauseTime)

        Task {
            // Update ALL workout activities (covers both locally-started and push-started)
            for activity in Activity<WorkoutActivityAttributes>.activities {
                await activity.update(.init(state: newState, staleDate: nil))
            }
        }
    }

    func liveActivityIconForType(_ type: String) -> String {
        let lowered = type.lowercased()
        if lowered.contains("run") { return "figure.run" }
        if lowered.contains("cycl") || lowered.contains("bik") { return "figure.outdoor.cycle" }
        if lowered.contains("swim") { return "figure.pool.swim" }
        if lowered.contains("hik") { return "figure.hiking" }
        if lowered.contains("walk") { return "figure.walk" }
        if lowered.contains("yoga") { return "figure.yoga" }
        if lowered.contains("strength") || lowered.contains("weight") || lowered.contains("lift") { return "dumbbell.fill" }
        if lowered.contains("pilates") { return "figure.pilates" }
        if lowered.contains("row") { return "figure.rower" }
        if lowered.contains("stretch") || lowered.contains("cool") || lowered.contains("recover") { return "figure.cooldown" }
        if lowered.contains("hiit") || lowered.contains("interval") || lowered.contains("cross") { return "flame.fill" }
        if lowered.contains("dance") { return "figure.dance" }
        if lowered.contains("box") || lowered.contains("martial") || lowered.contains("kickbox") { return "figure.boxing" }
        if lowered.contains("elliptical") { return "figure.elliptical" }
        if lowered.contains("stair") { return "figure.stair.stepper" }
        return "figure.mixed.cardio"
    }

    func liveActivityCategoryForType(_ type: String) -> String {
        let lowered = type.lowercased()
        if lowered.contains("strength") || lowered.contains("weight") || lowered.contains("lift")
            || lowered.contains("bodyweight") || lowered.contains("calisthenics") {
            return "strength"
        }
        if lowered.contains("yoga") || lowered.contains("stretch") || lowered.contains("pilates")
            || lowered.contains("cool") || lowered.contains("recover") || lowered.contains("meditation")
            || lowered.contains("foam") || lowered.contains("mobility") {
            return "recovery"
        }
        return "cardio"
    }

    // MARK: - Generate Auth Token via Cloud Function

    private func handleAuthTokenRequest(replyHandler: @escaping ([String: Any]) -> Void) {
        guard let user = Auth.auth().currentUser else {
            print("[WatchSession] No authenticated user — cannot generate token")
            replyHandler(["error": "Not signed in on iPhone"])
            return
        }

        print("[WatchSession] Generating custom token for uid: \(user.uid)")

        // Get an ID token to authenticate the Cloud Function call
        user.getIDToken { idToken, error in
            if let error = error {
                print("[WatchSession] Failed to get ID token: \(error.localizedDescription)")
                replyHandler(["error": "Failed to get ID token"])
                return
            }

            guard let idToken = idToken else {
                replyHandler(["error": "No ID token"])
                return
            }

            // Call the generateWatchToken Cloud Function via HTTPS callable protocol
            self.callGenerateWatchToken(idToken: idToken, uid: user.uid, email: user.email) { result in
                replyHandler(result)
            }
        }
    }

    /// Calls the Cloud Function using the Firebase callable function HTTPS protocol
    private func callGenerateWatchToken(
        idToken: String,
        uid: String,
        email: String?,
        completion: @escaping ([String: Any]) -> Void
    ) {
        let urlString = "\(functionsBaseURL)/generateWatchToken"
        guard let url = URL(string: urlString) else {
            completion(["error": "Invalid URL"])
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 15

        print("[WatchSession] Calling cloud function at: \(urlString)")
        print("[WatchSession] Using ID token prefix: \(String(idToken.prefix(20)))...")

        // Firebase v2 callable function expects { data: {} } body
        let body: [String: Any] = ["data": [:]]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("[WatchSession] Cloud function network error: \(error.localizedDescription)")
                completion(["error": error.localizedDescription])
                return
            }

            // Log HTTP status code
            if let httpResponse = response as? HTTPURLResponse {
                print("[WatchSession] HTTP status: \(httpResponse.statusCode)")
            }

            guard let data = data else {
                print("[WatchSession] No data in response")
                completion(["error": "No data in response"])
                return
            }

            // Log raw response for debugging
            let responseStr = String(data: data, encoding: .utf8) ?? "non-utf8"
            print("[WatchSession] Raw response: \(responseStr)")

            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                print("[WatchSession] Failed to parse JSON")
                // Send the raw response back to watch so we can see it in watch console
                let preview = String(responseStr.prefix(200))
                completion(["error": "Not JSON: \(preview)"])
                return
            }

            print("[WatchSession] Parsed JSON keys: \(json.keys)")

            // Firebase v2 callable functions return { result: { token: "..." } }
            // but may also return { token: "..." } directly
            var token: String?

            if let result = json["result"] as? [String: Any] {
                token = result["token"] as? String
            } else if let directToken = json["token"] as? String {
                token = directToken
            }

            guard let finalToken = token else {
                print("[WatchSession] No token found in response")
                // Forward the actual error from the Cloud Function if present
                if let cfError = json["error"] as? String {
                    print("[WatchSession] Cloud Function error: \(cfError)")
                    completion(["error": "CF: \(cfError)"])
                } else {
                    completion(["error": "No token in response. Keys: \(json.keys)"])
                }
                return
            }

            print("[WatchSession] Successfully generated custom token for watch")
            completion([
                "token": finalToken,
                "uid": uid,
                "email": email ?? ""
            ])
        }.resume()
    }
}
