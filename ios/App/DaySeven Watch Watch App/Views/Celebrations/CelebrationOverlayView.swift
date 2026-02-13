import SwiftUI

// MARK: - Celebration Overlay View (brief, non-blocking)

struct CelebrationOverlayView: View {
    let celebration: CelebrationEvent

    @State private var isAnimating = false
    @State private var isFadingOut = false

    // Sparkle particles
    @State private var sparkles: [Sparkle] = []

    private let sparkleCount = 28

    var body: some View {
        ZStack {
            // Strong radial glow background
            RadialGradient(
                gradient: Gradient(colors: [
                    celebration.type.color.opacity(0.55),
                    celebration.type.color.opacity(0.35),
                    celebration.type.color.opacity(0.15),
                    Color.black.opacity(0.85)
                ]),
                center: .center,
                startRadius: 5,
                endRadius: 160
            )
            .ignoresSafeArea()

            // Sparkle particles bursting outward
            ForEach(sparkles) { sparkle in
                SparkleView(sparkle: sparkle, color: celebration.type.color, isAnimating: isAnimating)
            }

            VStack(spacing: 8) {
                // Icon with ring animation
                ZStack {
                    // Outer pulsing ring
                    Circle()
                        .stroke(celebration.type.color.opacity(0.3), lineWidth: 3)
                        .frame(width: 68, height: 68)
                        .scaleEffect(isAnimating ? 1.3 : 0.8)
                        .opacity(isAnimating ? 0.0 : 0.6)

                    // Main ring
                    Circle()
                        .stroke(celebration.type.color, lineWidth: 4)
                        .frame(width: 60, height: 60)
                        .scaleEffect(isAnimating ? 1.0 : 0.3)
                        .opacity(isAnimating ? 1.0 : 0)

                    // Icon
                    Image(systemName: celebration.type.icon)
                        .font(.system(size: 26, weight: .bold))
                        .foregroundColor(celebration.type.color)
                        .scaleEffect(isAnimating ? 1.0 : 0.1)
                }

                // Title
                Text(celebration.type.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(celebration.type.color)
                    .opacity(isAnimating ? 1.0 : 0)

                // Streak count (for category/master celebrations)
                if let streak = celebration.streakCount, streak > 0 {
                    Text("\(streak) week streak")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.white.opacity(0.7))
                        .opacity(isAnimating ? 1.0 : 0)
                }
            }
            .scaleEffect(isAnimating ? 1.0 : 0.6)
        }
        .opacity(isFadingOut ? 0.0 : 1.0)
        .allowsHitTesting(false)
        .onAppear {
            // Generate sparkle particles
            sparkles = (0..<sparkleCount).map { _ in Sparkle.random() }

            // Spring-in animation
            withAnimation(.spring(response: 0.4, dampingFraction: 0.6)) {
                isAnimating = true
            }
            // Start fade-out near the end of the display window
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.8) {
                withAnimation(.easeOut(duration: 0.7)) {
                    isFadingOut = true
                }
            }
        }
    }
}

// MARK: - Sparkle Particle Model

private struct Sparkle: Identifiable {
    let id = UUID()
    let angle: Double      // radians, direction from center
    let distance: CGFloat  // how far it travels
    let size: CGFloat      // star size
    let delay: Double      // staggered start
    let duration: Double   // animation duration
    let brightness: Double // opacity multiplier

    static func random() -> Sparkle {
        Sparkle(
            angle: Double.random(in: 0...(2 * .pi)),
            distance: CGFloat.random(in: 40...110),
            size: CGFloat.random(in: 3...8),
            delay: Double.random(in: 0...0.4),
            duration: Double.random(in: 0.7...1.5),
            brightness: Double.random(in: 0.6...1.0)
        )
    }
}

// MARK: - Sparkle View (individual particle)

private struct SparkleView: View {
    let sparkle: Sparkle
    let color: Color
    let isAnimating: Bool

    @State private var hasLaunched = false

    private var endX: CGFloat { cos(sparkle.angle) * sparkle.distance }
    private var endY: CGFloat { sin(sparkle.angle) * sparkle.distance }

    var body: some View {
        Image(systemName: "sparkle")
            .font(.system(size: sparkle.size, weight: .bold))
            .foregroundColor(color.opacity(sparkle.brightness))
            .offset(x: hasLaunched ? endX : 0, y: hasLaunched ? endY : 0)
            .scaleEffect(hasLaunched ? 0.3 : 1.0)
            .opacity(hasLaunched ? 0.0 : 1.0)
            .onChange(of: isAnimating) { _, animating in
                if animating {
                    DispatchQueue.main.asyncAfter(deadline: .now() + sparkle.delay) {
                        withAnimation(.easeOut(duration: sparkle.duration)) {
                            hasLaunched = true
                        }
                    }
                }
            }
    }
}
