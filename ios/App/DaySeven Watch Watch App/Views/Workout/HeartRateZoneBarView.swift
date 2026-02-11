import SwiftUI

// MARK: - Heart Rate Zone Bar View

struct HeartRateZoneBarView: View {
    let currentZone: HeartRateZone
    let heartRate: Double
    let maxHR: Double
    let zoneSeconds: Int

    private let barHeight: CGFloat = 8
    private let triangleSize: CGFloat = 8

    var body: some View {
        VStack(spacing: 3) {
            // Zone label
            HStack(spacing: 4) {
                Image(systemName: "heart.fill")
                    .font(.system(size: 9))
                    .foregroundColor(currentZone.color)
                Text(currentZone.label)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(currentZone.color)
            }

            // Zone bar with triangle indicator
            GeometryReader { geometry in
                let totalWidth = geometry.size.width
                let indicatorX = HeartRateZone.normalizedPosition(
                    for: heartRate, maxHR: maxHR
                ) * totalWidth

                VStack(spacing: 1) {
                    // Triangle indicator (pointing down)
                    Triangle()
                        .fill(Color.white)
                        .frame(width: triangleSize, height: triangleSize * 0.6)
                        .position(x: indicatorX, y: triangleSize * 0.3)

                    // Colored zone segments
                    HStack(spacing: 1.5) {
                        ForEach(HeartRateZone.allCases, id: \.rawValue) { zone in
                            RoundedRectangle(cornerRadius: 2)
                                .fill(zone.color)
                                .frame(height: barHeight)
                        }
                    }
                }
            }
            .frame(height: barHeight + triangleSize + 2)

            // Time in zone
            Text("\(formatZoneTime(zoneSeconds)) in zone")
                .font(.system(size: 9))
                .foregroundColor(.gray)
        }
    }

    private func formatZoneTime(_ seconds: Int) -> String {
        let mins = seconds / 60
        let secs = seconds % 60
        if mins > 0 {
            return "\(mins):\(String(format: "%02d", secs))"
        }
        return "0:\(String(format: "%02d", secs))"
    }
}

// MARK: - Triangle Shape

struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.maxY))    // bottom center (pointing down)
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY)) // top left
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY)) // top right
        path.closeSubpath()
        return path
    }
}
