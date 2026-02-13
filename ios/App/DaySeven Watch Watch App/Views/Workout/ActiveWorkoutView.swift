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
    var preSelectedFocusArea: String? = nil
    var preSelectedCountToward: String? = nil
    @Binding var navigationPath: NavigationPath

    @State private var isStarted = false
    @State private var showSummary = false
    @State private var workoutResult: WorkoutResult?
    @State private var errorMessage: String?
    private var wm: WorkoutManager { workoutMgr }

    /// Whether the user selected "Indoor" for this workout
    private var isIndoor: Bool {
        preSelectedSubtype?.lowercased() == "indoor"
    }

    /// Whether this activity tracks distance (running, cycling, walking, etc.)
    private var tracksDistance: Bool {
        let distanceTypes = ["running", "cycle", "walking", "hiking", "swimming"]
        return distanceTypes.contains(activityType.lowercased())
    }

    /// Whether this activity should show pace (running, walking, cycling)
    private var showsPace: Bool {
        let paceTypes = ["running", "walking", "cycle"]
        return paceTypes.contains(activityType.lowercased())
    }

    /// Whether this is a recovery timer activity (Sauna, Cold Plunge) — simplified UI
    private var isRecoveryTimer: Bool {
        let recoveryTypes = ["sauna", "cold plunge"]
        return recoveryTypes.contains(activityType.lowercased())
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
            if isStarted && wm.isActive {
                // Workout actively running — show timer/controls
                activeWorkoutContent
            } else if isStarted && shouldShowSummary {
                // Summary overlay covers this view. Show timer underneath
                // unless we're dismissing (Done/Discard tapped), then show black
                // so no timer flash when overlay disappears during nav pop.
                if wm.isDismissingSummary {
                    Color.black
                } else {
                    activeWorkoutContent
                }
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
                    Button("Go Back") {
                        navigationPath = NavigationPath()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                }
                .padding()
            } else {
                ProgressView("Starting...")
                    .tint(.green)
            }
        }
        .navigationBarBackButtonHidden(isStarted || shouldShowSummary)
        .task {
            await startWorkout()
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
        VStack(spacing: 0) {
            // Push content down to vertically center everything
            Spacer()

            // Elapsed time — massive white timer
            // When watch dims (always-on), show seconds only (no centiseconds)
            Text(isLuminanceReduced ? formatElapsedTime(wm.elapsedSeconds) : formatElapsedTimePrecise(wm.elapsedTime))
                .font(.system(size: 70, weight: .bold, design: .monospaced))
                .foregroundColor(.white)
                .minimumScaleFactor(0.4)
                .lineLimit(1)

            // Heart Rate Zone Bar
            HeartRateZoneBarView(
                currentZone: wm.currentZone,
                heartRate: wm.heartRate,
                maxHR: wm.estimatedMaxHR,
                zoneSeconds: wm.currentZoneSeconds
            )
            .padding(.horizontal, 4)
            .padding(.top, 4)

            // Time in zone — small, centered, colored to match active zone
            HStack(spacing: 4) {
                Text(formatZoneTime(wm.currentZoneSeconds))
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                Text("TIME IN ZONE")
                    .font(.system(size: 9, weight: .medium))
            }
            .foregroundColor(wm.currentZone.color)
            .padding(.top, 3)
            .padding(.bottom, 4)

            // Metrics row — distance activities show HR + Cal + Distance in one compact row
            if tracksDistance {
                HStack(alignment: .top, spacing: 8) {
                    // Heart Rate
                    VStack(spacing: 0) {
                        Text("\(Int(wm.heartRate))")
                            .font(.system(size: 24, weight: .bold, design: .rounded))
                            .foregroundColor(.white)
                        HStack(spacing: 2) {
                            Image(systemName: "heart.fill")
                                .foregroundColor(.red)
                                .font(.system(size: 8))
                            Text("BPM")
                                .font(.system(size: 9, weight: .medium))
                                .foregroundColor(.gray)
                        }
                    }

                    // Calories
                    VStack(spacing: 0) {
                        Text("\(Int(wm.activeCalories))")
                            .font(.system(size: 24, weight: .bold, design: .rounded))
                            .foregroundColor(.orange)
                        HStack(spacing: 2) {
                            Image(systemName: "flame.fill")
                                .foregroundColor(.orange)
                                .font(.system(size: 8))
                            Text("CAL")
                                .font(.system(size: 9, weight: .medium))
                                .foregroundColor(.gray)
                        }
                    }

                    // Distance
                    VStack(spacing: 0) {
                        Text(wm.distance > 10 ? String(format: "%.2f", wm.distance / 1609.34) : "0.00")
                            .font(.system(size: 24, weight: .bold, design: .rounded))
                            .foregroundColor(.blue)
                        Text("MI")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(.gray)
                    }
                }
            } else {
                // Non-distance activities: HR + Calories, larger
                HStack(alignment: .top, spacing: isStrengthActivity ? 24 : 12) {
                    // Heart Rate
                    VStack(spacing: 0) {
                        Text("\(Int(wm.heartRate))")
                            .font(.system(size: 34, weight: .bold, design: .rounded))
                            .foregroundColor(.white)
                        HStack(spacing: 3) {
                            Image(systemName: "heart.fill")
                                .foregroundColor(.red)
                                .font(.system(size: 10))
                            Text("BPM")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundColor(.gray)
                        }
                        Text("AVG \(Int(wm.averageHeartRate))")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.gray)
                            .padding(.top, 1)
                    }

                    // Calories
                    VStack(spacing: 0) {
                        Text("\(Int(wm.activeCalories))")
                            .font(.system(size: 34, weight: .bold, design: .rounded))
                            .foregroundColor(.orange)
                        HStack(spacing: 3) {
                            Image(systemName: "flame.fill")
                                .foregroundColor(.orange)
                                .font(.system(size: 10))
                            Text("CAL")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundColor(.gray)
                        }
                    }
                }
            }

            // Push content up to vertically center everything
            Spacer()
        }
    }

    // MARK: - Recovery Stats Page (Sauna / Cold Plunge — big timer + HR)

    private var recoveryStatsPage: some View {
        VStack(spacing: 12) {
            Spacer()

            // Big elapsed time — white, slightly smaller for recovery
            Text(isLuminanceReduced ? formatElapsedTime(wm.elapsedSeconds) : formatElapsedTimePrecise(wm.elapsedTime))
                .font(.system(size: 38, weight: .bold, design: .monospaced))
                .foregroundColor(.white)
                .minimumScaleFactor(0.5)

            // Large heart rate
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(Int(wm.heartRate))")
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
                Image(systemName: "heart.fill")
                    .foregroundColor(.red)
                    .font(.system(size: 18))
            }

            Spacer()
        }
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

    // MARK: - Pace Calculation (min:sec per mile)

    private func currentPace(elapsedTime: TimeInterval, distanceMeters: Double) -> String {
        let miles = distanceMeters / 1609.34
        guard miles > 0.01 else { return "--:--" }
        let paceSecondsPerMile = elapsedTime / miles
        let mins = Int(paceSecondsPerMile) / 60
        let secs = Int(paceSecondsPerMile) % 60
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
        wm.summaryFocusArea = preSelectedFocusArea
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
        do {
            try await wm.startWorkout(activityType: hkType, isIndoor: isIndoor)
            wm.workoutPageIndex = 1  // Ensure timer page before TabView renders
            isStarted = true
            // Notify the phone so it shows the active workout indicator
            appVM.phoneService.notifyPhoneWorkoutStarted(
                activityType: activityType,
                strengthType: strengthType
            )
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
