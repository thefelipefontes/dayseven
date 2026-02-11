import SwiftUI
import AuthenticationServices

// MARK: - Sign In View

struct SignInView: View {
    @EnvironmentObject var appVM: AppViewModel

    private var phoneService: PhoneConnectivityService { appVM.phoneService }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                // App icon/branding
                VStack(spacing: 8) {
                    Image("IconTransparent")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 120, height: 120)

                    Text("DaySeven")
                        .font(.headline)
                        .foregroundColor(.white)

                    Text("Sign in to sync your data")
                        .font(.caption2)
                        .foregroundColor(.gray)
                        .multilineTextAlignment(.center)
                }

                // Sign in via iPhone (primary — works with Google, Apple, any auth)
                Button {
                    Task {
                        await phoneService.requestSignInFromPhone()
                    }
                } label: {
                    HStack(spacing: 6) {
                        if phoneService.isRequesting {
                            ProgressView()
                                .tint(.black)
                                .scaleEffect(0.7)
                        } else {
                            Image(systemName: "iphone")
                                .font(.system(size: 14))
                        }
                        Text(phoneService.isRequesting ? "Connecting..." : "Sign in via iPhone")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.green)
                    .foregroundColor(.black)
                    .cornerRadius(12)
                }
                .buttonStyle(.plain)
                .disabled(phoneService.isRequesting)

                if !phoneService.isReachable {
                    Text("Make sure DaySeven is open on your iPhone")
                        .font(.system(size: 9))
                        .foregroundColor(.gray)
                        .multilineTextAlignment(.center)
                }

                // Divider
                HStack {
                    Rectangle()
                        .fill(Color.gray.opacity(0.3))
                        .frame(height: 1)
                    Text("or")
                        .font(.system(size: 10))
                        .foregroundColor(.gray)
                    Rectangle()
                        .fill(Color.gray.opacity(0.3))
                        .frame(height: 1)
                }
                .padding(.horizontal, 8)

                // Sign in with Apple (fallback — creates separate Apple account)
                SignInWithAppleButton(.signIn) { request in
                    let nonce = appVM.authService.generateNonce()
                    request.requestedScopes = [.email, .fullName]
                    request.nonce = appVM.authService.sha256(nonce)
                } onCompletion: { result in
                    switch result {
                    case .success(let authorization):
                        appVM.authService.handleSignInWithApple(authorization: authorization)
                    case .failure(let error):
                        appVM.authService.handleSignInError(error)
                    }
                }
                .signInWithAppleButtonStyle(.white)
                .frame(height: 40)

                // Error messages
                if let error = phoneService.errorMessage {
                    Text(error)
                        .font(.caption2)
                        .foregroundColor(.orange)
                        .multilineTextAlignment(.center)
                }

                if let error = appVM.authService.errorMessage {
                    Text(error)
                        .font(.caption2)
                        .foregroundColor(.red)
                        .multilineTextAlignment(.center)
                }

                #if targetEnvironment(simulator)
                Divider()
                    .padding(.vertical, 4)

                Button {
                    appVM.authService.simulatorSignIn()
                } label: {
                    HStack {
                        Image(systemName: "hammer.fill")
                        Text("Dev Sign In")
                    }
                    .font(.caption)
                    .foregroundColor(.orange)
                }
                .buttonStyle(.plain)
                #endif
            }
            .padding(.horizontal, 8)
        }
    }
}
