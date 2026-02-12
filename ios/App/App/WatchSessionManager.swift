import Foundation
import WatchConnectivity
import FirebaseAuth
import FirebaseFirestore

// MARK: - Notification Names for Watch ↔ Phone

extension Notification.Name {
    static let watchWorkoutStarted = Notification.Name("watchWorkoutStarted")
    static let watchWorkoutEnded = Notification.Name("watchWorkoutEnded")
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

        session.sendMessage(message, replyHandler: replyHandler) { error in
            print("[WatchSession] Send failed: \(error.localizedDescription)")
            errorHandler(error)
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
            NotificationCenter.default.post(
                name: .watchWorkoutStarted,
                object: nil,
                userInfo: [
                    "activityType": activityType,
                    "strengthType": strengthType as Any
                ]
            )
        case "workoutEnded":
            print("[WatchSession] Watch workout ended")
            NotificationCenter.default.post(
                name: .watchWorkoutEnded,
                object: nil
            )
        default:
            print("[WatchSession] Unknown fire-and-forget action: \(action)")
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
            }
        }
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
