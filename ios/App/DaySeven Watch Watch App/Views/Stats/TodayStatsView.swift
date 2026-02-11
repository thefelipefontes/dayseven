import SwiftUI

// MARK: - Today Stats View

struct TodayStatsView: View {
    @EnvironmentObject var appVM: AppViewModel

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                // Steps
                statCard(
                    icon: "figure.walk",
                    iconColor: .green,
                    title: "Steps",
                    value: formatNumber(appVM.todaySteps),
                    goal: "/ \(formatNumber(appVM.goals.stepsPerDay))",
                    progress: Double(appVM.todaySteps) / Double(max(appVM.goals.stepsPerDay, 1))
                )

                // Calories
                statCard(
                    icon: "flame.fill",
                    iconColor: .orange,
                    title: "Calories",
                    value: "\(appVM.todayCalories)",
                    goal: "/ \(appVM.goals.caloriesPerDay)",
                    progress: Double(appVM.todayCalories) / Double(max(appVM.goals.caloriesPerDay, 1))
                )

                // Distance
                statCard(
                    icon: "figure.run",
                    iconColor: .blue,
                    title: "Distance",
                    value: String(format: "%.1f mi", appVM.todayDistance),
                    goal: nil,
                    progress: nil
                )
            }
            .padding(.horizontal, 4)
        }
        .navigationTitle("Today")
    }

    // MARK: - Stat Card

    private func statCard(icon: String, iconColor: Color, title: String, value: String, goal: String?, progress: Double?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: icon)
                    .foregroundColor(iconColor)
                    .font(.system(size: 14))
                Text(title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.gray)
            }

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value)
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
                if let goal = goal {
                    Text(goal)
                        .font(.system(size: 12))
                        .foregroundColor(.gray)
                }
            }

            if let progress = progress {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Color(white: 0.2))
                            .frame(height: 4)
                        RoundedRectangle(cornerRadius: 3)
                            .fill(iconColor)
                            .frame(width: geo.size.width * min(progress, 1.0), height: 4)
                    }
                }
                .frame(height: 4)
            }
        }
        .padding(10)
        .background(Color(white: 0.12))
        .cornerRadius(12)
    }

    private func formatNumber(_ num: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        return formatter.string(from: NSNumber(value: num)) ?? "\(num)"
    }
}
