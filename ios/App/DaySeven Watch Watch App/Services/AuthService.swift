import Foundation
import Combine
import AuthenticationServices
import FirebaseAuth
import CryptoKit

// MARK: - Auth Service

@MainActor
class AuthService: ObservableObject {
    @Published var currentUser: FirebaseAuth.User?
    @Published var isSignedIn = false
    @Published var isLoading = true
    @Published var errorMessage: String?

    private var authListener: AuthStateDidChangeListenerHandle?
    private var currentNonce: String?

    init() {
        setupAuthListener()
    }

    private func setupAuthListener() {
        authListener = Auth.auth().addStateDidChangeListener { [weak self] _, user in
            Task { @MainActor in
                guard let self = self else { return }
                self.currentUser = user
                self.isSignedIn = user != nil
                self.isLoading = false
                print("[AuthService] Auth state changed - signed in: \(user != nil), uid: \(user?.uid ?? "none")")
            }
        }

        // Timeout fallback
        Task {
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            if self.isLoading {
                self.isLoading = false
                print("[AuthService] Timeout - forcing isLoading to false")
            }
        }
    }

    deinit {
        if let listener = authListener {
            Auth.auth().removeStateDidChangeListener(listener)
        }
    }

    // MARK: - Sign in with Apple

    func handleSignInWithApple(authorization: ASAuthorization) {
        guard let appleCredential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let identityToken = appleCredential.identityToken,
              let tokenString = String(data: identityToken, encoding: .utf8) else {
            errorMessage = "Failed to get Apple ID credential"
            return
        }

        let credential = OAuthProvider.appleCredential(
            withIDToken: tokenString,
            rawNonce: currentNonce,
            fullName: appleCredential.fullName
        )

        Task {
            do {
                let result = try await Auth.auth().signIn(with: credential)
                self.currentUser = result.user
                self.isSignedIn = true
                self.errorMessage = nil
            } catch {
                self.errorMessage = "Sign in failed: \(error.localizedDescription)"
            }
        }
    }

    func handleSignInError(_ error: Error) {
        if (error as NSError).code == ASAuthorizationError.canceled.rawValue {
            return // User cancelled
        }
        errorMessage = "Sign in error: \(error.localizedDescription)"
    }

    // MARK: - Nonce generation for Apple Sign In

    func generateNonce() -> String {
        let nonce = randomNonceString()
        currentNonce = nonce
        return nonce
    }

    func sha256(_ input: String) -> String {
        let inputData = Data(input.utf8)
        let hashedData = SHA256.hash(data: inputData)
        return hashedData.compactMap { String(format: "%02x", $0) }.joined()
    }

    private func randomNonceString(length: Int = 32) -> String {
        precondition(length > 0)
        var randomBytes = [UInt8](repeating: 0, count: length)
        let errorCode = SecRandomCopyBytes(kSecRandomDefault, randomBytes.count, &randomBytes)
        if errorCode != errSecSuccess {
            fatalError("Unable to generate nonce: \(errorCode)")
        }
        let charset: [Character] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        return String(randomBytes.map { charset[Int($0) % charset.count] })
    }

    // MARK: - Simulator Dev Sign In

    #if targetEnvironment(simulator)
    func simulatorSignIn() {
        Task {
            do {
                let result = try await Auth.auth().signInAnonymously()
                self.currentUser = result.user
                self.isSignedIn = true
                self.errorMessage = nil
                print("[AuthService] Simulator sign-in successful - uid: \(result.user.uid)")
            } catch {
                self.errorMessage = "Simulator sign-in failed: \(error.localizedDescription)"
                print("[AuthService] Simulator sign-in failed: \(error.localizedDescription)")
            }
        }
    }
    #endif

    // MARK: - Sign Out

    func signOut() {
        do {
            try Auth.auth().signOut()
            currentUser = nil
            isSignedIn = false
        } catch {
            errorMessage = "Sign out failed: \(error.localizedDescription)"
        }
    }
}
