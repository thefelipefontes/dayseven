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
    @Binding var navigationPath: NavigationPath

    @State private var isStarted = false
    @State private var showSummary = false
    @State private var workoutResult: WorkoutResult?
    @State private var errorMessage: String?
    @State private var workoutTab = 1

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

    var body: some View {
        VStack(spacing: 6) {
            if showSummary, let result = workoutResult {
                WorkoutSummaryView(
                    result: result,
                    activityType: activityType,
                    strengthType: strengthType,
                    initialSubtype: preSelectedSubtype,
                    initialFocusArea: preSelectedFocusArea,
                    workoutMgr: workoutMgr,
                    navigationPath: $navigationPath
                )
            } else if isStarted {
                activeWorkoutContent
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
        .navigationBarBackButtonHidden(isStarted)
        .task {
            await startWorkout()
        }
    }

    // MARK: - Active Workout Content

    private var activeWorkoutContent: some View {
        TabView(selection: $workoutTab) {
            // Page 0: Controls (swipe right to reach)
            controlsPage
                .tag(0)

            // Page 1: Live stats (default landing page — swipe left goes to dashboard)
            Group {
                if isRecoveryTimer {
                    recoveryStatsPage
                } else {
                    fullStatsPage
                }
            }
            .tag(1)
        }
        .tabViewStyle(.page(indexDisplayMode: .automatic))
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

    // MARK: - Controls Page (Pause / End)

    private var controlsPage: some View {
        VStack(spacing: 16) {
            Spacer()

            if wm.isPaused {
                Text("Paused")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(.yellow)
            }

            // Pause / Resume
            Button {
                if wm.isPaused { wm.resume() } else { wm.pause() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: wm.isPaused ? "play.fill" : "pause.fill")
                        .font(.system(size: 18))
                    Text(wm.isPaused ? "Resume" : "Pause")
                        .font(.system(size: 16, weight: .bold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(Color.yellow)
                .foregroundColor(.black)
                .cornerRadius(14)
            }
            .buttonStyle(.plain)

            // End
            Button {
                Task { await endWorkout() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .bold))
                    Text("End")
                        .font(.system(size: 16, weight: .bold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(Color.red)
                .foregroundColor(.white)
                .cornerRadius(14)
            }
            .buttonStyle(.plain)

            Spacer()

            if let error = errorMessage {
                Text(error)
                    .font(.caption2)
                    .foregroundColor(.red)
            }
        }
        .padding(.horizontal, 8)
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
        // If workout is already active (e.g. navigated away and back), just show it
        if wm.isActive {
            isStarted = true
            return
        }

        let hkType = ActivityTypes.mapToHKActivityType(activityType, subtype: nil)
        do {
            try await wm.startWorkout(activityType: hkType, isIndoor: isIndoor)
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
