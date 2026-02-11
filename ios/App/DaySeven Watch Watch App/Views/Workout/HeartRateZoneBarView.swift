import SwiftUI

// MARK: - Heart Rate Zone Bar View (Apple Fitness Style)

struct HeartRateZoneBarView: View {
    let currentZone: HeartRateZone
    let heartRate: Double
    let maxHR: Double
    let zoneSeconds: Int

    private let barHeight: CGFloat = 20
    private let arrowSize: CGFloat = 8
    private let spacing: CGFloat = 2

    var body: some View {
        VStack(spacing: 1) {
            // Arrow indicator — overlaid on a clear spacer so it tracks the full bar width
            Color.clear
                .frame(height: arrowSize * 0.7)
                .overlay(
                    GeometryReader { geo in
                        let pos = HeartRateZone.normalizedPosition(for: heartRate, maxHR: maxHR)
                        let halfArrow = arrowSize / 2
                        let xPos = halfArrow + pos * (geo.size.width - arrowSize)

                        Triangle()
                            .fill(Color.white)
                            .frame(width: arrowSize, height: arrowSize * 0.7)
                            .position(x: xPos, y: geo.size.height / 2)
                    }
                )
                .animation(.easeOut(duration: 0.3), value: heartRate)

            // Zone bar segments
            HStack(spacing: spacing) {
                ForEach(HeartRateZone.allCases, id: \.rawValue) { zone in
                    let isActive = zone == currentZone

                    ZStack {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(zone.color.opacity(isActive ? 1.0 : 0.4))
                            .frame(height: barHeight)

                        // Show zone label inside the active (expanded) segment
                        if isActive {
                            HStack(spacing: 3) {
                                Image(systemName: "heart.fill")
                                    .font(.system(size: 10))
                                    .foregroundColor(.white)
                                Text(zone.label)
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundColor(.white)
                            }
                            .minimumScaleFactor(0.5)
                            .lineLimit(1)
                        }
                    }
                    // Active zone gets ~2.5x the width of inactive zones
                    .frame(maxWidth: isActive ? .infinity : nil)
                    .frame(width: isActive ? nil : 20)
                }
            }
            .frame(height: barHeight)
        }
    }
}

// MARK: - Triangle Shape

struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.closeSubpath()
        return path
    }
}
