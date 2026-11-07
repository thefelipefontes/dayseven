import UIKit
import Capacitor
import WebKit

class CustomViewController: CAPBridgeViewController, UIScrollViewDelegate {

    // Force light status bar (white text/icons) for dark app
    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        // Before the first layout pass too: until the page paints, an opaque web view is
        // white, and it showed as a white flash at launch as the splash faded out.
        webView?.isOpaque = false
        webView?.backgroundColor = .black
        setNeedsStatusBarAppearanceUpdate()

        // Register local HealthKit writer plugin
        bridge?.registerPluginInstance(HealthKitWriterPlugin())
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        configureWebView()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        configureWebView()
    }

    private func configureWebView() {
        guard let webView = webView else { return }

        view.backgroundColor = .black
        view.window?.backgroundColor = .black

        // Set ourselves as the scroll view delegate
        webView.scrollView.delegate = self

        // Disable bounce to prevent showing background during overscroll
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.alwaysBounceHorizontal = false

        // Set backgrounds. Not opaque: an opaque WKWebView draws white until its first
        // paint and ignores the black behind it.
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.isOpaque = false
    }

    // MARK: - UIScrollViewDelegate

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        // Prevent overscroll at the top
        if scrollView.contentOffset.y < 0 {
            scrollView.contentOffset.y = 0
        }
    }
}
