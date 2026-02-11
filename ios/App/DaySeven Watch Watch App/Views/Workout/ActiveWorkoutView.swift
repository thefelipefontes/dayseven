import SwiftUI
import HealthKit

// MARK: - Active Workout View

struct ActiveWorkoutView: View {
    @EnvironmentObject var appVM: AppViewModel
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

    private var wm: WorkoutManager { workoutMgr }

    /// Whether this activity tracks distance (running, cycling, walking, etc.)
    private var tracksDistance: Bool {
        let distanceTypes = ["running", "cycle", "walking", "hiking", "swimming"]
        return distanceTypes.contains(activityType.lowercased())
    }

    /// Whether this activity should show pace (running, walking)
    private var showsPace: Bool {
        let paceTypes = ["running", "walking"]
        return paceTypes.contains(activityType.lowercased())
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
        VStack(spacing: 2) {
            // Elapsed time — prominent at the top, with hundredths like Apple Workout
            Text(formatElapsedTimePrecise(wm.elapsedTime))
                .font(.system(size: 30, weight: .bold, design: .monospaced))
                .foregroundColor(.white)
                .minimumScaleFactor(0.6)

            // Heart rate
            HStack(spacing: 4) {
                Image(systemName: "heart.fill")
                    .foregroundColor(.red)
                    .font(.system(size: 14))
                Text("\(Int(wm.heartRate))")
                    .font(.system(size: 24, weight: .semibold, design: .rounded))
                    .foregroundColor(.white)
                Text("BPM")
                    .font(.system(size: 10))
                    .foregroundColor(.gray)
            }

            // Heart Rate Zone Bar
            HeartRateZoneBarView(
                currentZone: wm.currentZone,
                heartRate: wm.heartRate,
                maxHR: wm.estimatedMaxHR,
                zoneSeconds: wm.currentZoneSeconds
            )
            .padding(.horizontal, 4)

            // Calories + Distance row — side by side for compact layout
            HStack(spacing: 12) {
                // Calories
                HStack(spacing: 3) {
                    Image(systemName: "flame.fill")
                        .foregroundColor(.orange)
                        .font(.system(size: 12))
                    Text("\(Int(wm.activeCalories))")
                        .font(.system(size: 15, weight: .medium, design: .rounded))
                        .foregroundColor(.white)
                    Text("CAL")
                        .font(.system(size: 9))
                        .foregroundColor(.gray)
                }

                // Distance (if applicable)
                if tracksDistance && wm.distance > 10 {
                    HStack(spacing: 3) {
                        Image(systemName: distanceIcon)
                            .foregroundColor(.blue)
                            .font(.system(size: 12))
                        Text(String(format: "%.2f", wm.distance / 1609.34))
                            .font(.system(size: 15, weight: .medium, design: .rounded))
                            .foregroundColor(.white)
                        Text("MI")
                            .font(.system(size: 9))
                            .foregroundColor(.gray)
                    }
                }
            }

            // Pace (for running/walking)
            if showsPace, wm.distance > 10 {
                let paceString = currentPace(
                    elapsedTime: wm.elapsedTime,
                    distanceMeters: wm.distance
                )
                HStack(spacing: 3) {
                    Image(systemName: "speedometer")
                        .foregroundColor(.cyan)
                        .font(.system(size: 11))
                    Text(paceString)
                        .font(.system(size: 14, weight: .medium, design: .rounded))
                        .foregroundColor(.white)
                    Text("/MI")
                        .font(.system(size: 9))
                        .foregroundColor(.gray)
                }
            }

            Spacer().frame(height: 4)

            // Pause / End buttons
            HStack(spacing: 12) {
                // Pause / Resume
                Button {
                    if wm.isPaused {
                        wm.resume()
                    } else {
                        wm.pause()
                    }
                } label: {
                    Image(systemName: wm.isPaused ? "play.fill" : "pause.fill")
                        .font(.system(size: 18))
                        .frame(width: 54, height: 44)
                        .background(Color.yellow)
                        .foregroundColor(.black)
                        .cornerRadius(12)
                }
                .buttonStyle(.plain)

                // End
                Button {
                    Task { await endWorkout() }
                } label: {
                    Text("End")
                        .font(.system(size: 15, weight: .bold))
                        .frame(width: 74, height: 44)
                        .background(Color.red)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                }
                .buttonStyle(.plain)
            }

            if let error = errorMessage {
                Text(error)
                    .font(.caption2)
                    .foregroundColor(.red)
            }
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

    // MARK: - Start Workout

    private func startWorkout() async {
        // If workout is already active (e.g. navigated away and back), just show it
        if wm.isActive {
            isStarted = true
            return
        }

        let hkType = ActivityTypes.mapToHKActivityType(activityType, subtype: nil)
        do {
            try await wm.startWorkout(activityType: hkType)
            isStarted = true
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
