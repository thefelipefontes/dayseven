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

/// A workout the watch reported starting. Posted as the object of
/// `.watchWorkoutStarted`.
struct WatchWorkoutStart {
    let activityType: String
    let strengthType: String?
    let receivedAt: Date
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

    /// Live Activity shown for the workout the watch is running. Main thread only.
    var watchWorkoutLiveActivityId: String?

    /// Live Activity of the phone's own HKWorkoutBuilder session, owned by
    /// HealthKitWriterPlugin. Kept here so the watch bookkeeping above never
    /// adopts or replaces it. Main thread only.
    var phoneWorkoutLiveActivityId: String?

    private var activityUpdatesTask: Task<Void, Never>?

    /// The watch workout in progress, from its workoutStarted until its
    /// workoutEnded. HealthKitWriterPlugin replays it on load, because a start
    /// that arrives before the bridge exists is posted to nobody. Main thread only.
    private(set) var pendingWatchWorkoutStart: WatchWorkoutStart?

    private func watchWorkoutDidStart(activityType: String, strengthType: String?) {
        DispatchQueue.main.async {
            let start = WatchWorkoutStart(activityType: activityType, strengthType: strengthType, receivedAt: Date())
            self.pendingWatchWorkoutStart = start
            NotificationCenter.default.post(name: .watchWorkoutStarted, object: start)
        }
    }

    private func watchWorkoutDidEnd() {
        DispatchQueue.main.async {
            self.pendingWatchWorkoutStart = nil
            NotificationCenter.default.post(name: .watchWorkoutEnded, object: nil)
        }
    }

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

        let changesWorkoutState = action == "startWorkout" || action == "endWorkout" || action == "cancelWorkout"
            || action == "pauseWorkout" || action == "resumeWorkout"

        session.sendMessage(message, replyHandler: { [weak self] reply in
            // The watch got this command directly, so any command queued earlier
            // is obsolete. Left in the context it would be replayed on the
            // watch's next activation and could end or pause the NEXT workout.
            if changesWorkoutState {
                self?.clearPendingCommandFromContext()
            }
            replyHandler(reply)
        }) { [weak self] error in
            print("[WatchSession] Send failed: \(error.localizedDescription)")

            // For workout state-changing commands, queue via applicationContext
            // as a fallback so the command is delivered when the watch wakes up.
            // Without this, e.g., a pause from the phone gets silently dropped
            // when the watch is asleep — the watch keeps recording.
            if action == "endWorkout" || action == "cancelWorkout"
                || action == "pauseWorkout" || action == "resumeWorkout" {
                self?.queueCommandViaContext(action: action)
            }

            errorHandler(error)
        }
    }

    private static let pendingActionKey = "pendingAction"
    private static let pendingActionTimestampKey = "pendingActionTimestamp"

    /// Every read-modify-write of the applicationContext runs here, one at a time. They come
    /// from the plugin (distance unit), WCSession's delegate queue (clearing a command when
    /// the watch reports a workout) and sendMessage's reply and error handlers (queueing or
    /// clearing a command). Two at once could each read the same context and the second
    /// write would undo the first: a queued end lost, or a stale one put back.
    private let contextQueue = DispatchQueue(label: "app.dayseven.watchSession.applicationContext")

    /// Sends `values` merged onto the last applicationContext we sent. A queued
    /// workout command is never carried forward: the watch replays pendingAction
    /// on every activation, so re-sending a stale one alongside an unrelated
    /// update (e.g. the distance unit) could end the next workout.
    func updateApplicationContext(_ values: [String: Any]) throws {
        try contextQueue.sync {
            try mergeIntoApplicationContext(values)
        }
    }

    /// The edit itself. Only ever called on contextQueue.
    private func mergeIntoApplicationContext(_ values: [String: Any]) throws {
        dispatchPrecondition(condition: .onQueue(contextQueue))
        let session = WCSession.default
        var context = session.applicationContext
        context.removeValue(forKey: Self.pendingActionKey)
        context.removeValue(forKey: Self.pendingActionTimestampKey)
        context.merge(values) { _, new in new }
        try session.updateApplicationContext(context)
    }

    /// Queue a workout command via applicationContext so it gets delivered when the watch wakes up.
    /// This is a fallback for when sendMessage fails (watch screen off / app in background).
    func queueCommandViaContext(action: String) {
        let session = WCSession.default
        guard session.activationState == .activated else { return }

        do {
            try updateApplicationContext([
                Self.pendingActionKey: action,
                Self.pendingActionTimestampKey: Date().timeIntervalSince1970
            ])
            print("[WatchSession] Queued \(action) via applicationContext")
        } catch {
            print("[WatchSession] Failed to queue via applicationContext: \(error.localizedDescription)")
        }
    }

    /// Drop a queued workout command once it no longer applies: the watch took a
    /// newer command directly, or a new workout started.
    func clearPendingCommandFromContext() {
        let session = WCSession.default
        guard session.activationState == .activated else { return }

        // The check and the clear are one edit, so a command queued in between isn't wiped
        // unseen.
        contextQueue.sync {
            guard session.applicationContext[Self.pendingActionKey] != nil else { return }
            do {
                try mergeIntoApplicationContext([:])
                print("[WatchSession] Cleared queued command from applicationContext")
            } catch {
                print("[WatchSession] Failed to clear queued command: \(error.localizedDescription)")
            }
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

            // A command queued for the previous workout must not hit this one.
            clearPendingCommandFromContext()

            // Live Activity is started from JS when the app is in the foreground
            // (background start fails with "visibility" error)

            watchWorkoutDidStart(activityType: activityType, strengthType: strengthType)
        case "workoutEnded":
            print("[WatchSession] Watch workout ended")

            // End Live Activity immediately on main thread
            if #available(iOS 16.2, *) {
                DispatchQueue.main.async {
                    self.endWatchWorkoutLiveActivity()
                }
            }

            watchWorkoutDidEnd()
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

            clearPendingCommandFromContext()

            // Live Activity is started from JS when the app is in the foreground

            watchWorkoutDidStart(activityType: activityType, strengthType: strengthType)

        case "workoutEnded":
            print("[WatchSession] transferUserInfo: Watch workout ended")

            if #available(iOS 16.2, *) {
                DispatchQueue.main.async {
                    self.endWatchWorkoutLiveActivity()
                }
            }

            watchWorkoutDidEnd()

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

    /// Running means on screen and still updatable. An ended activity lingers in
    /// `Activity.activities` until it is dismissed, so presence alone says nothing.
    @available(iOS 16.2, *)
    private func isRunning(_ activity: Activity<WorkoutActivityAttributes>) -> Bool {
        activity.activityState == .active || activity.activityState == .stale
    }

    @available(iOS 16.2, *)
    private func runningActivity(id: String?) -> Activity<WorkoutActivityAttributes>? {
        guard let id else { return nil }
        return Activity<WorkoutActivityAttributes>.activities.first { $0.id == id && isRunning($0) }
    }

    /// The newest running workout Live Activity, if any (main thread).
    @available(iOS 16.2, *)
    func newestRunningWorkoutActivity() -> Activity<WorkoutActivityAttributes>? {
        Activity<WorkoutActivityAttributes>.activities
            .filter { isRunning($0) }
            .max { $0.attributes.startTime < $1.attributes.startTime }
    }

    /// Shows the Live Activity for a workout the watch is running (main thread).
    /// Adopts one that is already running, such as the push-to-start one the
    /// server sends, instead of stacking a second card on top of it. Never adopts
    /// an activity that is ending, or the phone workout's own.
    @available(iOS 16.2, *)
    func startOrAdoptWatchWorkoutLiveActivity(activityType: String) {
        if runningActivity(id: watchWorkoutLiveActivityId) != nil {
            print("[LiveActivity] Watch Live Activity already active, skipping")
            return
        }
        watchWorkoutLiveActivityId = nil

        let candidates = Activity<WorkoutActivityAttributes>.activities
            .filter { isRunning($0) && $0.id != phoneWorkoutLiveActivityId }
        if let pushStarted = candidates.max(by: { $0.attributes.startTime < $1.attributes.startTime }) {
            watchWorkoutLiveActivityId = pushStarted.id
            print("[LiveActivity] Adopted running Live Activity: \(pushStarted.id)")
            return
        }

        let attributes = WorkoutActivityAttributes(
            activityType: activityType,
            activityIcon: liveActivityIconForType(activityType),
            startTime: Date(),
            categoryColor: liveActivityCategoryForType(activityType)
        )
        let initialState = WorkoutActivityAttributes.ContentState(isPaused: false)
        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: .init(state: initialState, staleDate: nil),
                pushType: nil
            )
            watchWorkoutLiveActivityId = activity.id
            print("[LiveActivity] Started watch workout Live Activity: \(activity.id)")
        } catch {
            print("[LiveActivity] Failed to start watch workout Live Activity: \(error)")
        }
    }

    /// Push-to-start can land after JS already showed a Live Activity for the
    /// same watch workout (APNs latency), which stacked two cards. Whenever a
    /// new workout activity appears, it replaces the watch one we were tracking,
    /// so at most one is on screen. The phone workout's activity is left alone.
    @available(iOS 17.2, *)
    func observeNewWorkoutActivities() {
        guard activityUpdatesTask == nil else { return }
        activityUpdatesTask = Task { @MainActor [weak self] in
            for await newcomer in Activity<WorkoutActivityAttributes>.activityUpdates {
                guard let self else { return }
                guard newcomer.id != self.phoneWorkoutLiveActivityId,
                      newcomer.id != self.watchWorkoutLiveActivityId else { continue }

                if let tracked = self.runningActivity(id: self.watchWorkoutLiveActivityId) {
                    print("[LiveActivity] Replacing \(tracked.id) with newer \(newcomer.id)")
                    self.watchWorkoutLiveActivityId = newcomer.id
                    await tracked.end(nil, dismissalPolicy: .immediate)
                } else if self.watchWorkoutLiveActivityId != nil {
                    // The tracked one is gone; follow the new one.
                    self.watchWorkoutLiveActivityId = newcomer.id
                }
            }
        }
    }

    @available(iOS 16.2, *)
    func endWatchWorkoutLiveActivity() {
        let finalState = WorkoutActivityAttributes.ContentState(isPaused: false)

        Task { @MainActor in
            // End every workout Live Activity (covers both locally-started and push-started)
            // except the phone workout's, which HealthKitWriterPlugin ends with its session.
            // An end from the watch used to take the phone workout's card down with it.
            for activity in Activity<WorkoutActivityAttributes>.activities where activity.id != phoneWorkoutLiveActivityId {
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

        // Main actor: phoneWorkoutLiveActivityId is main-thread only
        Task { @MainActor in
            // Update every workout activity (covers both locally-started and push-started)
            // except the phone workout's: its pause state and pause time are its own.
            for activity in Activity<WorkoutActivityAttributes>.activities where activity.id != phoneWorkoutLiveActivityId {
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

            // The body carries the custom token, a credential for this account: log only the
            // HTTP status above and the response's keys, never its contents.
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                print("[WatchSession] Failed to parse JSON (\(data.count) bytes)")
                completion(["error": "Unexpected response from the token service"])
                return
            }

            print("[WatchSession] Parsed JSON keys: \(Array(json.keys))")

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
