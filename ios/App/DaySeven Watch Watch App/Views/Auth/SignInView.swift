import SwiftUI
import AuthenticationServices

// MARK: - Sign In View

struct SignInView: View {
    @EnvironmentObject var appVM: AppViewModel

    var body: some View {
        VStack(spacing: 16) {
            // App icon/branding
            VStack(spacing: 8) {
                Text("D7")
                    .font(.system(size: 36, weight: .black, design: .rounded))
                    .foregroundColor(.white)

                Text("DaySeven")
                    .font(.headline)
                    .foregroundColor(.white)

                Text("Sign in to sync your data")
                    .font(.caption2)
                    .foregroundColor(.gray)
                    .multilineTextAlignment(.center)
            }

            // Sign in with Apple button
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
            .frame(height: 45)

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
        .padding()
    }
}
