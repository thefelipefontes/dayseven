import SwiftUI
import HealthKit

// MARK: - Active Workout View

struct ActiveWorkoutView: View {
    @EnvironmentObject var appVM: AppViewModel
    @Environment(\.isLuminanceReduced) var isLuminanceReduced
    /// Direct observation of workoutManager at full frame rate for smooth timer
    @ObservedObject var workoutMgr: WorkoutManager
    let activityType: String
    let strengthType: String?
    var preSelectedSubtype: String? = nil
    var preSelectedFocusAreas: [String]? = nil
    var preSelectedCountToward: String? = nil
    @Binding var navigationPath: NavigationPath

    @State private var isStarted = false
    @State private var showSummary = false
    @State private var workoutResult: WorkoutResult?
    @State private var errorMessage: String?
    @State private var glowBreathing = false
    /// Delayed flag — only true after isEnding has been true for 0.8s.
    /// Prevents a flash of "Saving..." when HealthKit finishes quickly.
    @State private var showSavingOverlay = false
    /// Currently-displayed mile split overlay. Cleared after ~4s.
    @State private var displayedSplit: WorkoutSplit?
    /// Token for cancelling the in-flight auto-dismiss when a new split lands
    /// before the previous one has cleared.
    @State private var splitDismissToken: UUID?
    /// True when we caught a denied/restricted location auth in the start-workout
    /// pre-flight for a distance activity. Drives the alert that lets the user
    /// either Cancel or Start Anyway (silent GPS, distance entered manually).
    @State private var showLocationDeniedAlert = false
    private var wm: WorkoutManager { workoutMgr }

    /// Whether the user selected "Indoor" for this workout
    private var isIndoor: Bool {
        preSelectedSubtype?.lowercased() == "indoor"
    }

    /// Whether this activity tracks distance (running, cycling, walking, etc.)
    private var tracksDistance: Bool {
        // Indoor cycling has no distance source on the watch (no GPS, no wheel
        // sensor) so the metric would sit at 0.00 the whole workout — Apple
        // Fitness omits it too. Run/walk/swim still estimate distance indoors.
        if activityType.lowercased() == "cycle" && isIndoor { return false }
        let distanceTypes = ["running", "cycle", "walking", "hiking", "swimming"]
        return distanceTypes.contains(activityType.lowercased())
    }

    /// Whether this activity should show pace (running, walking, cycling)
    private var showsPace: Bool {
        let paceTypes = ["running", "walking", "cycle"]
        return paceTypes.contains(activityType.lowercased())
    }

    // MARK: - Unit helpers
    /// Meters per the user's preferred display unit (1000 for km, 1609.34 for mi).
    private var metersPerUnit: Double {
        appVM.distanceUnit == "km" ? 1000.0 : 1609.34
    }
    /// Two-letter unit label ("MI" | "KM") for inline labels.
    private var distanceUnitLabel: String {
        appVM.distanceUnit == "km" ? "KM" : "MI"
    }
    /// Lowercase suffix label ("/mi" | "/km") for pace lines.
    private var paceUnitSuffix: String {
        appVM.distanceUnit == "km" ? "km" : "mi"
    }

    /// Whether this is a recovery timer activity (Sauna, Cold Plunge) — simplified UI
    private var isRecoveryTimer: Bool {
        let recoveryTypes = ["sauna", "cold plunge", "contrast therapy"]
        return recoveryTypes.contains(activityType.lowercased())
    }

    /// The workout's category look: the pin, the mile split and the summary use its colour
    private var look: CategoryLook {
        if isStrengthActivity { return .strength }
        if let toward = preSelectedCountToward {
            switch toward {
            case "strength": return .strength
            case "cardio": return .cardio
            case "recovery": return .recovery
            default: break
            }
        }
        guard let def = ActivityTypes.all.first(where: { $0.name == activityType }) else { return .cardio }
        return def.isHybrid ? .neutral : CategoryLook(def.category)
    }

    /// Whether this is a strength activity (wider metric spacing)
    private var isStrengthActivity: Bool {
        activityType.lowercased() == "strength" || activityType.lowercased() == "strength training"
    }

    /// The result to display — either from local endWorkout() or from WorkoutManager
    /// (when ended externally via WorkoutControlsTab)
    private var displayResult: WorkoutResult? {
        workoutResult ?? wm.lastResult
    }

    /// Whether to show the summary — true if we have a result (from any source)
    private var shouldShowSummary: Bool {
        showSummary || wm.lastResult != nil
    }

    var body: some View {
        VStack(spacing: 6) {
            if isStarted && (showSavingOverlay || wm.isEnding) {
                // Workout is being saved (shown only after 0.8s grace period)
                VStack(spacing: 12) {
                    Spacer()
                    if showSavingOverlay {
                        ProgressView()
                            .tint(.white)
                            .scaleEffect(1.5)
                        Text("Saving workout...")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.white)
                    }
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else if isStarted && wm.isActive {
                // Workout actively running — show timer/controls
                ZStack {
                    activeWorkoutContent
                    if let split = displayedSplit {
                        SplitOverlayView(split: split, color: look.color)
                            .transition(.opacity.combined(with: .scale(scale: 0.92)))
                    }
                }
                .animation(.easeOut(duration: 0.25), value: displayedSplit)
            } else if isStarted && shouldShowSummary {
                // Show black underneath the summary overlay to prevent
                // any flash of the controls/timer during transition.
                Color.black
            } else if isStarted {
                // Workout ended and summary dismissed — show black while
                // NavigationStack pops this view off (prevents "Starting..." flash)
                Color.black
            } else if let error = errorMessage {
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 24))
                        .foregroundColor(.yellow)
                    Text("Could not start")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(.white)
                    Text(error)
                        .font(.system(size: 11))
                        .foregroundColor(.gray)
                        .multilineTextAlignment(.center)
                    Button {
                        navigationPath = NavigationPath()
                    } label: {
                        PillLabel(title: "Go Back", fontSize: 14) { EmptyView() }
                    }
                    .buttonStyle(.plain)
                }
                .padding()
            } else {
                ProgressView("Starting...")
                    .tint(.white)
            }
        }
        .navigationBarBackButtonHidden(isStarted || shouldShowSummary)
        .alert("Location is off", isPresented: $showLocationDeniedAlert) {
            Button("Start Anyway") {
                Task {
                    let hkType = ActivityTypes.mapToHKActivityType(activityType, subtype: preSelectedSubtype)
                    await proceedToStartWorkout(hkType: hkType)
                }
            }
            Button("Cancel", role: .cancel) {
                navigationPath = NavigationPath()
            }
        } message: {
            Text("Distance won't track for this workout. To enable: Settings → Privacy → Location Services → DaySeven.")
        }
        .task {
            await startWorkout()
        }
        // Resuming slides back to the timer, like Apple's Workout app. Watching the state, not
        // the button, also covers a resume from the phone. Pausing stays on the controls.
        .onChange(of: wm.isPaused) { wasPaused, isPaused in
            guard wasPaused, !isPaused, wm.isActive, !wm.isEnding else { return }
            withAnimation { wm.workoutPageIndex = 1 }
        }
        .onChange(of: wm.isEnding) { _, ending in
            if ending {
                // Wait 0.8s before showing "Saving..." — if it finishes faster, skip it
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                    if wm.isEnding {
                        showSavingOverlay = true
                    }
                }
            }
            // Don't clear showSavingOverlay here — wait for lastResult
        }
        .onChange(of: wm.lastResult) { _, result in
            if result != nil {
                showSavingOverlay = false
            }
        }
        .onChange(of: wm.latestSplit) { _, split in
            guard let split else { return }
            displayedSplit = split
            let token = UUID()
            splitDismissToken = token
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
                // Only clear if no newer split has landed since we scheduled.
                if splitDismissToken == token {
                    displayedSplit = nil
                }
            }
        }
    }

    // MARK: - Active Workout Content
    // Nested page TabView: swipe left for Controls, default page is Timer.
    // The outer TabView in MainTabView handles Timer ← → Dashboard swiping.

    private var activeWorkoutContent: some View {
        TabView(selection: $workoutMgr.workoutPageIndex) {
            // Page 0 — Workout Controls (Pause/Resume, End) — swipe left to reach
            WorkoutControlsTab(workoutMgr: workoutMgr)
                .tag(0)

            // Page 1 — Timer + Metrics (default page)
            Group {
                if isRecoveryTimer {
                    recoveryStatsPage
                } else {
                    fullStatsPage
                }
            }
            .tag(1)
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
    }

    // MARK: - Full Stats Page (big numbers, no buttons)

    private var fullStatsPage: some View {
        WorkoutMetricsPage(
            currentZone: wm.currentZone,
            heartRate: wm.heartRate,
            maxHR: wm.estimatedMaxHR,
            zoneSeconds: wm.currentZoneSeconds,
            tracksDistance: tracksDistance,
            averageHeartRate: wm.averageHeartRate,
            activeCalories: wm.activeCalories,
            distanceText: wm.distance > 10 ? String(format: "%.2f", wm.distance / metersPerUnit) : "0.00",
            // "Check Settings" when GPS has given no distance a minute in
            noGPS: wm.distance <= 10 && wm.elapsedTime > 60,
            distanceUnitLabel: distanceUnitLabel,
            pinColor: look.color,
            isStrength: isStrengthActivity
        ) {
            // When the watch dims (always-on), whole seconds only
            ElapsedClockText(workoutMgr: wm, isLuminanceReduced: isLuminanceReduced, splitHundredths: true, size: 50)
        }
    }

    /// The phone's live-workout icon colours: a red heart and a coral flame
    static let heartColor = Color(red: 1.0, green: 0.271, blue: 0.227)  // #FF453A
    static let calColor = TodaySection.calColor                         // #FF6B6B

    // MARK: - Recovery Stats Page (Sauna / Cold Plunge — big timer + HR)

    /// Glow color based on activity: red for sauna, blue for cold plunge
    private var recoveryGlowColor: Color {
        activityType.lowercased() == "sauna"
            ? Color(red: 1.0, green: 0.2, blue: 0.1)   // warm red-orange
            : Color(red: 0.55, green: 0.85, blue: 1.0)   // glacier blue
    }

    private var recoveryStatsPage: some View {
        ZStack {
            // Radial glow from edges inward
            // Soft inner glow
            RadialGradient(
                gradient: Gradient(colors: [
                    .clear,
                    .clear,
                    recoveryGlowColor.opacity(0.03),
                    recoveryGlowColor.opacity(0.1),
                    recoveryGlowColor.opacity(0.2)
                ]),
                center: .center,
                startRadius: 30,
                endRadius: 110
            )
            .opacity(isLuminanceReduced ? 0.15 : (glowBreathing ? 0.4 : 0.7))

            .animation(
                isLuminanceReduced ? nil : .easeInOut(duration: 2.5).repeatForever(autoreverses: true),
                value: glowBreathing
            )
            .ignoresSafeArea()

            VStack(spacing: 12) {
                Spacer()

                // Big elapsed time — white, slightly smaller for recovery
                ElapsedClockText(workoutMgr: wm, isLuminanceReduced: isLuminanceReduced)
                    .font(.system(size: 38, weight: .bold, design: .monospaced))
                    .foregroundColor(.white)
                    .minimumScaleFactor(0.5)

                // Large heart rate
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(Int(wm.heartRate))")
                        .font(.system(size: 40, weight: .bold, design: .rounded))
                        .foregroundColor(.white)
                    WeekLineIcon(icon: .heart, color: Self.heartColor, size: 20, lineWidth: 2.4)
                }

                Spacer()
            }
        }
        .onAppear { glowBreathing = true }
    }

    // MARK: - Distance Icon

    private var distanceIcon: String {
        switch activityType.lowercased() {
        case "running": return "figure.run"
        case "cycle": return "figure.indoor.cycle"
        case "walking": return "figure.walk"
        case "swimming": return "figure.pool.swim"
        default: return "location.fill"
        }
    }

    // MARK: - Pace Calculation (min:sec per unit — mile or km)

    private func currentPace(elapsedTime: TimeInterval, distanceMeters: Double) -> String {
        let units = distanceMeters / metersPerUnit
        guard units > 0.01 else { return "--:--" }
        let paceSecondsPerUnit = elapsedTime / units
        let mins = Int(paceSecondsPerUnit) / 60
        let secs = Int(paceSecondsPerUnit) % 60
        return "\(mins):\(String(format: "%02d", secs))"
    }

    // MARK: - Zone Time Formatting

    private func formatZoneTime(_ seconds: Int) -> String {
        let mins = seconds / 60
        let secs = seconds % 60
        if mins > 0 {
            return "\(mins):\(String(format: "%02d", secs))"
        }
        return "0:\(String(format: "%02d", secs))"
    }

    // MARK: - Start Workout

    private func startWorkout() async {
        // Store metadata on WorkoutManager so the summary overlay in RootView can read it
        wm.summaryActivityType = activityType
        wm.summaryStrengthType = strengthType
        wm.summarySubtype = preSelectedSubtype
        wm.summaryFocusAreas = preSelectedFocusAreas
        wm.summaryCountToward = preSelectedCountToward

        // If already showing summary, don't try to start again
        if showSummary || workoutResult != nil { return }

        // If workout is already active (e.g. started remotely from phone, or navigated away and back)
        if wm.isActive {
            wm.workoutPageIndex = 1  // Ensure timer page before TabView renders
            isStarted = true
            return
        }

        // If a result was just published (workout ended from controls tab), show summary instead
        if let result = wm.lastResult {
            workoutResult = result
            showSummary = true
            return
        }

        // If this view was navigated to from a remote workout request, the workout
        // may still be starting (PhoneConnectivityService is awaiting wm.startWorkout).
        // Wait briefly for it to become active rather than trying to start a duplicate.
        if appVM.phoneService.remoteWorkoutRequest != nil {
            for _ in 0..<20 {
                try? await Task.sleep(nanoseconds: 100_000_000) // 100ms
                if wm.isActive {
                    wm.workoutPageIndex = 1  // Ensure timer page before TabView renders
                    isStarted = true
                    return
                }
            }
            // If still not active after 2s, something went wrong — show error
            if !wm.isActive {
                errorMessage = "Could not start workout from phone"
                return
            }
        }

        let hkType = ActivityTypes.mapToHKActivityType(activityType, subtype: preSelectedSubtype)

        // Pre-flight: if this workout relies on GPS for distance and the user
        // has denied or restricted location auth, warn before starting. Silent
        // GPS would leave them with a 0-distance run they can't recover.
        // .notDetermined slips through — startLocationCollection() inside
        // startWorkout will trigger the system prompt naturally for first runs.
        if WorkoutManager.needsLocationForDistance(activityType: hkType, isIndoor: isIndoor, subtype: preSelectedSubtype),
           WorkoutManager.isLocationAuthDenied() {
            showLocationDeniedAlert = true
            return
        }

        await proceedToStartWorkout(hkType: hkType)
    }

    /// Actually kick off the workout. Split out from startWorkout() so the
    /// location-denied alert's "Start Anyway" button can call it directly
    /// without re-running the pre-flight check.
    private func proceedToStartWorkout(hkType: HKWorkoutActivityType) async {
        // Behind the user's Start tap: covers HealthKit types they haven't answered yet (types
        // added in an update), now that launches no longer ask. Returns at once, with no
        // sheet, when everything has been answered.
        await appVM.requestHealthKitPermissions()
        do {
            try await wm.startWorkout(activityType: hkType, isIndoor: isIndoor, subtype: preSelectedSubtype)
            wm.workoutPageIndex = 1  // Ensure timer page before TabView renders
            isStarted = true
            // Notify the phone so it shows the active workout indicator
            appVM.phoneService.notifyPhoneWorkoutStarted(
                activityType: activityType,
                strengthType: strengthType
            )
            // Also trigger Live Activity via APNs push (works even when phone is backgrounded)
            appVM.phoneService.requestLiveActivityPush(activityType: activityType, strengthType: strengthType)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - End Workout

    private func endWorkout() async {
        do {
            let result = try await wm.endWorkout()
            workoutResult = result
            showSummary = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Metrics Page

/// The workout page (board 40): the clock as the one big number, the zone bar with the time
/// in the zone, then BPM, CAL and distance as small cards like the phone's live workout.
struct WorkoutMetricsPage<Clock: View>: View {
    let currentZone: HeartRateZone
    let heartRate: Double
    let maxHR: Double
    let zoneSeconds: Int
    let tracksDistance: Bool
    let averageHeartRate: Double
    let activeCalories: Double
    let distanceText: String
    let noGPS: Bool
    let distanceUnitLabel: String
    let pinColor: Color
    let isStrength: Bool
    @ViewBuilder let clock: () -> Clock

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Shrinks to fit the width only, so the cards below can't squeeze it
            clock()
                .foregroundColor(.white)
                .minimumScaleFactor(0.4)
                .lineLimit(1)
                .fixedSize(horizontal: false, vertical: true)

            HeartRateZoneBarView(
                currentZone: currentZone,
                heartRate: heartRate,
                maxHR: maxHR,
                zoneSeconds: zoneSeconds
            )
            .padding(.horizontal, 4)
            .padding(.top, 6)

            // Time in zone: the time in the zone's colour, then grey caps
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(Self.zoneTime(zoneSeconds))
                    .font(.system(size: 11, weight: .bold))
                    .monospacedDigit()
                    .foregroundColor(currentZone.color)
                CapsText("In zone \(currentZone.rawValue)", size: 8.5)
            }
            .padding(.top, 4)
            .padding(.bottom, 7)

            if tracksDistance {
                HStack(spacing: 5) {
                    metricCard(icon: .heart, iconColor: ActiveWorkoutView.heartColor, label: "BPM", value: "\(Int(heartRate))")
                    metricCard(icon: .calories, iconColor: ActiveWorkoutView.calColor, label: "CAL", value: "\(Int(activeCalories))")
                    metricCard(icon: .pin, iconColor: pinColor,
                               label: noGPS ? "Check Settings" : distanceUnitLabel,
                               labelColor: noGPS ? AppColors.cardio : WeekColors.muted,
                               value: distanceText)
                }
                .padding(.horizontal, 2)
            } else {
                // Non-distance activities: BPM (with its average) and CAL
                HStack(spacing: 6) {
                    metricCard(icon: .heart, iconColor: ActiveWorkoutView.heartColor, label: "BPM", value: "\(Int(heartRate))",
                               detail: "AVG \(Int(averageHeartRate))")
                    metricCard(icon: .calories, iconColor: ActiveWorkoutView.calColor, label: "CAL", value: "\(Int(activeCalories))")
                }
                .padding(.horizontal, isStrength ? 6 : 2)
            }

            Spacer()
        }
    }

    /// A small card: the icon and grey caps label above a white value
    private func metricCard(icon: WeekLineIcon.Icon, iconColor: Color, label: String,
                            labelColor: Color = WeekColors.muted, value: String, detail: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 3) {
                WeekLineIcon(icon: icon, color: iconColor, size: 10, lineWidth: 2.4)
                CapsText(label, size: 8, color: labelColor)
                    .minimumScaleFactor(0.7)
            }
            Text(value)
                .font(.system(size: 18, weight: .bold))
                .monospacedDigit()
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6) // narrow screens only
                .fixedSize(horizontal: false, vertical: true)
            if let detail {
                Text(detail)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(WeekColors.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(EdgeInsets(top: 6, leading: 7, bottom: 7, trailing: 7))
        .background(TodayCard(cornerRadius: 11))
        .accessibilityElement(children: .combine)
    }

    static func zoneTime(_ seconds: Int) -> String {
        String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

/// The workout clock's look: SF Pro heavy with monospaced digits, the hundredths smaller and grey.
func workoutClockText(_ elapsed: TimeInterval, wholeSecondsOnly: Bool, size: CGFloat) -> Text {
    let whole = Text(formatElapsedTime(Int(elapsed)))
        .font(.system(size: size, weight: .heavy)).monospacedDigit().tracking(-size * 0.03)
    if wholeSecondsOnly { return whole }
    let hundredths = Int((elapsed - Double(Int(elapsed))) * 100)
    return whole + Text(String(format: ".%02d", hundredths))
        .font(.system(size: (size * 0.52).rounded(), weight: .heavy))
        .monospacedDigit()
        .foregroundColor(WeekColors.muted)
}

// MARK: - Elapsed Clock

/// The workout clock, drawn from wall-clock time. Hundredths at 30fps while the screen is
/// lit and the workout is running; whole seconds once a second when the screen dims or the
/// workout is paused. SwiftUI doesn't draw it at all while the app is in the background.
private struct ElapsedClockText: View {
    let workoutMgr: WorkoutManager
    let isLuminanceReduced: Bool
    /// The workout page's clock: SF Pro heavy, the hundredths smaller and grey. Off, the
    /// caller's font applies (the recovery timer keeps its own look).
    var splitHundredths = false
    var size: CGFloat = 62

    private var interval: TimeInterval {
        isLuminanceReduced || workoutMgr.isPaused ? 1.0 : 1.0 / 30.0
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: interval)) { context in
            let elapsed = workoutMgr.activeElapsed(at: context.date)
            if splitHundredths {
                workoutClockText(elapsed, wholeSecondsOnly: isLuminanceReduced, size: size)
            } else {
                Text(isLuminanceReduced ? formatElapsedTime(Int(elapsed)) : formatElapsedTimePrecise(elapsed))
            }
        }
    }
}

// MARK: - Split Overlay

/// Brief Apple-style overlay shown for ~4s when the user crosses a whole-unit
/// boundary (mile or km, per user preference) during a distance workout. The
/// haptic is fired by WorkoutManager when the split is published — this view is
/// purely visual.
///
/// Layout: header ("MILE 3" / "KM 5"), then big = pace for THIS split (so you
/// know if you sped up or slowed down right now), small underneath = overall
/// pace for the whole workout so far (so you know if you're trending faster or
/// slower vs your average).
private struct SplitOverlayView: View {
    let split: WorkoutSplit
    /// The workout's category colour (not the old green)
    var color: Color = AppColors.cardio

    private var unitLabel: String { split.unit == "km" ? "KM" : "MILE" }
    private var paceSuffix: String { split.unit == "km" ? "/km" : "/mi" }

    var body: some View {
        VStack(spacing: 4) {
            Text("\(unitLabel) \(split.splitNumber)")
                .font(.system(size: 13, weight: .semibold))
                .tracking(2)
                .foregroundColor(color)
            // Big: pace for the mile/km just completed — "how fast right now"
            Text("\(formatPace(split.splitSecondsPerUnit)) \(paceSuffix)")
                .font(.system(size: 32, weight: .bold, design: .rounded))
                .foregroundColor(.white)
                .monospacedDigit()
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            // Small: overall pace so far — "trending vs my average"
            Text("\(formatPace(split.overallSecondsPerUnit)) avg \(paceSuffix)")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.gray)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.92))
    }

    /// "8:32" — minutes:seconds, no leading zero on minutes.
    private func formatPace(_ secondsPerUnit: TimeInterval) -> String {
        let total = Int(secondsPerUnit.rounded())
        let m = total / 60
        let s = total % 60
        return String(format: "%d:%02d", m, s)
    }
}
