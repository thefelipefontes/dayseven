import SwiftUI

// MARK: - Celebration Overlay View (brief, non-blocking)

/// A category finishing for the week (board 41): a soft glow in its colour, Home's line
/// icon on a glowing badge, "<Category> done", its blocks lighting up one by one, and one
/// line saying what's left of the week. No rings and no sparkles.
struct CelebrationOverlayView: View {
    @EnvironmentObject var appVM: AppViewModel
    let celebration: CelebrationEvent

    /// Set only by previews; the app reads the week from AppViewModel
    var progress: CelebrationProgress? = nil

    @State private var glowIn = false
    @State private var iconIn = false
    @State private var textIn = false
    @State private var litBlocks = 0
    @State private var isFadingOut = false

    private var type: CelebrationType { celebration.type }
    private var color: Color { type.color }

    private var data: CelebrationProgress {
        progress ?? CelebrationProgress(appVM: appVM, type: type)
    }

    var body: some View {
        let data = self.data
        ZStack {
            Color.black.ignoresSafeArea()

            // Soft radial glow in the category colour
            RadialGradient(
                gradient: Gradient(colors: [color.opacity(0.32), color.opacity(0.12), .clear]),
                center: UnitPoint(x: 0.5, y: 0.4),
                startRadius: 0,
                endRadius: 150
            )
            .ignoresSafeArea()
            .opacity(glowIn ? 1 : 0)

            VStack(spacing: 0) {
                // Tinted badge with the category's line icon, glowing
                RoundedRectangle(cornerRadius: 18)
                    .fill(color.opacity(0.18))
                    .frame(width: 58, height: 58)
                    .shadow(color: color.opacity(0.45), radius: 13)
                    .overlay {
                        if type == .master {
                            Image(systemName: "flame.fill")
                                .font(.system(size: 26))
                                .foregroundColor(color)
                        } else {
                            WeekLineIcon(icon: type.lineIcon, color: color, size: 30)
                        }
                    }
                    .scaleEffect(iconIn ? 1 : 0.4)
                    .opacity(iconIn ? 1 : 0)

                Text(type.title)
                    .font(.system(size: 19, weight: .heavy))
                    .tracking(-0.3)
                    .foregroundColor(type == .master ? WeekColors.gold : .white)
                    .padding(.top, 14)

                if type != .master {
                    CapsText("For the week · \(data.done)/\(data.goal)", size: 9.5, color: color)
                        .padding(.top, 4)

                    // The category's blocks; done ones light up one by one and glow
                    HStack(spacing: 4) {
                        ForEach(0..<max(data.goal, 1), id: \.self) { i in
                            let lit = i < min(data.done, litBlocks)
                            Capsule()
                                .fill(lit ? color : color.opacity(0.22))
                                .frame(height: 7)
                                .shadow(color: lit ? color.opacity(0.7) : .clear, radius: 4)
                        }
                    }
                    .frame(width: 118)
                    .padding(.top, 12)
                }

                // What's left of the week, or "Week won" in gold if this finished it
                Text(data.line)
                    .font(.system(size: 11.5, weight: data.weekWon ? .bold : .regular))
                    .foregroundColor(data.weekWon ? WeekColors.gold : WeekColors.muted)
                    .multilineTextAlignment(.center)
                    .padding(.top, 12)
                    .padding(.horizontal, 10)
            }
            .opacity(textIn ? 1 : 0)
            .padding(.bottom, 10)
        }
        .opacity(isFadingOut ? 0.0 : 1.0)
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(type.title). \(data.line)")
        .onAppear(perform: playEntrance)
    }

    /// Glow fades in, the icon scales in, then the blocks light up one by one; the whole thing
    /// fades out on the same schedule as before (the manager dismisses it at 3.5s).
    private func playEntrance() {
        withAnimation(.easeOut(duration: 0.45)) { glowIn = true }
        withAnimation(.spring(response: 0.4, dampingFraction: 0.62).delay(0.08)) {
            iconIn = true
            textIn = true
        }
        let goal = max(data.goal, 1)
        for i in 1...goal {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4 + 0.14 * Double(i - 1)) {
                withAnimation(.easeOut(duration: 0.2)) { litBlocks = i }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.8) {
            withAnimation(.easeOut(duration: 0.7)) {
                isFadingOut = true
            }
        }
    }
}

// MARK: - What the celebration says

/// The category's count and what's left of Strength, Cardio and weekly Steps.
struct CelebrationProgress {
    let done: Int
    let goal: Int
    /// "Strength and Steps to go", "Week won", or Recovery's bonus line
    let line: String
    let weekWon: Bool

    init(done: Int, goal: Int, strengthMet: Bool, cardioMet: Bool, stepsMet: Bool, type: CelebrationType) {
        self.done = done
        self.goal = goal
        if type == .recovery {
            line = "A bonus on top of your week"
            weekWon = false
            return
        }
        var left: [String] = []
        if !strengthMet { left.append("Strength") }
        if !cardioMet { left.append("Cardio") }
        if !stepsMet { left.append("Steps") }
        weekWon = left.isEmpty
        switch left.count {
        case 0: line = "Week won"
        case 1: line = "\(left[0]) to go"
        case 2: line = "\(left[0]) and \(left[1]) to go"
        default: line = "\(left[0]), \(left[1]) and \(left[2]) to go"
        }
    }

    @MainActor
    init(appVM: AppViewModel, type: CelebrationType) {
        let p = appVM.weeklyProgress
        let stepsMet = appVM.weekSteps >= appVM.goals.stepsPerDay * 7
        let count: CategoryProgress
        switch type {
        case .strength: count = p.lifts
        case .cardio: count = p.cardio
        case .recovery: count = p.recovery
        case .master: count = p.lifts
        }
        self.init(done: count.completed, goal: count.goal,
                  strengthMet: p.lifts.isComplete, cardioMet: p.cardio.isComplete, stepsMet: stepsMet, type: type)
    }
}
