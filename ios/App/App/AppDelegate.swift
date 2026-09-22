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

        // Start observing ActivityKit push-to-start tokens (iOS 17.2+)
        if #available(iOS 17.2, *) {
            observeActivityKitPushToStartToken()
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
        guard let uid = Auth.auth().currentUser?.uid else {
            print("[ActivityKit] No authenticated user — deferring token storage")
            // Store token locally so it can be uploaded after sign-in
            UserDefaults.standard.set(tokenHex, forKey: "pendingLiveActivityPushToken")
            return
        }

        let db = Firestore.firestore()
        db.collection("userTokens").document(uid).setData([
            "liveActivityPushToken": tokenHex
        ], merge: true) { error in
            if let error = error {
                print("[ActivityKit] Failed to store push token: \(error.localizedDescription)")
            } else {
                print("[ActivityKit] Push-to-start token stored for user \(uid)")
                UserDefaults.standard.removeObject(forKey: "pendingLiveActivityPushToken")
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
