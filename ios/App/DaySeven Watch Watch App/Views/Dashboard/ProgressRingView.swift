import SwiftUI

// MARK: - Progress Ring View

struct ProgressRingView: View {
    let progress: Double
    let color: Color
    let label: String
    let count: String
    var lineWidth: CGFloat = 6
    var size: CGFloat = 55

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                // Background ring
                Circle()
                    .stroke(color.opacity(0.2), lineWidth: lineWidth)
                    .frame(width: size, height: size)

                // Progress ring
                Circle()
                    .trim(from: 0, to: min(progress, 1.0))
                    .stroke(
                        color,
                        style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                    )
                    .frame(width: size, height: size)
                    .rotationEffect(.degrees(-90))
                    .animation(.easeInOut(duration: 0.5), value: progress)

                // Count text
                Text(count)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
            }

            Text(label)
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(.gray)
        }
    }
}

// MARK: - Compact Ring (for smaller displays)

struct CompactRingView: View {
    let progress: Double
    let color: Color
    let icon: String

    var body: some View {
        ZStack {
            Circle()
                .stroke(color.opacity(0.2), lineWidth: 4)
                .frame(width: 32, height: 32)

            Circle()
                .trim(from: 0, to: min(progress, 1.0))
                .stroke(color, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                .frame(width: 32, height: 32)
                .rotationEffect(.degrees(-90))

            Text(icon)
                .font(.system(size: 10))
        }
    }
}
