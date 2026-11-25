import WidgetKit
import SwiftUI

// MARK: - Timeline Entry

struct DaySevenEntry: TimelineEntry {
    let date: Date
    let data: WidgetStreakData
}

// MARK: - Timeline Provider

struct DaySevenTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> DaySevenEntry {
        DaySevenEntry(date: .now, data: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (DaySevenEntry) -> Void) {
        let data = SharedDefaults.readStreakData()
        completion(DaySevenEntry(date: .now, data: data))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DaySevenEntry>) -> Void) {
        let now = Date.now
        let entry = DaySevenEntry(date: now, data: SharedDefaults.readStreakData(asOf: now))
        // An entry for Sunday midnight too, so the week empties when it rolls over even
        // if no reload comes in time (the refresh below is a request, not a promise).
        let nextWeek = SharedDefaults.nextWeekStart(after: now)
        let rollover = DaySevenEntry(date: nextWeek, data: SharedDefaults.readStreakData(asOf: nextWeek))
        // Refresh every 30 minutes (the app also triggers reloads on save)
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: now)!
        let timeline = Timeline(entries: [entry, rollover], policy: .after(nextUpdate))
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
        weekSteps: 52400,
        lastUpdated: Date().timeIntervalSince1970,
        injuryModeActive: false
    )
}

// MARK: - Widget Colors (matching the watch app)

struct WidgetColors {
    static let strength = Color(red: 0.0, green: 1.0, blue: 0.58)    // #00FF94
    static let cardio = Color(red: 1.0, green: 0.58, blue: 0.0)      // #FF9500
    static let steps = Color(red: 0.749, green: 0.353, blue: 0.949)  // #BF5AF2, same as the app
    static let gold = Color(red: 1.0, green: 0.843, blue: 0.0)       // #FFD700, the streak and a won week only
    static let injury = Color(red: 0.655, green: 0.545, blue: 0.980) // #A78BFA, streak paused
    static let stepsLabel = Color(red: 0.851, green: 0.722, blue: 0.961) // #D9B8F5, the steps corner's label

    /// The week's % warms from white to gold as the week fills: rgb(255, 255−40t, 255·(1−t)).
    static func goldMix(_ pct: Int) -> Color {
        let t = min(1, max(0, Double(pct) / 100))
        return Color(red: 1, green: (255 - 40 * t) / 255, blue: 1 - t)
    }

    /// The week's colour: white→gold as it fills, solid gold once won.
    static func week(_ model: WeekModel) -> Color { model.won ? gold : goldMix(model.percent) }
}

// MARK: - Shared pieces

/// On an accented (tinted) face the system draws one tint: only the parts marked accentable
/// take it, so the filled parts are marked and the empty parts drop to a faint white.
private struct Accent: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        if on { content.widgetAccentable() } else { content }
    }
}

/// The winning streak: a gold flame and the number. On an injury pause: a violet bandage.
private struct StreakMark: View {
    let model: WeekModel
    let size: CGFloat
    var stacked = false

    var body: some View {
        let icon = Image(systemName: model.streakPaused ? "bandage.fill" : "flame.fill")
        let color = model.streakPaused ? WidgetColors.injury : WidgetColors.gold
        Group {
            if stacked {
                VStack(spacing: 1) {
                    icon.font(.system(size: (size * 0.64).rounded()))
                    Text("\(model.streak)").font(.system(size: size, weight: .heavy))
                }
            } else {
                HStack(spacing: (size * 0.25).rounded()) {
                    icon.font(.system(size: (size * 0.95).rounded()))
                    Text("\(model.streak)").font(.system(size: size, weight: .heavy))
                }
            }
        }
        .foregroundColor(color)
        .widgetAccentable()
    }
}

/// A ring gauge drawn round the circular slot, with a soft glow once full.
private struct RingGauge: View {
    let fraction: Double
    let color: Color
    let track: Color
    let lineWidth: CGFloat
    let glow: Bool
    let accented: Bool

    var body: some View {
        ZStack {
            Circle()
                .stroke(accented ? Color.white.opacity(0.18) : track, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: max(0, min(1, fraction)))
                .stroke(accented ? .white : color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .shadow(color: (glow && !accented) ? color.opacity(0.7) : .clear, radius: 3)
                .widgetAccentable()
        }
        .padding(lineWidth / 2)
    }
}

/// The footprints from Home's line icons, drawn from their SVG source.
private struct StepsIcon: View {
    let color: Color
    let size: CGFloat

    private static let paths = [
        "M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z",
        "M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z",
        "M16 17h4", "M4 13h4"]

    var body: some View {
        let scale = size / 24
        ZStack {
            ForEach(Self.paths, id: \.self) { d in
                WidgetSVGPath.path(d)
                    .applying(CGAffineTransform(scaleX: scale, y: scale))
                    .stroke(color, style: StrokeStyle(lineWidth: 2.2 * scale, lineCap: .round, lineJoin: .round))
            }
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Week · Circular (the streak in the middle, the week's % around it)

struct WeekCircularView: View {
    let model: WeekModel
    let accented: Bool

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            RingGauge(fraction: Double(model.percent) / 100, color: WidgetColors.week(model),
                      track: Color.white.opacity(0.18), lineWidth: 4.5, glow: model.won, accented: accented)
            StreakMark(model: model, size: 14, stacked: true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Week \(model.percent) percent, \(model.streak) week streak")
    }
}

// MARK: - Week · Corner (the % in the middle, the week along the bezel)

struct WeekCornerView: View {
    let model: WeekModel
    let accented: Bool

    var body: some View {
        let color = WidgetColors.week(model)
        ZStack {
            AccessoryWidgetBackground()
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text("\(model.percent)").font(.system(size: 13, weight: .heavy)).tracking(-0.4)
                Text("%").font(.system(size: 7, weight: .heavy))
            }
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .foregroundColor(accented ? .white : color)
            .widgetAccentable()
        }
        .widgetLabel {
            ProgressView(value: Double(model.percent) / 100) {
                // Beside the bezel gauge a corner fits about five characters, so not "4 DAYS LEFT"
                Text(model.won ? "WON" : "\(model.daysLeft) LEFT")
            }
            .tint(color)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Week \(model.percent) percent, \(model.daysLeftText)")
    }
}

// MARK: - Week · Rectangular (the % and streak, then three thin tracks)

struct WeekRectangularView: View {
    let model: WeekModel
    let accented: Bool

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
                let size: CGFloat = model.won ? 21 : 24
                HStack(alignment: .firstTextBaseline, spacing: 1) {
                    Text("\(model.percent)").font(.system(size: size, weight: .heavy)).tracking(-size * 0.045)
                    Text("%").font(.system(size: (size * 0.46).rounded(), weight: .heavy))
                }
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .padding(.vertical, -size * 0.18)
                .foregroundColor(accented ? .white : WidgetColors.week(model))
                .shadow(color: (model.won && !accented) ? WidgetColors.gold.opacity(0.45) : .clear, radius: 6)
                .widgetAccentable()
                StreakMark(model: model, size: 11)
                    .padding(.top, 6)
            }
            .frame(width: model.won ? 62 : 52, alignment: .leading)

            VStack(spacing: 8) {
                row("STR", .strength, WidgetColors.strength)
                row("CDO", .cardio, WidgetColors.cardio)
                row("STP", .steps, WidgetColors.steps)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Week \(model.percent) percent. Strength \(model.liftsDone) of \(model.liftsGoal), cardio \(model.cardioDone) of \(model.cardioGoal), steps \(WeekModel.k(model.weekSteps)) of \(WeekModel.k0(model.weekStepsGoal))")
    }

    private func row(_ label: String, _ goal: WeekModel.Goal, _ color: Color) -> some View {
        HStack(spacing: 5) {
            Text(label)
                .font(.system(size: 8.5, weight: .bold))
                .foregroundColor(accented ? .white : color)
                .frame(width: 22, alignment: .leading)
            if goal == .steps {
                stepsBar(height: 5)
            } else {
                blocks(done: model.done(goal), goal: model.goal(goal), color: color, met: model.met(goal), height: 5, gap: 2)
            }
        }
    }

    private func blocks(done: Int, goal: Int, color: Color, met: Bool, height: CGFloat, gap: CGFloat) -> some View {
        HStack(spacing: gap) {
            ForEach(0..<max(goal, 1), id: \.self) { i in
                let filled = i < done
                Capsule()
                    .fill(filled ? (accented ? .white : color) : (accented ? Color.white.opacity(0.22) : color.opacity(0.22)))
                    .frame(height: height)
                    .shadow(color: (met && filled && !accented) ? color.opacity(0.55) : .clear, radius: (height + 1) / 2)
                    .modifier(Accent(on: filled))
            }
        }
    }

    private func stepsBar(height: CGFloat) -> some View {
        let met = model.met(.steps)
        let color = WidgetColors.steps
        return GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(accented ? Color.white.opacity(0.22) : color.opacity(0.22))
                Capsule()
                    .fill(accented ? .white : color)
                    .frame(width: max(height, geo.size.width * model.fraction(.steps)))
                    .opacity(model.weekSteps > 0 ? 1 : 0)
                    .shadow(color: (met && !accented) ? color.opacity(0.55) : .clear, radius: (height + 1) / 2)
                    .widgetAccentable()
            }
            .frame(height: height)
            .overlay(alignment: .leading) {
                if let pace = model.paceFraction {
                    RoundedRectangle(cornerRadius: 1)
                        .fill(Color.white)
                        .frame(width: 2, height: height + 4)
                        .background(RoundedRectangle(cornerRadius: 2).fill(Color.black).padding(-1.2))
                        .offset(x: geo.size.width * pace - 1)
                }
            }
        }
        .frame(height: height)
    }
}

// MARK: - Week · Inline (one line of text)

struct WeekInlineView: View {
    let model: WeekModel

    // Some faces set the inline slot in bold capitals and cut it short, so each line has a
    // shorter fallback ("75% · 4 left", "Week won") for the narrow slots.
    var body: some View {
        if model.won {
            ViewThatFits(in: .horizontal) {
                wonLine("Week won · \(model.streak) \(model.streak == 1 ? "week" : "weeks")")
                wonLine("Week won")
            }
        } else {
            ViewThatFits(in: .horizontal) {
                Text("\(model.percent)% · \(model.daysLeftText)")
                Text("\(model.percent)% · \(model.daysLeft) left")
            }
        }
    }

    private func wonLine(_ text: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: model.streakPaused ? "bandage.fill" : "flame.fill")
            Text(text)
        }
        .foregroundColor(WidgetColors.gold)
    }
}

// MARK: - Steps · Circular (the week's steps, a purple gauge toward the weekly goal)

struct StepsCircularView: View {
    let model: WeekModel
    let accented: Bool

    var body: some View {
        let met = model.met(.steps)
        ZStack {
            AccessoryWidgetBackground()
            RingGauge(fraction: model.fraction(.steps), color: WidgetColors.steps,
                      track: WidgetColors.steps.opacity(0.25), lineWidth: 4.5, glow: met, accented: accented)
            if let pace = model.paceFraction {
                PaceTick(fraction: pace, lineWidth: 4.5)
            }
            VStack(spacing: 1) {
                StepsIcon(color: accented ? .white : WidgetColors.steps, size: 9)
                    .widgetAccentable()
                Text(WeekModel.k0(model.weekSteps))
                    .font(.system(size: 14, weight: .heavy))
                    .tracking(-0.4)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundColor(.white)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(WeekModel.k(model.weekSteps)) of \(WeekModel.k0(model.weekStepsGoal)) steps this week")
    }
}

/// A white tick across the steps gauge where the week's steps should be by today.
private struct PaceTick: View {
    let fraction: Double
    let lineWidth: CGFloat

    var body: some View {
        GeometryReader { geo in
            let size = min(geo.size.width, geo.size.height)
            let c = CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)
            let r = (size - lineWidth) / 2
            let a = fraction * 2 * .pi - .pi / 2
            let p0 = CGPoint(x: c.x + (r - lineWidth) * cos(a), y: c.y + (r - lineWidth) * sin(a))
            let p1 = CGPoint(x: c.x + (r + lineWidth * 0.6) * cos(a), y: c.y + (r + lineWidth * 0.6) * sin(a))
            let tick = Path { $0.move(to: p0); $0.addLine(to: p1) }
            ZStack {
                tick.stroke(Color.black, style: StrokeStyle(lineWidth: 3.2, lineCap: .round))
                tick.stroke(Color.white, style: StrokeStyle(lineWidth: 1.4, lineCap: .round))
            }
        }
    }
}

// MARK: - Steps · Corner (today's steps in the circle, the week along the bezel)

struct StepsCornerView: View {
    let model: WeekModel
    let accented: Bool

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 1) {
                StepsIcon(color: accented ? .white : WidgetColors.steps, size: 8)
                    .widgetAccentable()
                Text(WeekModel.k(model.todaySteps))
                    .font(.system(size: 10, weight: .heavy))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .foregroundColor(.white)
            }
        }
        .widgetLabel {
            ProgressView(value: model.fraction(.steps)) {
                // The week's total; the gauge shows how far toward the weekly goal (no room for "OF 70K")
                Text(WeekModel.k(model.weekSteps).uppercased())
                    .foregroundColor(WidgetColors.stepsLabel)
            }
            .tint(WidgetColors.steps)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(WeekModel.k(model.todaySteps)) steps today, \(WeekModel.k(model.weekSteps)) of \(WeekModel.k0(model.weekStepsGoal)) this week")
    }
}

// MARK: - Widget Definitions

@main
struct DaySevenWidgetBundle: WidgetBundle {
    var body: some Widget {
        DaySevenWidgets()
        DaySevenStepsWidget()
    }
}

/// The week. Keeps its original kind so complications already on people's faces carry over.
struct DaySevenWidgets: Widget {
    let kind = "DaySevenComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DaySevenTimelineProvider()) { entry in
            DaySevenWidgetEntryView(entry: entry)
                .containerBackground(.black, for: .widget)
        }
        .configurationDisplayName("Week")
        .description("Your week's progress and your winning streak.")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryCorner,
            .accessoryRectangular,
            .accessoryInline
        ])
    }
}

/// The week's steps, which move all day. Weekly, like everywhere else: never a daily goal.
struct DaySevenStepsWidget: Widget {
    let kind = "DaySevenStepsComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DaySevenTimelineProvider()) { entry in
            DaySevenStepsEntryView(entry: entry)
                .containerBackground(.black, for: .widget)
        }
        .configurationDisplayName("Steps")
        .description("This week's steps toward your weekly goal.")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryCorner
        ])
    }
}

// MARK: - Entry Views (route to the right family)

struct DaySevenWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    @Environment(\.widgetRenderingMode) var renderingMode
    let entry: DaySevenEntry

    var body: some View {
        let model = WeekModel(data: entry.data, date: entry.date)
        let accented = renderingMode == .accented
        switch family {
        case .accessoryCorner:
            WeekCornerView(model: model, accented: accented)
        case .accessoryRectangular:
            WeekRectangularView(model: model, accented: accented)
        case .accessoryInline:
            WeekInlineView(model: model)
        default:
            WeekCircularView(model: model, accented: accented)
        }
    }
}

struct DaySevenStepsEntryView: View {
    @Environment(\.widgetFamily) var family
    @Environment(\.widgetRenderingMode) var renderingMode
    let entry: DaySevenEntry

    var body: some View {
        let model = WeekModel(data: entry.data, date: entry.date)
        let accented = renderingMode == .accented
        switch family {
        case .accessoryCorner:
            StepsCornerView(model: model, accented: accented)
        default:
            StepsCircularView(model: model, accented: accented)
        }
    }
}

// MARK: - SVG path data → Path (for the footprints icon; the same parser as the watch app)

enum WidgetSVGPath {
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

// MARK: - Previews (board 20's two weeks)

extension WidgetStreakData {
    /// Board 20's Thursday: 3/3, 1/2, 52.4k of 70k, a 3-week streak.
    static let previewThursday = placeholder
    /// Board 20's won Friday: 3/3, 2/2, 71.2k of 70k, a 4-week streak.
    static let previewWonFriday = WidgetStreakData(
        masterStreak: 4, liftsStreak: 12, cardioStreak: 9, recoveryStreak: 5,
        liftsCompleted: 3, liftsGoal: 3,
        cardioCompleted: 2, cardioGoal: 2,
        recoveryCompleted: 2, recoveryGoal: 2,
        todaySteps: 11240, stepsGoal: 10000, todayCalories: 412,
        weekSteps: 71200,
        lastUpdated: Date().timeIntervalSince1970,
        injuryModeActive: false
    )
}

#Preview("Week · Circular", as: .accessoryCircular) {
    DaySevenWidgets()
} timeline: {
    DaySevenEntry(date: .now, data: .previewThursday)
    DaySevenEntry(date: .now, data: .previewWonFriday)
}

#Preview("Week · Corner", as: .accessoryCorner) {
    DaySevenWidgets()
} timeline: {
    DaySevenEntry(date: .now, data: .previewThursday)
    DaySevenEntry(date: .now, data: .previewWonFriday)
}

#Preview("Week · Rectangular", as: .accessoryRectangular) {
    DaySevenWidgets()
} timeline: {
    DaySevenEntry(date: .now, data: .previewThursday)
    DaySevenEntry(date: .now, data: .previewWonFriday)
}

#Preview("Week · Inline", as: .accessoryInline) {
    DaySevenWidgets()
} timeline: {
    DaySevenEntry(date: .now, data: .previewThursday)
    DaySevenEntry(date: .now, data: .previewWonFriday)
}

#Preview("Steps · Circular", as: .accessoryCircular) {
    DaySevenStepsWidget()
} timeline: {
    DaySevenEntry(date: .now, data: .previewThursday)
    DaySevenEntry(date: .now, data: .previewWonFriday)
}

#Preview("Steps · Corner", as: .accessoryCorner) {
    DaySevenStepsWidget()
} timeline: {
    DaySevenEntry(date: .now, data: .previewThursday)
    DaySevenEntry(date: .now, data: .previewWonFriday)
}
