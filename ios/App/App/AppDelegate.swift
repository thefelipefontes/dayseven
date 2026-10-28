import UIKit
import Capacitor
import FirebaseCore
import FirebaseMessaging
import FirebaseAuth
import FirebaseFirestore
import WatchConnectivity
import ActivityKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var pushToStartTokenTask: Task<Void, Never>?
    private var authStateHandle: AuthStateDidChangeListenerHandle?
    private static let pendingLiveActivityPushTokenKey = "pendingLiveActivityPushToken"
    /// Latest push-to-start token this launch, so a user who signs in after it
    /// arrived (including after a sign-out) gets it under their own uid.
    private var latestLiveActivityPushToken: String?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Initialize Firebase
        FirebaseApp.configure()

        // Set up push notification delegate
        UNUserNotificationCenter.current().delegate = self

        // Set FCM messaging delegate
        Messaging.messaging().delegate = self

        // Register for remote notifications (deferred to avoid blocking launch)
        DispatchQueue.main.async {
            application.registerForRemoteNotifications()
        }

        // Activate WatchConnectivity for Apple Watch auth relay
        WatchSessionManager.shared.activate()

        // HealthKit observer for "New Workout Detected". Registered here, not by
        // the plugin: a HealthKit background launch connects no scene, so the
        // bridge (and the plugin) never loads on the launches this exists for.
        WorkoutDetectionObserver.shared.start()

        // Start observing ActivityKit push-to-start tokens (iOS 17.2+), and the
        // activities those pushes start, so one can't stack on a JS-started one
        if #available(iOS 17.2, *) {
            observeActivityKitPushToStartToken()
            WatchSessionManager.shared.observeNewWorkoutActivities()
        }

        // A push-to-start token that arrived while signed out (or whose upload
        // failed) is parked in UserDefaults; upload it once someone signs in.
        // Also fires right away for a session restored at launch.
        authStateHandle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
            guard let self = self, user != nil,
                  let token = UserDefaults.standard.string(forKey: Self.pendingLiveActivityPushTokenKey)
                    ?? self.latestLiveActivityPushToken else { return }
            print("[ActivityKit] Uploading push-to-start token after sign-in")
            self.storeLiveActivityPushToken(token)
        }

        return true
    }

    // MARK: - ActivityKit Push-to-Start Token

    @available(iOS 17.2, *)
    private func observeActivityKitPushToStartToken() {
        pushToStartTokenTask = Task {
            for await tokenData in Activity<WorkoutActivityAttributes>.pushToStartTokenUpdates {
                let tokenHex = tokenData.map { String(format: "%02x", $0) }.joined()
                print("[ActivityKit] Push-to-start token updated: \(tokenHex.prefix(32))...")
                storeLiveActivityPushToken(tokenHex)
            }
        }
    }

    private func storeLiveActivityPushToken(_ tokenHex: String) {
        latestLiveActivityPushToken = tokenHex
        guard let uid = Auth.auth().currentUser?.uid else {
            print("[ActivityKit] No authenticated user — deferring token storage")
            // Store token locally so it can be uploaded after sign-in
            UserDefaults.standard.set(tokenHex, forKey: Self.pendingLiveActivityPushTokenKey)
            return
        }

        let db = Firestore.firestore()
        db.collection("userTokens").document(uid).setData([
            "liveActivityPushToken": tokenHex
        ], merge: true) { error in
            if let error = error {
                print("[ActivityKit] Failed to store push token: \(error.localizedDescription)")
                // Retry on the next sign-in or launch
                UserDefaults.standard.set(tokenHex, forKey: Self.pendingLiveActivityPushTokenKey)
            } else {
                print("[ActivityKit] Push-to-start token stored for user \(uid)")
                // Only clear the token we just stored, not a newer one that
                // arrived while this write was in flight
                if UserDefaults.standard.string(forKey: Self.pendingLiveActivityPushTokenKey) == tokenHex {
                    UserDefaults.standard.removeObject(forKey: Self.pendingLiveActivityPushTokenKey)
                }
            }
        }
    }

    // MARK: - UIScene

    // With UIApplicationSceneManifest in Info.plist, iOS routes URL opens and
    // universal links to SceneDelegate instead of application(_:open:) /
    // application(_:continue:), so those handlers are gone from here. The
    // app-level callbacks below (push registration, ActivityKit, Watch) still
    // fire as before.
    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    // MARK: - Push Notification Registration

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        // Pass device token to Firebase
        Messaging.messaging().apnsToken = deviceToken

        // Also notify Capacitor
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Notify Capacitor of failure
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
}

// MARK: - UNUserNotificationCenterDelegate
extension AppDelegate: UNUserNotificationCenterDelegate {

    // Handle notification when app is in foreground
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // Show notification even when app is in foreground
        completionHandler([.banner, .badge, .sound])
    }

    // Handle notification tap
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        // Forward to Capacitor
        NotificationCenter.default.post(name: Notification.Name("CapacitorPushNotificationTapped"), object: response)
        completionHandler()
    }
}

// MARK: - MessagingDelegate
extension AppDelegate: MessagingDelegate {

    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let token = fcmToken else { return }

        let dataDict: [String: String] = ["token": token]
        NotificationCenter.default.post(
            name: Notification.Name("FCMToken"),
            object: nil,
            userInfo: dataDict
        )
    }
}
