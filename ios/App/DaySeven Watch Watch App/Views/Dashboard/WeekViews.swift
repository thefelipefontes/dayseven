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

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                WeekPercentView(model: model, size: 40)
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
                    .padding(.top, 8)
            } else {
                Text(model.daysLeftText)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(WeekColors.daysLeft)
                    .lineLimit(1)
                    .padding(.top, 6)
            }

            VStack(spacing: 9) {
                WeekGoalRow(model: model, goal: .strength)
                WeekGoalRow(model: model, goal: .cardio)
                WeekGoalRow(model: model, goal: .steps)
            }
            .padding(.top, model.won ? 13 : 11)
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
            .minimumScaleFactor(0.8)
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
    enum Icon { case strength, cardio, steps }

    let icon: Icon
    let color: Color
    let size: CGFloat

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
        }
    }

    var body: some View {
        let scale = size / 24
        ZStack {
            ForEach(Self.paths(icon), id: \.self) { d in
                WeekSVGPath.path(d)
                    .applying(CGAffineTransform(scaleX: scale, y: scale))
                    .stroke(color, style: StrokeStyle(lineWidth: 2 * scale, lineCap: .round, lineJoin: .round))
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
