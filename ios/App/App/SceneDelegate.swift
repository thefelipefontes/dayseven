import UIKit
import Capacitor

// UIScene lifecycle (Capacitor 8.5 / Xcode 27). The window and its root
// CustomViewController come from Main.storyboard via UISceneStoryboardFile in
// Info.plist, the same way UIMainStoryboardFile did under the AppDelegate path.
// We deliberately do NOT build the window here as the Capacitor template does:
// its `CAPBridgeViewController()` would bypass CustomViewController, which
// registers HealthKitWriterPlugin and pins the black background.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    // URL scheme opens (e.g. the Google Sign-In callback) and universal links
    // arrive here instead of AppDelegate.application(_:open:) / continue.
    // The proxy posts .capacitorOpenURL / .capacitorOpenUniversalLink for plugins.
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
