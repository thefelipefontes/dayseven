import SwiftUI
import HealthKit

// MARK: - Active Workout View

struct ActiveWorkoutView: View {
    @EnvironmentObject var appVM: AppViewModel
    let activityType: String
    let strengthType: String?
    var preSelectedSubtype: String? = nil
    var preSelectedFocusArea: String? = nil
    @Binding var navigationPath: NavigationPath

    @State private var isStarted = false
    @State private var showSummary = false
    @State private var workoutResult: WorkoutResult?
    @State private var errorMessage: String?

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
        VStack(spacing: 3) {
            // Elapsed time
            Text(formatElapsedTime(appVM.workoutManager.elapsedSeconds))
                .font(.system(size: 36, weight: .bold, design: .monospaced))
                .foregroundColor(.white)
                .minimumScaleFactor(0.7)

            // Heart rate
            HStack(spacing: 4) {
                Image(systemName: "heart.fill")
                    .foregroundColor(.red)
                    .font(.system(size: 14))
                Text("\(Int(appVM.workoutManager.heartRate))")
                    .font(.system(size: 24, weight: .semibold, design: .rounded))
                    .foregroundColor(.white)
                Text("BPM")
                    .font(.system(size: 10))
                    .foregroundColor(.gray)
            }

            // Heart Rate Zone Bar
            HeartRateZoneBarView(
                currentZone: appVM.workoutManager.currentZone,
                heartRate: appVM.workoutManager.heartRate,
                maxHR: appVM.workoutManager.estimatedMaxHR,
                zoneSeconds: appVM.workoutManager.currentZoneSeconds
            )
            .padding(.horizontal, 4)

            // Calories
            HStack(spacing: 4) {
                Image(systemName: "flame.fill")
                    .foregroundColor(.orange)
                    .font(.system(size: 12))
                Text("\(Int(appVM.workoutManager.activeCalories))")
                    .font(.system(size: 16, weight: .medium, design: .rounded))
                    .foregroundColor(.white)
                Text("CAL")
                    .font(.system(size: 9))
                    .foregroundColor(.gray)
            }

            // Distance (if applicable)
            if appVM.workoutManager.distance > 10 {
                HStack(spacing: 4) {
                    Image(systemName: "figure.run")
                        .foregroundColor(.blue)
                        .font(.system(size: 12))
                    Text(String(format: "%.2f", appVM.workoutManager.distance / 1609.34))
                        .font(.system(size: 14, weight: .medium, design: .rounded))
                        .foregroundColor(.white)
                    Text("MI")
                        .font(.system(size: 9))
                        .foregroundColor(.gray)
                }
            }

            Spacer().frame(height: 2)

            // Pause / End buttons
            HStack(spacing: 12) {
                // Pause / Resume
                Button {
                    if appVM.workoutManager.isPaused {
                        appVM.workoutManager.resume()
                    } else {
                        appVM.workoutManager.pause()
                    }
                } label: {
                    Image(systemName: appVM.workoutManager.isPaused ? "play.fill" : "pause.fill")
                        .font(.system(size: 16))
                        .frame(width: 50, height: 40)
                        .background(Color.yellow)
                        .foregroundColor(.black)
                        .cornerRadius(10)
                }
                .buttonStyle(.plain)

                // End
                Button {
                    Task { await endWorkout() }
                } label: {
                    Text("End")
                        .font(.system(size: 14, weight: .bold))
                        .frame(width: 70, height: 40)
                        .background(Color.red)
                        .foregroundColor(.white)
                        .cornerRadius(10)
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

    // MARK: - Start Workout

    private func startWorkout() async {
        let hkType = ActivityTypes.mapToHKActivityType(activityType, subtype: nil)
        do {
            try await appVM.workoutManager.startWorkout(activityType: hkType)
            isStarted = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - End Workout

    private func endWorkout() async {
        do {
            let result = try await appVM.workoutManager.endWorkout()
            workoutResult = result
            showSummary = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
