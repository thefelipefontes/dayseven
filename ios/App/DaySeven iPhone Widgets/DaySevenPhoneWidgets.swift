import WidgetKit
import SwiftUI

// MARK: - Timeline Entry

struct DaySevenPhoneEntry: TimelineEntry {
    let date: Date
    let data: WidgetStreakData
}

// MARK: - Timeline Provider

struct DaySevenPhoneTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> DaySevenPhoneEntry {
        DaySevenPhoneEntry(date: .now, data: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (DaySevenPhoneEntry) -> Void) {
        let data = SharedDefaults.readStreakData()
        completion(DaySevenPhoneEntry(date: .now, data: data))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DaySevenPhoneEntry>) -> Void) {
        let data = SharedDefaults.readStreakData()
        let entry = DaySevenPhoneEntry(date: .now, data: data)
        // Every 30 minutes, and at midnight so today's numbers reset on time
        let calendar = Calendar.current
        let inThirtyMinutes = calendar.date(byAdding: .minute, value: 30, to: .now)!
        let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: .now)) ?? inThirtyMinutes
        let timeline = Timeline(entries: [entry], policy: .after(min(inThirtyMinutes, midnight)))
        completion(timeline)
    }
}

// MARK: - Placeholder data for widget gallery

extension WidgetStreakData {
    static let placeholder = WidgetStreakData(
        masterStreak: 3, liftsStreak: 12, cardioStreak: 9, recoveryStreak: 5,
        liftsCompleted: 3, liftsGoal: 3,
        cardioCompleted: 1, cardioGoal: 2,
        recoveryCompleted: 2, recoveryGoal: 2,
        todaySteps: 9183, stepsGoal: 10000, todayCalories: 347,
        daysLeftInWeek: 3,
        lastUpdated: Date().timeIntervalSince1970,
        injuryModeActive: false,
        recentActivities: [
            WidgetActivity(name: "Weightlifting · Chest, Back", category: "lifting", date: "2026-03-19", duration: 58, calories: 384),
            WidgetActivity(name: "Running", category: "cardio", date: "2026-03-18", duration: 31, calories: 342)
        ],
        weekSteps: 52400, weekStartDate: "", showCalories: true
    )
}

// MARK: - Widget Colors

struct WidgetColors {
    static let strength = Color(red: 0.0, green: 1.0, blue: 0.58)    // #00FF94
    static let cardio = Color(red: 1.0, green: 0.58, blue: 0.0)      // #FF9500
    static let recovery = Color(red: 0.0, green: 0.82, blue: 1.0)    // #00D1FF
    static let steps = Color(red: 0.749, green: 0.353, blue: 0.949)  // #BF5AF2, same as the app
    static let gold = Color(red: 1.0, green: 0.843, blue: 0.0)       // #FFD700 — the winning streak and a won week
    static let streak = gold
    static let injury = Color(red: 0.655, green: 0.545, blue: 0.980) // #A78BFA — streak paused
    static let muted = Color(red: 0.541, green: 0.541, blue: 0.541)  // #8a8a8a — caps labels, meta
    static let faint = Color(red: 0.435, green: 0.435, blue: 0.435)  // #6f6f6f — a value's "/goal"
    static let backgroundTop = Color(red: 0.098, green: 0.098, blue: 0.106)    // #19191B
    static let backgroundBottom = Color(red: 0.059, green: 0.059, blue: 0.063) // #0F0F10
    static let background = backgroundBottom

    /// The week's % warms from white to gold as the week fills: rgb(255, 255−40t, 255·(1−t)).
    static func goldMix(_ pct: Int) -> Color {
        let t = min(1, max(0, Double(pct) / 100))
        return Color(red: 1, green: (255 - 40 * t) / 255, blue: 1 - t)
    }
}

/// The widget's surface: Home's card gradient with a faint top edge.
struct WidgetSurface: View {
    var body: some View {
        ZStack(alignment: .top) {
            LinearGradient(colors: [WidgetColors.backgroundTop, WidgetColors.backgroundBottom], startPoint: .top, endPoint: .bottom)
            Rectangle().fill(Color.white.opacity(0.07)).frame(height: 1)
        }
    }
}

// MARK: - The week, as Home shows it

/// Everything a widget needs to draw the week, worked out once from the shared data and the
/// entry's date (the week runs Sunday–Saturday, like the app).
struct WeekModel {
    enum Goal { case strength, cardio, steps }

    let data: WidgetStreakData
    let finishedDays: Int   // Sunday = 0 … Saturday = 6
    let weekStart: Date

    init(data: WidgetStreakData, date: Date) {
        self.data = data
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        let finished = cal.component(.weekday, from: date) - 1
        finishedDays = finished
        weekStart = cal.date(byAdding: .day, value: -finished, to: cal.startOfDay(for: date)) ?? date
    }

    var daysLeft: Int { 7 - finishedDays }

    func done(_ g: Goal) -> Int {
        switch g {
        case .strength: return data.liftsCompleted
        case .cardio: return data.cardioCompleted
        case .steps: return data.weekSteps
        }
    }
    func goal(_ g: Goal) -> Int {
        switch g {
        case .strength: return data.liftsGoal
        case .cardio: return data.cardioGoal
        case .steps: return data.weekStepsGoal
        }
    }
    func met(_ g: Goal) -> Bool { goal(g) > 0 && done(g) >= goal(g) }
    func fraction(_ g: Goal) -> Double { goal(g) > 0 ? min(1, Double(done(g)) / Double(goal(g))) : 1 }

    /// Home's week %: the average of the three goals, each capped at 100%.
    var percent: Int { Int(((fraction(.strength) + fraction(.cardio) + fraction(.steps)) / 3 * 100).rounded()) }
    var won: Bool { met(.strength) && met(.cardio) && met(.steps) }

    /// Where the steps bar should be by now (finished days / 7). None on Sunday or once done.
    var paceFraction: Double? {
        guard finishedDays > 0, !met(.steps) else { return nil }
        return Double(finishedDays) / 7
    }

    /// "Nov 8 – 14", or "Nov 29 – Dec 5" across months.
    var dateRange: String {
        let cal = Calendar(identifier: .gregorian)
        let end = cal.date(byAdding: .day, value: 6, to: weekStart) ?? weekStart
        let month = DateFormatter()
        month.dateFormat = "MMM"
        let sameMonth = cal.component(.month, from: weekStart) == cal.component(.month, from: end)
        let startDay = cal.component(.day, from: weekStart), endDay = cal.component(.day, from: end)
        return sameMonth
            ? "\(month.string(from: weekStart)) \(startDay) – \(endDay)"
            : "\(month.string(from: weekStart)) \(startDay) – \(month.string(from: end)) \(endDay)"
    }

    /// Home's wording: "3 days left", "1 day left"; once won, "2 days to spare".
    var daysLeftText: String {
        let unit = daysLeft == 1 ? "day" : "days"
        return won ? "\(daysLeft) \(unit) to spare" : "\(daysLeft) \(unit) left"
    }
}

enum WidgetFormat {
    /// 52400 → "52.4k", 70000 → "70k"
    static func k(_ n: Int) -> String {
        let s = String(format: "%.1fk", Double(n) / 1000.0)
        return s.replacingOccurrences(of: ".0k", with: "k")
    }
    /// 70000 → "70k" (rounded)
    static func k0(_ n: Int) -> String { "\(Int((Double(n) / 1000).rounded()))k" }

    static func duration(_ minutes: Int) -> String {
        if minutes >= 60 {
            let h = minutes / 60, m = minutes % 60
            return m > 0 ? "\(h)h \(m)m" : "\(h)h"
        }
        return "\(minutes) min"
    }

    static func day(_ dateStr: String) -> String {
        // A fixed-format date key: parse it in the Gregorian calendar with the POSIX locale, or a
        // device set to the Buddhist or Japanese calendar reads "2026" as a year in that era.
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: dateStr) else { return dateStr }
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }
        let dayFormatter = DateFormatter()
        dayFormatter.dateFormat = "EEE"
        return dayFormatter.string(from: date)
    }
}

// MARK: - Line icons (the same paths Home uses, drawn from their SVG source)

enum LineIcon {
    case strength, cardio, steps, dumbbell, run, snowflake, alert

    var paths: [String] {
        switch self {
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
        case .alert: return ["M12 9v4", "M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z", "M12 16h.01"]
        }
    }
}

/// A 24×24 SVG line icon at any size, stroked like the app's (width 2, round caps and joins).
struct LineIconView: View {
    let icon: LineIcon
    let color: Color
    let size: CGFloat
    var lineWidth: CGFloat = 2

    var body: some View {
        let scale = size / 24
        ZStack {
            ForEach(icon.paths, id: \.self) { d in
                SVGPath.path(d)
                    .applying(CGAffineTransform(scaleX: scale, y: scale))
                    .stroke(color, style: StrokeStyle(lineWidth: lineWidth * scale, lineCap: .round, lineJoin: .round))
            }
        }
        .frame(width: size, height: size)
    }
}

/// A small SVG path-data parser (M L H V C S Q T A Z, absolute and relative): enough for the icon
/// set above without adding image assets to the project.
enum SVGPath {
    static func path(_ d: String) -> Path {
        var path = Path()
        let tokens = tokenize(d)
        var i = 0
        var cmd: Character = "M"
        var cur = CGPoint.zero, start = CGPoint.zero
        var lastCtrl: CGPoint? = nil
        func num() -> CGFloat { defer { i += 1 }; return CGFloat(Double(tokens[i]) ?? 0) }
        func hasNum() -> Bool { i < tokens.count && Double(tokens[i]) != nil }
        while i < tokens.count {
            if let c = tokens[i].first, tokens[i].count == 1, c.isLetter { cmd = c; i += 1 }
            let rel = cmd.isLowercase
            let base = rel ? cur : .zero
            switch cmd.uppercased().first! {
            case "M":
                let p = CGPoint(x: base.x + num(), y: base.y + num())
                path.move(to: p); cur = p; start = p; lastCtrl = nil
                cmd = rel ? "l" : "L" // further pairs are line-tos
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
                if hasNum() { cmd = "M" } // shouldn't happen in these icons
                continue
            default:
                i += 1
            }
        }
        return path
    }

    /// Splits path data into command letters and numbers ("2.6-1.4" → "2.6", "-1.4"; ".5.5" → ".5", ".5").
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
            } else if ch == "e" || ch == "E" {
                numBuf.append(ch)
            } else if ch.isNumber {
                numBuf.append(ch)
            } else {
                flush() // space or comma
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

// MARK: - Shared pieces (sizes in points, from mocks/mock-native.html board 19)

private extension WeekModel.Goal {
    var color: Color {
        switch self {
        case .strength: return WidgetColors.strength
        case .cardio: return WidgetColors.cardio
        case .steps: return WidgetColors.steps
        }
    }
    var icon: LineIcon {
        switch self {
        case .strength: return .strength
        case .cardio: return .cardio
        case .steps: return .steps
        }
    }
    var name: String {
        switch self {
        case .strength: return "Strength"
        case .cardio: return "Cardio"
        case .steps: return "Steps"
        }
    }
}

/// Tinted and Clear home screens draw widgets in one tint: there the filled parts are marked
/// accentable and the empty parts drop to a plain faint white, so done vs. to-do still reads.
struct WidgetStyle {
    let accented: Bool
    func fill(_ c: Color) -> Color { accented ? .white : c }
    func empty(_ c: Color) -> Color { accented ? Color.white.opacity(0.22) : c.opacity(0.22) }
}

/// The week's % — the widget's one big number. Gold with a glow once the week is won.
struct BigPercent: View {
    let model: WeekModel
    let size: CGFloat
    let style: WidgetStyle

    var body: some View {
        let color = model.won ? WidgetColors.gold : WidgetColors.goldMix(model.percent)
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text("\(model.percent)")
                .font(.system(size: size, weight: .heavy))
                .tracking(-size * 0.045)
            Text("%")
                .font(.system(size: (size * 0.46).rounded(), weight: .heavy))
        }
        .foregroundColor(style.accented ? .white : color)
        .shadow(color: (model.won && !style.accented) ? WidgetColors.gold.opacity(0.45) : .clear, radius: 9)
        .widgetAccentable()
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }
}

struct CapsLabel: View {
    let text: String
    let size: CGFloat
    var color: Color = WidgetColors.muted

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: size, weight: .bold))
            .tracking(size * 0.13)
            .foregroundColor(color)
            .lineLimit(1)
    }
}

/// The winning streak: a gold flame and the number. On an injury pause: a violet bandage.
struct StreakChip: View {
    let data: WidgetStreakData
    let size: CGFloat

    var body: some View {
        let paused = data.injuryModeActive
        HStack(spacing: (size * 0.25).rounded()) {
            Image(systemName: paused ? "bandage.fill" : "flame.fill")
                .font(.system(size: (size * 0.95).rounded()))
            Text("\(data.masterStreak)")
                .font(.system(size: size, weight: .heavy))
        }
        .foregroundColor(paused ? WidgetColors.injury : WidgetColors.gold)
    }
}

/// One block per session in the goal's colour; empty ones at 22%. A finished goal glows.
struct SessionBlocks: View {
    let done: Int
    let goal: Int
    let color: Color
    let height: CGFloat
    let gap: CGFloat
    let met: Bool
    let style: WidgetStyle

    var body: some View {
        HStack(spacing: gap) {
            ForEach(0..<max(goal, 1), id: \.self) { i in
                let filled = i < done
                Capsule()
                    .fill(filled ? style.fill(color) : style.empty(color))
                    .frame(height: height)
                    .shadow(color: (met && filled && !style.accented) ? color.opacity(0.55) : .clear, radius: (height + 1) / 2)
                    .modifier(AccentIf(filled))
            }
        }
    }
}

/// The week's steps against the weekly goal, with a white pace tick at finished days / 7.
struct StepsBar: View {
    let model: WeekModel
    let height: CGFloat
    let style: WidgetStyle

    var body: some View {
        let met = model.met(.steps)
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(style.empty(WidgetColors.steps))
                Capsule()
                    .fill(style.fill(WidgetColors.steps))
                    .frame(width: max(height, geo.size.width * model.fraction(.steps)))
                    .opacity(model.done(.steps) > 0 ? 1 : 0)
                    .shadow(color: (met && !style.accented) ? WidgetColors.steps.opacity(0.55) : .clear, radius: (height + 1) / 2)
                    .widgetAccentable()
            }
            .frame(height: height)
            // The pace tick hangs past the bar's top and bottom without changing its height
            .overlay(alignment: .leading) {
                if let pace = model.paceFraction {
                    let overhang = (height * 0.45).rounded()
                    RoundedRectangle(cornerRadius: 1)
                        .fill(Color.white)
                        .frame(width: 2, height: height + overhang * 2)
                        .background(RoundedRectangle(cornerRadius: 2).fill(WidgetColors.backgroundBottom).padding(-1.5))
                        .offset(x: geo.size.width * pace - 1)
                }
            }
        }
        .frame(height: height)
    }
}

private struct AccentIf: ViewModifier {
    let on: Bool
    init(_ on: Bool) { self.on = on }
    func body(content: Content) -> some View {
        if on { content.widgetAccentable() } else { content }
    }
}

/// A goal's track: blocks for sessions, the bar for steps.
struct GoalTrack: View {
    let model: WeekModel
    let goal: WeekModel.Goal
    let height: CGFloat
    let gap: CGFloat
    let style: WidgetStyle

    var body: some View {
        if goal == .steps {
            StepsBar(model: model, height: height, style: style)
        } else {
            SessionBlocks(done: model.done(goal), goal: model.goal(goal), color: goal.color, height: height, gap: gap, met: model.met(goal), style: style)
        }
    }
}

/// "3/3", "52.4k/70k": the number in white, the "/goal" small and grey.
struct GoalValue: View {
    let model: WeekModel
    let goal: WeekModel.Goal
    let size: CGFloat
    let smallSize: CGFloat
    var showGoal = true

    var body: some View {
        let main = goal == .steps ? WidgetFormat.k(model.done(.steps)) : "\(model.done(goal))"
        let rest = goal == .steps ? "/\(WidgetFormat.k0(model.goal(.steps)))" : "/\(model.goal(goal))"
        (Text(main).font(.system(size: size, weight: .heavy)).foregroundColor(.white)
         + (showGoal ? Text(rest).font(.system(size: smallSize, weight: .bold)).foregroundColor(WidgetColors.faint) : Text("")))
            .lineLimit(1)
    }
}

/// A finished goal's check, on a soft tint of its colour.
struct CheckBadge: View {
    let color: Color
    let size: CGFloat
    let style: WidgetStyle

    var body: some View {
        ZStack {
            Circle().fill(style.accented ? Color.white.opacity(0.2) : color.opacity(0.16))
            LineIconPath(d: "M5 12l5 5l10 -10", color: style.fill(color), size: (size * 0.62).rounded(), lineWidth: 3.2)
        }
        .frame(width: size, height: size)
        .widgetAccentable()
    }
}

private struct LineIconPath: View {
    let d: String
    let color: Color
    let size: CGFloat
    let lineWidth: CGFloat
    var body: some View {
        let s = size / 24
        SVGPath.path(d)
            .applying(CGAffineTransform(scaleX: s, y: s))
            .stroke(color, style: StrokeStyle(lineWidth: lineWidth * s, lineCap: .round, lineJoin: .round))
            .frame(width: size, height: size)
    }
}

// MARK: - Small

struct SmallWidgetView: View {
    let model: WeekModel
    let style: WidgetStyle

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                BigPercent(model: model, size: 36, style: style)
                Spacer(minLength: 4)
                StreakChip(data: model.data, size: 15)
            }
            CapsLabel(text: model.won ? "Week won" : "Week · \(model.daysLeftText)", size: 9.5,
                      color: model.won ? WidgetColors.gold : WidgetColors.muted)
                .padding(.top, 8)
            VStack(spacing: 10) {
                ForEach([WeekModel.Goal.strength, .cardio, .steps], id: \.self) { g in
                    HStack(spacing: 6) {
                        LineIconView(icon: g.icon, color: style.fill(g.color), size: 13)
                        GoalTrack(model: model, goal: g, height: 7, gap: 3, style: style)
                        GoalValue(model: model, goal: g, size: 11, smallSize: 7, showGoal: g != .steps)
                            .frame(width: 34, alignment: .trailing)
                    }
                    .frame(height: 15)
                }
            }
            .padding(.top, 16)
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Medium

struct MediumWidgetView: View {
    let model: WeekModel
    let style: WidgetStyle

    var body: some View {
        HStack(spacing: 18) {
            VStack(alignment: .leading, spacing: 0) {
                BigPercent(model: model, size: 46, style: style)
                CapsLabel(text: model.won ? "Week won" : "Week progress", size: 9.5,
                          color: model.won ? WidgetColors.gold : WidgetColors.muted)
                    .padding(.top, 9)
                Spacer(minLength: 6)
                Text(model.daysLeftText)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Color(white: 0.667))
                HStack(spacing: 5) {
                    StreakChip(data: model.data, size: 14)
                    CapsLabel(text: model.data.injuryModeActive ? "paused" : "wk streak", size: 8.5,
                              color: model.data.injuryModeActive ? WidgetColors.injury : WidgetColors.gold.opacity(0.85))
                }
                .padding(.top, 6)
            }
            .frame(width: 112, alignment: .leading)

            VStack(spacing: 0) {
                ForEach(Array([WeekModel.Goal.strength, .cardio, .steps].enumerated()), id: \.offset) { idx, g in
                    if idx > 0 { Spacer(minLength: 6) }
                    VStack(spacing: 6) {
                        HStack(spacing: 5) {
                            LineIconView(icon: g.icon, color: style.fill(g.color), size: 13)
                            Text(g.name).font(.system(size: 12, weight: .semibold)).foregroundColor(.white)
                            Spacer(minLength: 4)
                            GoalValue(model: model, goal: g, size: 15, smallSize: 9)
                            if model.met(g) { CheckBadge(color: g.color, size: 15, style: style) }
                        }
                        GoalTrack(model: model, goal: g, height: 7, gap: 4, style: style)
                    }
                }
            }
            .padding(.vertical, 1)
        }
    }
}

// MARK: - Large

struct LargeWidgetView: View {
    let model: WeekModel
    let style: WidgetStyle

    var body: some View {
        let data = model.data
        VStack(alignment: .leading, spacing: 0) {
            // Header: the streak, and the week's dates
            HStack(spacing: 6) {
                StreakChip(data: data, size: 13)
                CapsLabel(text: data.injuryModeActive ? "Streak paused" : "Week winning streak", size: 9,
                          color: data.injuryModeActive ? WidgetColors.injury : WidgetColors.gold.opacity(0.85))
                Spacer(minLength: 4)
                Text(model.dateRange)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(WidgetColors.muted)
            }
            .padding(.bottom, 12)

            // The week's % (the one big number) and the days left
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 0) {
                    BigPercent(model: model, size: 50, style: style)
                    CapsLabel(text: model.won ? "Week won" : "Week progress", size: 10,
                              color: model.won ? WidgetColors.gold : WidgetColors.muted)
                        .padding(.top, 10)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 0) {
                    Text("\(model.daysLeft)")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(.white)
                    CapsLabel(text: model.won ? (model.daysLeft == 1 ? "Day to spare" : "Days to spare") : (model.daysLeft == 1 ? "Day left" : "Days left"), size: 10)
                        .padding(.top, 6)
                }
            }
            .padding(.bottom, 12)
            Rectangle().fill(Color.white.opacity(0.08)).frame(height: 1)

            // Strength, Cardio, Steps
            VStack(spacing: 13) {
                ForEach([WeekModel.Goal.strength, .cardio, .steps], id: \.self) { g in
                    VStack(spacing: 7) {
                        HStack(spacing: 5) {
                            LineIconView(icon: g.icon, color: style.fill(g.color), size: 15)
                            Text(g.name).font(.system(size: 14, weight: .semibold)).foregroundColor(.white)
                            Spacer(minLength: 4)
                            GoalValue(model: model, goal: g, size: 17, smallSize: 13)
                            if model.met(g) { CheckBadge(color: g.color, size: 17, style: style) }
                        }
                        GoalTrack(model: model, goal: g, height: 9, gap: 5, style: style)
                    }
                }
            }
            .padding(.top, 14)

            // Recent workouts
            CapsLabel(text: "Recent", size: 9.5)
                .padding(.top, 18)
                .padding(.bottom, 8)
            if data.recentActivities.isEmpty {
                Text("No workouts yet this week")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(WidgetColors.muted)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(data.recentActivities.prefix(2).enumerated()), id: \.offset) { _, a in
                        RecentRow(activity: a, showCalories: data.showCalories, style: style)
                    }
                }
            }
            Spacer(minLength: 0)
        }
    }
}

struct RecentRow: View {
    let activity: WidgetActivity
    let showCalories: Bool
    let style: WidgetStyle

    var body: some View {
        let (color, icon): (Color, LineIcon) = {
            switch activity.category {
            case "lifting": return (WidgetColors.strength, .dumbbell)
            case "cardio": return (WidgetColors.cardio, .run)
            case "recovery": return (WidgetColors.recovery, .snowflake)
            default: return (Color(white: 0.667), .run)
            }
        }()
        var meta = [WidgetFormat.day(activity.date)]
        if activity.duration > 0 { meta.append(WidgetFormat.duration(activity.duration)) }
        if showCalories && activity.calories > 0 { meta.append("\(activity.calories) cal") }
        return HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 8).fill(style.accented ? Color.white.opacity(0.12) : color.opacity(0.16))
                LineIconView(icon: icon, color: style.fill(color), size: 15)
            }
            .frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 1) {
                Text(activity.name)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                Text(meta.joined(separator: " · "))
                    .font(.system(size: 11))
                    .foregroundColor(WidgetColors.muted)
                    .lineLimit(1)
            }
        }
    }
}

// MARK: - Widget Definition

struct DaySevenProgressWidget: Widget {
    let kind = "DaySevenPhoneWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DaySevenPhoneTimelineProvider()) { entry in
            if #available(iOS 17.0, *) {
                DaySevenPhoneWidgetEntryView(entry: entry)
                    .containerBackground(for: .widget) { WidgetSurface() }
            } else {
                DaySevenPhoneWidgetEntryView(entry: entry)
                    .padding()
                    .background(WidgetSurface())
            }
        }
        .configurationDisplayName("DaySeven Progress")
        .description("Your week at a glance: the week's %, your goals and your streak.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

// MARK: - Entry View Router

struct DaySevenPhoneWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    @Environment(\.widgetRenderingMode) var renderingMode
    let entry: DaySevenPhoneEntry

    var body: some View {
        let model = WeekModel(data: entry.data, date: entry.date)
        let style = WidgetStyle(accented: renderingMode == .accented)
        switch family {
        case .systemMedium:
            MediumWidgetView(model: model, style: style)
        case .systemLarge:
            LargeWidgetView(model: model, style: style)
        default:
            SmallWidgetView(model: model, style: style)
        }
    }
}

// MARK: - Previews (board 19's two weeks)

extension WidgetStreakData {
    /// Thursday: 3/3 strength, 1/2 cardio, 52.4k of 70k steps, streak 3
    static let previewThursday = WidgetStreakData(
        masterStreak: 3, liftsStreak: 5, cardioStreak: 3, recoveryStreak: 2,
        liftsCompleted: 3, liftsGoal: 3, cardioCompleted: 1, cardioGoal: 2,
        recoveryCompleted: 1, recoveryGoal: 2,
        todaySteps: 9183, stepsGoal: 10000, todayCalories: 386,
        daysLeftInWeek: 3, lastUpdated: 0, injuryModeActive: false,
        recentActivities: [
            WidgetActivity(name: "Weightlifting · Chest, Back", category: "lifting", date: "2026-11-12", duration: 58, calories: 384),
            WidgetActivity(name: "Running · 3.1 mi", category: "cardio", date: "2026-11-09", duration: 31, calories: 342)
        ],
        weekSteps: 52400, weekStartDate: "2026-11-08", showCalories: true)

    /// The won Friday: 3/3, 2/2, 71.2k, streak 4
    static let previewWonFriday = WidgetStreakData(
        masterStreak: 4, liftsStreak: 6, cardioStreak: 4, recoveryStreak: 2,
        liftsCompleted: 3, liftsGoal: 3, cardioCompleted: 2, cardioGoal: 2,
        recoveryCompleted: 1, recoveryGoal: 2,
        todaySteps: 13100, stepsGoal: 10000, todayCalories: 512,
        daysLeftInWeek: 2, lastUpdated: 0, injuryModeActive: false,
        recentActivities: [
            WidgetActivity(name: "Running · 3.4 mi", category: "cardio", date: "2026-11-13", duration: 33, calories: 371),
            WidgetActivity(name: "Weightlifting · Chest, Back", category: "lifting", date: "2026-11-12", duration: 58, calories: 384)
        ],
        weekSteps: 71200, weekStartDate: "2026-11-08", showCalories: true)

    static func previewDate(_ s: String) -> Date {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH:mm"
        return f.date(from: s) ?? .now
    }
}

@available(iOS 17.0, *)
#Preview("Small", as: .systemSmall) {
    DaySevenProgressWidget()
} timeline: {
    DaySevenPhoneEntry(date: WidgetStreakData.previewDate("2026-11-12 12:00"), data: .previewThursday)
    DaySevenPhoneEntry(date: WidgetStreakData.previewDate("2026-11-13 12:00"), data: .previewWonFriday)
}

@available(iOS 17.0, *)
#Preview("Medium", as: .systemMedium) {
    DaySevenProgressWidget()
} timeline: {
    DaySevenPhoneEntry(date: WidgetStreakData.previewDate("2026-11-12 12:00"), data: .previewThursday)
    DaySevenPhoneEntry(date: WidgetStreakData.previewDate("2026-11-13 12:00"), data: .previewWonFriday)
}

@available(iOS 17.0, *)
#Preview("Large", as: .systemLarge) {
    DaySevenProgressWidget()
} timeline: {
    DaySevenPhoneEntry(date: WidgetStreakData.previewDate("2026-11-12 12:00"), data: .previewThursday)
    DaySevenPhoneEntry(date: WidgetStreakData.previewDate("2026-11-13 12:00"), data: .previewWonFriday)
}
