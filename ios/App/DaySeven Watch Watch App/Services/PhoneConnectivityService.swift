import Foundation
import WatchConnectivity
import FirebaseAuth
import Combine

/// Manages WatchConnectivity on the Apple Watch side.
/// Requests a Firebase custom auth token from the paired iPhone
/// so the watch can sign in as the same user (even if they use Google Sign-In on the phone).
final class PhoneConnectivityService: NSObject, ObservableObject, WCSessionDelegate {
    @Published var isReachable = false
    @Published var isRequesting = false
    @Published var errorMessage: String?

    private var wcSession: WCSession?

    override init() {
        super.init()
        activateSession()
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
}
