import SwiftUI

// The watch home's pieces, drawn like Home and the iPhone widgets (board 20): the week's %,
// the gold streak, one block per session and the weekly steps bar with its pace tick.
// No rings for the goals and no emoji. The complications draw their own copies (they run in
// the widget extension, which only shares SharedDefaults.swift with this target).

// MARK: - Colors

enum WeekColors {
    static let gold = Color(red: 1.0, green: 0.843, blue: 0.0)       // #FFD700, the streak and a won week only
    static let injury = Color(red: 0.655, green: 0.545, blue: 0.980) // #A78BFA, streak paused
    static let muted = Color(red: 0.541, green: 0.541, blue: 0.541)  // #8a8a8a, caps labels
    static let daysLeft = Color(white: 0.667)                         // #aaa, the days-left line
    static let faint = Color(red: 0.435, green: 0.435, blue: 0.435)  // #6f6f6f, a value's "/goal"

    /// The week's % warms from white to gold as the week fills: rgb(255, 255−40t, 255·(1−t)).
    static func goldMix(_ pct: Int) -> Color {
        let t = min(1, max(0, Double(pct) / 100))
        return Color(red: 1, green: (255 - 40 * t) / 255, blue: 1 - t)
    }

    static func color(_ g: WeekModel.Goal) -> Color {
        switch g {
        case .strength: return AppColors.strength
        case .cardio: return AppColors.cardio
        case .steps: return AppColors.steps
        }
    }

    static func name(_ g: WeekModel.Goal) -> String {
        switch g {
        case .strength: return "Strength"
        case .cardio: return "Cardio"
        case .steps: return "Steps"
        }
    }
}

// MARK: - The home's week block (board 20)

/// The week's %, the streak, the line under them and the three goal rows.
struct WeekHomeSection: View {
    let model: WeekModel
    /// 40/41/42mm: a slightly smaller % and tighter rows, so the whole week fits the first screen
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                WeekPercentView(model: model, size: compact ? 32 : 40)
                Spacer(minLength: 4)
                WeekStreakChip(model: model, size: 15)
                    .padding(.top, 2)
            }

            // Midweek just the days left (Felipe's Small-widget pick); a won week says so in gold
            if model.won {
                Text("Week won · \(model.daysLeft) to spare".uppercased())
                    .font(.system(size: 9.5, weight: .bold))
                    .tracking(9.5 * 0.13)
                    .foregroundColor(WeekColors.gold)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .padding(.top, compact ? 6 : 8)
            } else {
                Text(model.daysLeftText)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(WeekColors.daysLeft)
                    .lineLimit(1)
                    .padding(.top, compact ? 4 : 6)
            }

            VStack(spacing: compact ? 4 : 9) {
                WeekGoalRow(model: model, goal: .strength)
                WeekGoalRow(model: model, goal: .cardio)
                WeekGoalRow(model: model, goal: .steps)
            }
            .padding(.top, compact ? 6 : (model.won ? 13 : 11))
        }
        .padding(.horizontal, 4)
    }
}

// MARK: - The week's %

/// The one big number. Gold with a soft glow once the week is won.
struct WeekPercentView: View {
    let model: WeekModel
    let size: CGFloat

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text("\(model.percent)")
                .font(.system(size: size, weight: .heavy))
                .tracking(-size * 0.045)
            Text("%")
                .font(.system(size: (size * 0.46).rounded(), weight: .heavy))
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        // The mock sets the % at line-height 0.82; trim SwiftUI's taller line box to match
        .padding(.vertical, -size * 0.18)
        .foregroundColor(model.won ? WeekColors.gold : WeekColors.goldMix(model.percent))
        .shadow(color: model.won ? WeekColors.gold.opacity(0.45) : .clear, radius: 9)
    }
}

/// The winning streak: a gold flame and the number. On an injury pause: a violet bandage.
struct WeekStreakChip: View {
    let model: WeekModel
    let size: CGFloat

    var body: some View {
        HStack(spacing: (size * 0.25).rounded()) {
            Image(systemName: model.streakPaused ? "bandage.fill" : "flame.fill")
                .font(.system(size: (size * 0.95).rounded()))
            Text("\(model.streak)")
                .font(.system(size: size, weight: .heavy))
        }
        .foregroundColor(model.streakPaused ? WeekColors.injury : WeekColors.gold)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.streakPaused ? "Streak paused at \(model.streak)" : "\(model.streak) week winning streak")
    }
}

// MARK: - A goal's row

/// Name and value on top, the blocks or the steps bar under it.
struct WeekGoalRow: View {
    let model: WeekModel
    let goal: WeekModel.Goal

    var body: some View {
        VStack(spacing: 5) {
            HStack(spacing: 5) {
                WeekLineIcon(icon: WeekLineIcon.icon(for: goal), color: WeekColors.color(goal), size: 12)
                Text(WeekColors.name(goal))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.white)
                Spacer(minLength: 4)
                value
            }
            if goal == .steps {
                WeekStepsBar(model: model, height: 6)
            } else {
                WeekSessionBlocks(done: model.done(goal), goal: model.goal(goal),
                                  color: WeekColors.color(goal), height: 6, gap: 3, met: model.met(goal))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(WeekColors.name(goal)), \(model.done(goal)) of \(model.goal(goal))")
    }

    /// "3/3", "52.4k/70k": the number in white, the "/goal" small and grey.
    private var value: some View {
        let main = goal == .steps ? WeekModel.k(model.done(.steps)) : "\(model.done(goal))"
        let rest = goal == .steps ? "/\(WeekModel.k0(model.goal(.steps)))" : "/\(model.goal(goal))"
        return (Text(main).font(.system(size: 14, weight: .heavy)).foregroundColor(.white)
                + Text(rest).font(.system(size: 9, weight: .bold)).foregroundColor(WeekColors.faint))
            .lineLimit(1)
            .minimumScaleFactor(0.8) // narrow screens only
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// One block per session in the goal's colour; empty ones at 22%. A finished goal glows.
struct WeekSessionBlocks: View {
    let done: Int
    let goal: Int
    let color: Color
    let height: CGFloat
    let gap: CGFloat
    let met: Bool

    var body: some View {
        HStack(spacing: gap) {
            ForEach(0..<max(goal, 1), id: \.self) { i in
                let filled = i < done
                Capsule()
                    .fill(filled ? color : color.opacity(0.22))
                    .frame(height: height)
                    .shadow(color: (met && filled) ? color.opacity(0.55) : .clear, radius: (height + 1) / 2)
            }
        }
    }
}

/// The week's steps against the weekly goal, with a white pace tick at finished days / 7.
struct WeekStepsBar: View {
    let model: WeekModel
    let height: CGFloat

    var body: some View {
        let met = model.met(.steps)
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(AppColors.steps.opacity(0.22))
                Capsule()
                    .fill(AppColors.steps)
                    .frame(width: max(height, geo.size.width * model.fraction(.steps)))
                    .opacity(model.done(.steps) > 0 ? 1 : 0)
                    .shadow(color: met ? AppColors.steps.opacity(0.55) : .clear, radius: (height + 1) / 2)
            }
            .frame(height: height)
            .overlay(alignment: .leading) {
                if let pace = model.paceFraction {
                    let overhang = (height * 0.45).rounded()
                    RoundedRectangle(cornerRadius: 1)
                        .fill(Color.white)
                        .frame(width: 2, height: height + overhang * 2)
                        .background(RoundedRectangle(cornerRadius: 2).fill(Color.black).padding(-1.5))
                        .offset(x: geo.size.width * pace - 1)
                }
            }
        }
        .frame(height: height)
    }
}

// MARK: - Line icons (the same paths Home uses, drawn from their SVG source)

struct WeekLineIcon: View {
    enum Icon { case strength, cardio, steps, recovery, dumbbell, run, snowflake, calories, pin, chevronDown,
                body, circuit, bike, heart, phone, check, xmark, chevronRight, pace, clock }

    let icon: Icon
    let color: Color
    let size: CGFloat
    var lineWidth: CGFloat = 2

    static func icon(for g: WeekModel.Goal) -> Icon {
        switch g {
        case .strength: return .strength
        case .cardio: return .cardio
        case .steps: return .steps
        }
    }

    static func paths(_ icon: Icon) -> [String] {
        switch icon {
        case .strength: return [
            "M12.409 13.017A5 5 0 0 1 22 15c0 3.866-4 7-9 7-4.077 0-8.153-.82-10.371-2.462-.426-.316-.631-.832-.62-1.362C2.118 12.723 2.627 2 10 2a3 3 0 0 1 3 3 2 2 0 0 1-2 2c-1.105 0-1.64-.444-2-1",
            "M15 14a5 5 0 0 0-7.584 2",
            "M9.964 6.825C8.019 7.977 9.5 13 8 15"]
        case .cardio: return [
            "M19.5 13.572l-7.5 7.428l-2.896 -2.868m-6.117 -8.104a5 5 0 0 1 9.013 -3.022a5 5 0 1 1 7.5 6.572",
            "M3 13h2l2 3l2 -6l1 3h3"]
        case .steps: return [
            "M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z",
            "M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z",
            "M16 17h4", "M4 13h4"]
        case .dumbbell: return [
            "M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z",
            "m2.5 21.5 1.4-1.4", "m20.1 3.9 1.4-1.4",
            "M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z",
            "m9.6 14.4 4.8-4.8"]
        case .run: return [
            "M12 4a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M4 17l5 1l.75 -1.5", "M15 21l0 -4l-4 -3l1 -6", "M7 12l0 -3l5 -1l3 3l3 1"]
        case .snowflake: return ["M12 2v20", "M2 12h20", "M4.93 4.93l14.14 14.14", "M19.07 4.93L4.93 19.07"]
        case .calories: return [ // the phone's live-workout calories flame
            "M12 10.941c2.333 -3.308 .167 -7.823 -1 -8.941c0 3.395 -2.235 5.299 -3.667 6.706c-1.43 1.408 -2.333 3.621 -2.333 5.588c0 3.704 3.134 6.706 7 6.706s7 -3.002 7 -6.706c0 -1.712 -1.232 -4.403 -2.333 -5.588c-2.084 3.353 -3.249 3.353 -4.667 2.235"]
        case .pin: return [
            "M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0",
            "M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z"]
        case .chevronDown: return ["M6 9l6 6l6 -6"]
        case .recovery: return ["M12 21a9 9 0 1 1 0 -18a9 9 0 0 1 0 18z", "M8 12c1.5 -2 2.5 -2 4 0s2.5 2 4 0"]
        case .body: return ["M11 4a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M6 20l3 -6l3 1l3 -1l3 6", "M4 8l8 1l8 -1", "M12 9v6"]
        case .circuit: return ["M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4", "M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"]
        case .bike: return ["M2 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M16 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
                            "M12 19v-4l-3 -3l5 -4l2 3h3", "M16 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"]
        case .heart: return ["M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572"]
        case .phone: return ["M9 2.5h6a2.5 2.5 0 0 1 2.5 2.5v14a2.5 2.5 0 0 1 -2.5 2.5h-6a2.5 2.5 0 0 1 -2.5 -2.5v-14a2.5 2.5 0 0 1 2.5 -2.5z", "M11 18.5h2"]
        case .check: return ["M5 12l5 5l10 -10"]
        case .xmark: return ["M6 6l12 12", "M18 6l-12 12"]
        case .chevronRight: return ["M9 6l6 6l-6 6"]
        case .pace: return ["M4 13a8 8 0 1 0 16 0a8 8 0 1 0 -16 0", "M12 13l3 -3", "M10 3h4"]
        case .clock: return ["M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0", "M12 7v5l3 3"]
        }
    }

    var body: some View {
        let scale = size / 24
        ZStack {
            ForEach(Self.paths(icon), id: \.self) { d in
                WeekSVGPath.path(d)
                    .applying(CGAffineTransform(scaleX: scale, y: scale))
                    .stroke(color, style: StrokeStyle(lineWidth: lineWidth * scale, lineCap: .round, lineJoin: .round))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// A small SVG path-data parser (M L H V C S Q T A Z, absolute and relative): enough for the
/// icons above without adding image assets. The same parser as the iPhone widgets.
enum WeekSVGPath {
    static func path(_ d: String) -> Path {
        var path = Path()
        let tokens = tokenize(d)
        var i = 0
        var cmd: Character = "M"
        var cur = CGPoint.zero, start = CGPoint.zero
        var lastCtrl: CGPoint? = nil
        func num() -> CGFloat { defer { i += 1 }; return i < tokens.count ? CGFloat(Double(tokens[i]) ?? 0) : 0 }
        while i < tokens.count {
            if let c = tokens[i].first, tokens[i].count == 1, c.isLetter { cmd = c; i += 1 }
            let rel = cmd.isLowercase
            let base = rel ? cur : .zero
            switch cmd.uppercased().first! {
            case "M":
                let p = CGPoint(x: base.x + num(), y: base.y + num())
                path.move(to: p); cur = p; start = p; lastCtrl = nil
                cmd = rel ? "l" : "L"
            case "L":
                let p = CGPoint(x: base.x + num(), y: base.y + num())
                path.addLine(to: p); cur = p; lastCtrl = nil
            case "H":
                let p = CGPoint(x: (rel ? cur.x : 0) + num(), y: cur.y)
                path.addLine(to: p); cur = p; lastCtrl = nil
            case "V":
                let p = CGPoint(x: cur.x, y: (rel ? cur.y : 0) + num())
                path.addLine(to: p); cur = p; lastCtrl = nil
            case "C":
                let c1 = CGPoint(x: base.x + num(), y: base.y + num())
                let c2 = CGPoint(x: base.x + num(), y: base.y + num())
                let p = CGPoint(x: base.x + num(), y: base.y + num())
                path.addCurve(to: p, control1: c1, control2: c2); cur = p; lastCtrl = c2
            case "S":
                let c1 = lastCtrl.map { CGPoint(x: 2 * cur.x - $0.x, y: 2 * cur.y - $0.y) } ?? cur
                let c2 = CGPoint(x: base.x + num(), y: base.y + num())
                let p = CGPoint(x: base.x + num(), y: base.y + num())
                path.addCurve(to: p, control1: c1, control2: c2); cur = p; lastCtrl = c2
            case "Q":
                let c = CGPoint(x: base.x + num(), y: base.y + num())
                let p = CGPoint(x: base.x + num(), y: base.y + num())
                path.addQuadCurve(to: p, control: c); cur = p; lastCtrl = c
            case "T":
                let c = lastCtrl.map { CGPoint(x: 2 * cur.x - $0.x, y: 2 * cur.y - $0.y) } ?? cur
                let p = CGPoint(x: base.x + num(), y: base.y + num())
                path.addQuadCurve(to: p, control: c); cur = p; lastCtrl = c
            case "A":
                let rx = num(), ry = num(), rot = num(), large = num() != 0, sweep = num() != 0
                let p = CGPoint(x: base.x + num(), y: base.y + num())
                addArc(&path, from: cur, to: p, rx: rx, ry: ry, rotation: rot, largeArc: large, sweep: sweep)
                cur = p; lastCtrl = nil
            case "Z":
                path.closeSubpath(); cur = start; lastCtrl = nil
                continue
            default:
                i += 1
            }
        }
        return path
    }

    private static func tokenize(_ d: String) -> [String] {
        var out: [String] = []
        var numBuf = ""
        var sawDot = false
        func flush() { if !numBuf.isEmpty { out.append(numBuf) }; numBuf = ""; sawDot = false }
        for ch in d {
            if ch.isLetter && ch != "e" && ch != "E" {
                flush(); out.append(String(ch))
            } else if ch == "-" || ch == "+" {
                if let last = numBuf.last, last == "e" || last == "E" { numBuf.append(ch) } else { flush(); numBuf.append(ch) }
            } else if ch == "." {
                if sawDot { flush() }
                numBuf.append(ch); sawDot = true
            } else if ch == "e" || ch == "E" || ch.isNumber {
                numBuf.append(ch)
            } else {
                flush()
            }
        }
        flush()
        return out
    }

    /// SVG elliptical arc → cubic Béziers (endpoint parameterisation, SVG spec F.6.5).
    private static func addArc(_ path: inout Path, from p0: CGPoint, to p1: CGPoint, rx rxIn: CGFloat, ry ryIn: CGFloat, rotation: CGFloat, largeArc: Bool, sweep: Bool) {
        var rx = abs(rxIn), ry = abs(ryIn)
        if rx == 0 || ry == 0 || p0 == p1 { path.addLine(to: p1); return }
        let phi = rotation * .pi / 180
        let cosP = cos(phi), sinP = sin(phi)
        let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
        let x1 = cosP * dx + sinP * dy, y1 = -sinP * dx + cosP * dy
        let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
        if lambda > 1 { rx *= sqrt(lambda); ry *= sqrt(lambda) }
        let num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
        let den = rx * rx * y1 * y1 + ry * ry * x1 * x1
        var coef = sqrt(max(0, num / den))
        if largeArc == sweep { coef = -coef }
        let cxp = coef * (rx * y1 / ry), cyp = coef * (-ry * x1 / rx)
        let cx = cosP * cxp - sinP * cyp + (p0.x + p1.x) / 2
        let cy = sinP * cxp + cosP * cyp + (p0.y + p1.y) / 2
        func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            atan2(ux * vy - uy * vx, ux * vx + uy * vy)
        }
        let theta1 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry)
        var dTheta = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
        if !sweep && dTheta > 0 { dTheta -= 2 * .pi }
        if sweep && dTheta < 0 { dTheta += 2 * .pi }
        let segments = Int(ceil(abs(dTheta) / (.pi / 2)))
        let delta = dTheta / CGFloat(segments)
        let t = 4 / 3 * tan(delta / 4)
        var a = theta1
        func point(_ ang: CGFloat) -> CGPoint {
            let x = rx * cos(ang), y = ry * sin(ang)
            return CGPoint(x: cosP * x - sinP * y + cx, y: sinP * x + cosP * y + cy)
        }
        func deriv(_ ang: CGFloat) -> CGPoint {
            let x = -rx * sin(ang), y = ry * cos(ang)
            return CGPoint(x: cosP * x - sinP * y, y: sinP * x + cosP * y)
        }
        for _ in 0..<segments {
            let b = a + delta
            let s = point(a), e = point(b), ds = deriv(a), de = deriv(b)
            path.addCurve(to: e,
                          control1: CGPoint(x: s.x + t * ds.x, y: s.y + t * ds.y),
                          control2: CGPoint(x: e.x - t * de.x, y: e.y - t * de.y))
            a = b
        }
    }
}

// MARK: - The home page (board 20 + board 39, option A)

/// The first screen is the week, with a small arrow above the page dots saying there's more;
/// the crown scrolls down to Today and then the footer (the account).
struct WeekHomePage<Today: View, Footer: View>: View {
    let model: WeekModel
    let isLoading: Bool
    @ViewBuilder let today: () -> Today
    @ViewBuilder let footer: () -> Footer

    @State private var scrolled = false

    var body: some View {
        GeometryReader { geo in
            // 40/41/42/44mm: a slightly smaller week so all of it fits above the arrow
            let compact = geo.size.width < 190
            ScrollView {
                VStack(spacing: 0) {
                    VStack(spacing: compact ? 6 : 10) {
                        // Sits in the clock's row, like a watchOS title
                        Text("DaySeven")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundColor(.gray)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        if isLoading {
                            ProgressView()
                                .tint(.green)
                                .padding(.top, 40)
                        } else {
                            WeekHomeSection(model: model, compact: compact)
                        }
                    }
                    // Fills the first screen down to its bottom edge (the content is lifted 36pt
                    // into the clock's row, and the page runs under the bottom inset), so Today
                    // starts below the fold
                    .frame(minHeight: geo.size.height + geo.safeAreaInsets.bottom + 36 + 4, alignment: .top)

                    if !isLoading {
                        today()
                            .padding(.top, 4)
                        footer()
                            .padding(.top, 18)
                            .padding(.bottom, 24)
                    }
                }
                .padding(.horizontal, 4)
                .offset(y: -36)
            }
            .scrollBounceBehavior(.basedOnSize)
            .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y > 8 } action: { _, now in
                withAnimation(.easeOut(duration: 0.15)) { scrolled = now }
            }
        }
        // The "more below" arrow: pinned just above the page dots (drawn at the screen's
        // bottom edge, 6pt up), and gone once the crown has scrolled
        .overlay {
            GeometryReader { g in
                WeekLineIcon(icon: .chevronDown, color: WeekColors.faint, size: 13, lineWidth: 2.6)
                    .opacity(0.8)
                    .position(x: g.size.width / 2, y: g.size.height - 21)
            }
            .ignoresSafeArea(edges: .bottom)
            .opacity(isLoading || scrolled ? 0 : 1)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }
}

// MARK: - Today, under the week (board 39, option A: the crown scrolls down to it)

/// One of today's workouts, as the Today section lists it.
struct TodayWorkoutItem: Identifiable {
    let id: String
    let name: String
    let meta: String
    let color: Color
    let icon: WeekLineIcon.Icon
}

/// Steps against today's share of the week, calories, distance and today's workouts.
struct TodaySection: View {
    let todaySteps: Int
    /// Today's share of what's left of the weekly goal; nil once the week's steps are done
    let todayTarget: Int?
    let weekGoal: Int
    let calories: Int
    let distance: Double   // already in the user's unit
    let distanceUnit: String
    let workouts: [TodayWorkoutItem]

    static let calColor = Color(red: 1.0, green: 0.420, blue: 0.420)  // #FF6B6B, the phone's live-workout calories
    static let pinColor = Color(white: 0.81)                          // #cfcfcf

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            divider
            stepsCard
                .padding(.bottom, 8)
            HStack(spacing: 8) {
                miniCard(icon: .calories, color: Self.calColor, label: "Cal", value: "\(calories)")
                miniCard(icon: .pin, color: Self.pinColor, label: distanceUnit == "km" ? "Km" : "Mi",
                         value: String(format: "%.1f", distance))
            }
            .padding(.bottom, 10)
            caps("Workouts", size: 9.5)
                .padding(.horizontal, 2)
                .padding(.bottom, 7)
            if workouts.isEmpty {
                Text("No workouts yet today")
                    .font(.system(size: 12))
                    .foregroundColor(WeekColors.muted)
                    .padding(.horizontal, 2)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(workouts) { workoutRow($0) }
                }
                .padding(.horizontal, 2)
            }
        }
    }

    private var divider: some View {
        HStack(spacing: 6) {
            Rectangle().fill(Color.white.opacity(0.12)).frame(height: 1)
            caps("Today", size: 10)
            Rectangle().fill(Color.white.opacity(0.12)).frame(height: 1)
        }
        .padding(.horizontal, 2)
        .padding(.bottom, 10)
    }

    private var stepsCard: some View {
        let done = todayTarget == nil
        let fraction = done ? 1 : min(1, Double(todaySteps) / Double(max(todayTarget ?? 1, 1)))
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 5) {
                WeekLineIcon(icon: .steps, color: AppColors.steps, size: 13)
                Text("Steps").font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
                Spacer(minLength: 4)
                (Text(WeekModel.k(todaySteps)).font(.system(size: 17, weight: .bold)).foregroundColor(.white)
                 + Text(todayTarget.map { "/\(WeekModel.k($0))" } ?? "")
                    .font(.system(size: 12, weight: .bold)).foregroundColor(WeekColors.faint))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(AppColors.steps.opacity(0.22))
                    Capsule().fill(AppColors.steps)
                        .frame(width: max(6, geo.size.width * fraction))
                        .opacity(done || todaySteps > 0 ? 1 : 0)
                }
            }
            .frame(height: 6)
            .padding(.top, 7)
            // "Week won" now means all three goals, so a done steps week says just that
            Text(done ? "Steps done for the week" : "On pace for \(WeekModel.k0(weekGoal)) this week")
                .font(.system(size: 11))
                .foregroundColor(WeekColors.muted)
                .lineLimit(2)
                .padding(.top, 6)
        }
        .padding(EdgeInsets(top: 10, leading: 11, bottom: 11, trailing: 11))
        .background(TodayCard())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(done ? "\(todaySteps) steps today. Steps done for the week"
                                 : "\(todaySteps) of \(todayTarget ?? 0) steps today")
    }

    private func miniCard(icon: WeekLineIcon.Icon, color: Color, label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                WeekLineIcon(icon: icon, color: color, size: 11, lineWidth: 2.4)
                caps(label, size: 8.5)
            }
            Text(value)
                .font(.system(size: 17, weight: .bold))
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(EdgeInsets(top: 8, leading: 9, bottom: 9, trailing: 9))
        .background(TodayCard())
        .accessibilityElement(children: .combine)
    }

    private func workoutRow(_ w: TodayWorkoutItem) -> some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 8)
                .fill(w.color.opacity(0.16))
                .frame(width: 26, height: 26)
                .overlay(WeekLineIcon(icon: w.icon, color: w.color, size: 14))
            VStack(alignment: .leading, spacing: 1) {
                Text(w.name)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                if !w.meta.isEmpty {
                    Text(w.meta)
                        .font(.system(size: 10.5))
                        .foregroundColor(WeekColors.muted)
                        .lineLimit(1)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func caps(_ text: String, size: CGFloat) -> some View {
        Text(text.uppercased())
            .font(.system(size: size, weight: .bold))
            .tracking(size * 0.13)
            .foregroundColor(WeekColors.muted)
            .lineLimit(1)
    }
}

/// The phone's card surface: a faint white gradient, rounded 14.
struct TodayCard: View {
    var cornerRadius: CGFloat = 14
    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius)
            .fill(LinearGradient(colors: [Color.white.opacity(0.085), Color.white.opacity(0.05)],
                                 startPoint: .top, endPoint: .bottom))
    }
}

// MARK: - Shared pieces for the rest of the watch (boards 40 and 41)

/// The play glyph: a filled triangle with softened corners.
struct PlayGlyph: View {
    let color: Color
    let size: CGFloat

    var body: some View {
        let s = size / 24
        Path { p in
            p.move(to: CGPoint(x: 8 * s, y: 5.5 * s))
            p.addLine(to: CGPoint(x: 19 * s, y: 12 * s))
            p.addLine(to: CGPoint(x: 8 * s, y: 18.5 * s))
            p.closeSubpath()
        }
        .fill(color)
        .overlay(
            Path { p in
                p.move(to: CGPoint(x: 8 * s, y: 5.5 * s))
                p.addLine(to: CGPoint(x: 19 * s, y: 12 * s))
                p.addLine(to: CGPoint(x: 8 * s, y: 18.5 * s))
                p.closeSubpath()
            }
            .stroke(color, style: StrokeStyle(lineWidth: 1.6 * s, lineJoin: .round))
        )
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// A category's colour, line icon and name, as Home draws them.
enum CategoryLook {
    case strength, cardio, recovery, neutral

    init(_ category: ActivityCategoryType?) {
        switch category {
        case .strength: self = .strength
        case .cardio: self = .cardio
        case .recovery: self = .recovery
        case nil: self = .neutral
        }
    }

    var color: Color {
        switch self {
        case .strength: return AppColors.strength
        case .cardio: return AppColors.cardio
        case .recovery: return AppColors.recovery
        case .neutral: return .white
        }
    }

    /// The badge and play-button tint (hybrid activities have no category yet: neutral white)
    var tint: Color { color.opacity(self == .neutral ? 0.14 : 0.2) }
    var badgeTint: Color { color.opacity(self == .neutral ? 0.12 : 0.16) }

    var icon: WeekLineIcon.Icon {
        switch self {
        case .strength: return .strength
        case .cardio: return .cardio
        case .recovery, .neutral: return .recovery
        }
    }
}

/// An activity's icon: Home's line icon where there is one, else its SF Symbol.
struct ActivityIcon: View {
    let name: String
    let sfSymbol: String
    let color: Color
    let size: CGFloat

    private var line: WeekLineIcon.Icon? {
        switch name {
        case "Weightlifting", "Strength Training": return .dumbbell
        case "Bodyweight": return .body
        case "Circuit": return .circuit
        case "Running": return .run
        case "Cycle": return .bike
        default: return nil
        }
    }

    var body: some View {
        if let line {
            WeekLineIcon(icon: line, color: color, size: size)
        } else {
            Image(systemName: sfSymbol)
                .font(.system(size: size * 0.9, weight: .medium))
                .foregroundColor(color)
                .frame(width: size, height: size)
                .accessibilityHidden(true)
        }
    }
}

/// White caps label, the watch's small grey headings.
struct CapsText: View {
    let text: String
    var size: CGFloat = 10
    var color: Color = WeekColors.muted

    init(_ text: String, size: CGFloat = 10, color: Color = WeekColors.muted) {
        self.text = text; self.size = size; self.color = color
    }

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: size, weight: .bold))
            .tracking(size * 0.13)
            .foregroundColor(color)
            .lineLimit(1)
    }
}

/// A full-width pill: white with black content for the main action.
struct PillLabel<Icon: View>: View {
    let title: String
    var background: Color = .white
    var foreground: Color = .black
    var fontSize: CGFloat = 14
    var verticalPadding: CGFloat = 9
    @ViewBuilder let icon: () -> Icon

    var body: some View {
        HStack(spacing: 6) {
            icon()
            Text(title).font(.system(size: fontSize, weight: .bold))
        }
        .foregroundColor(foreground)
        .frame(maxWidth: .infinity)
        .padding(.vertical, verticalPadding)
        .background(Capsule().fill(background))
        .contentShape(Capsule())
    }
}
