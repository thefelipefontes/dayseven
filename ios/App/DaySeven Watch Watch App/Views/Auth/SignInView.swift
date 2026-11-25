import SwiftUI
import AuthenticationServices

// MARK: - Sign In View

struct SignInView: View {
    @EnvironmentObject var appVM: AppViewModel

    private var phoneService: PhoneConnectivityService { appVM.phoneService }

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                // App icon/branding
                VStack(spacing: 3) {
                    Image("IconTransparent")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 64, height: 64)
                        .accessibilityHidden(true)

                    Text("DaySeven")
                        .font(.system(size: 18, weight: .heavy))
                        .tracking(-0.3)
                        .foregroundColor(.white)
                        .padding(.top, 5)

                    Text("Sign in to see your week")
                        .font(.system(size: 12))
                        .foregroundColor(WeekColors.muted)
                        .multilineTextAlignment(.center)
                }

                // Sign in via iPhone (primary — works with Google, Apple, any auth)
                Button {
                    appVM.authService.noteUserRequestedSignIn()
                    Task {
                        await phoneService.requestSignInFromPhone()
                    }
                } label: {
                    // The main action: a white pill with a black phone line icon
                    PillLabel(title: phoneService.isRequesting ? "Connecting..." : "Sign in via iPhone",
                              verticalPadding: 10) {
                        if phoneService.isRequesting {
                            ProgressView()
                                .tint(.black)
                                .scaleEffect(0.7)
                                .frame(width: 14, height: 14)
                        } else {
                            WeekLineIcon(icon: .phone, color: .black, size: 14, lineWidth: 2.2)
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(phoneService.isRequesting)

                if !phoneService.isReachable {
                    Text("Make sure DaySeven is open on your iPhone")
                        .font(.system(size: 9))
                        .foregroundColor(.gray)
                        .multilineTextAlignment(.center)
                }

                // Sign in with Apple (fallback — creates separate Apple account)
                SignInWithAppleButton(.signIn) { request in
                    appVM.authService.noteUserRequestedSignIn()
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
                // Apple's own button, unrestyled beyond the corner radius Apple allows. White
                // reads best on black (its black style disappears into the background).
                .signInWithAppleButtonStyle(.white)
                .frame(height: 40)
                .clipShape(Capsule())

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
                    appVM.authService.noteUserRequestedSignIn()
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
