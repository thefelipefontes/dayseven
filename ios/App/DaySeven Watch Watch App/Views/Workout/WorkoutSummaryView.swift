import SwiftUI

// MARK: - Workout Summary View

struct WorkoutSummaryView: View {
    @EnvironmentObject var appVM: AppViewModel

    let result: WorkoutResult
    let activityType: String
    let strengthType: String?
    var initialSubtype: String? = nil
    var initialFocusArea: String? = nil
    @ObservedObject var workoutMgr: WorkoutManager
    @Binding var navigationPath: NavigationPath

    // Post-workout detail selections
    @State private var selectedSubtype: String? = nil
    @State private var selectedFocusArea: String? = nil

    @State private var isSaved = false
    @State private var showDiscardAlert = false
    @State private var savedActivityId: ActivityID?

    // Look up the activity type definition for subtypes
    private var activityTypeDef: ActivityTypeDefinition? {
        ActivityTypes.all.first { $0.name == activityType }
    }

    private var hasSubtypes: Bool {
        guard let def = activityTypeDef else { return false }
        return !def.subtypes.isEmpty
    }

    private var hasStrength: Bool {
        return strengthType != nil
    }

    /// Whether this activity type tracks distance
    private var showsDistance: Bool {
        ["Running", "Cycle", "Walking", "Elliptical", "Stair Climbing"].contains(activityType)
    }

    /// Whether this is a recovery activity (Sauna, Cold Plunge) — hides calories from summary
    private var isRecoveryActivity: Bool {
        ["sauna", "cold plunge"].contains(activityType.lowercased())
    }

    /// Average pace formatted as M:SS /mi (only meaningful for distance activities)
    private var averagePace: String {
        guard let dist = result.distance, dist > 0.01 else { return "--:-- /mi" }
        let paceSeconds = result.durationSeconds / dist  // seconds per mile
        let mins = Int(paceSeconds) / 60
        let secs = Int(paceSeconds) % 60
        return "\(mins):\(String(format: "%02d", secs)) /mi"
    }

    /// Display name for the header — shows base type only (details are in pickers below)
    var displayName: String {
        if let st = strengthType { return st }
        return activityType
    }

    /// Full display name including selections — used for saved confirmation
    var fullDisplayName: String {
        var parts: [String] = []
        if let st = strengthType { parts.append(st) }
        else { parts.append(activityType) }
        if let fa = selectedFocusArea { parts.append(fa) }
        if let sub = selectedSubtype { parts.append(sub) }
        return parts.joined(separator: " - ")
    }

    /// Activity-specific label for the subtype picker
    private var subtypePickerTitle: String {
        switch activityType.lowercased() {
        case "strength": return "Focus Area"
        case "running": return "Run Type"
        case "yoga": return "Yoga Type"
        case "pilates": return "Pilates Type"
        case "walking": return "Walking Type"
        default: return "\(activityType) Type"
        }
    }

    /// Activity-aware noun: "Activity" for Sauna/Cold Plunge, "Walk" for Walking, "Workout" for everything else
    private var activityNoun: String {
        switch activityType {
        case "Sauna", "Cold Plunge": return "Activity"
        case "Walking": return "Walk"
        default: return "Workout"
        }
    }

    var body: some View {
        summaryContent
    }

    // MARK: - Summary Content

    private var summaryContent: some View {
        ScrollView {
            VStack(spacing: 10) {
                // Header
                Text("\(activityNoun) Complete!")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(.green)

                Text(displayName)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.white)

                // Stats
                statsSection

                // Detail pickers
                detailPickersSection

                // Done Button — workout is already auto-saved
                Button {
                    appVM.phoneService.notifyPhoneWorkoutEnded()
                    navigationPath = NavigationPath()
                } label: {
                    Text("Done")
                        .font(.system(size: 14, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Color.green)
                        .foregroundColor(.black)
                        .cornerRadius(12)
                }
                .buttonStyle(.plain)

                // Discard Button — deletes the auto-saved activity
                Button {
                    showDiscardAlert = true
                } label: {
                    Text("Discard \(activityNoun)")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.red.opacity(0.8))
                }
                .buttonStyle(.plain)
                .padding(.top, 2)
            }
            .padding(.horizontal, 4)
        }
        .navigationBarBackButtonHidden(true)
        .onAppear {
            if selectedSubtype == nil { selectedSubtype = initialSubtype }
            if selectedFocusArea == nil { selectedFocusArea = initialFocusArea }
            // Auto-save immediately (like Apple Fitness)
            if !isSaved {
                Task { await autoSaveWorkout() }
            }
        }
        .alert("Discard \(activityNoun)?", isPresented: $showDiscardAlert) {
            Button("Discard", role: .destructive) {
                Task {
                    // Delete the auto-saved activity from Firestore
                    if let activityId = savedActivityId {
                        await appVM.deleteActivity(withId: activityId)
                    }
                    workoutMgr.cancelWorkout()
                    appVM.phoneService.notifyPhoneWorkoutEnded()
                    navigationPath = NavigationPath()
                }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This \(activityNoun.lowercased()) will be permanently deleted.")
        }
    }

    // MARK: - Stats Section

    private var hasDistanceData: Bool {
        guard showsDistance, let dist = result.distance else { return false }
        return dist > 0.01
    }

    private var statsSection: some View {
        VStack(spacing: 12) {
            // Total Time
            statRow(icon: "clock", label: "TOTAL TIME", value: formatDuration(result.duration), color: .green)

            Divider().overlay(Color.gray.opacity(0.3))

            // Distance & Pace (if applicable)
            if hasDistanceData {
                statRow(icon: "figure.run", label: "DISTANCE", value: String(format: "%.2f mi", result.distance!), color: .blue)
                Divider().overlay(Color.gray.opacity(0.3))

                statRow(icon: "figure.run.circle", label: "AVG PACE", value: averagePace, color: .cyan)
                Divider().overlay(Color.gray.opacity(0.3))
            }

            // Active Calories (hidden for recovery activities like Sauna/Cold Plunge)
            if !isRecoveryActivity {
                statRow(icon: "flame.fill", label: "ACTIVE CALORIES", value: "\(result.calories)", color: .orange)

                Divider().overlay(Color.gray.opacity(0.3))
            }

            // Heart Rate — Avg and Max side by side
            HStack(spacing: 0) {
                statColumn(icon: "heart.fill", label: "AVG HR", value: "\(result.avgHr)", unit: "BPM", color: .red)
                statColumn(icon: "heart.fill", label: "MAX HR", value: "\(result.maxHr)", unit: "BPM", color: .red)
            }
        }
        .padding(.vertical, 8)
    }

    // MARK: - Stat Row (full width, large value)

    private func statRow(icon: String, label: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 10))
                    .foregroundColor(color)
                Text(label)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.gray)
            }
            Text(value)
                .font(.system(size: 28, weight: .bold, design: .rounded))
                .foregroundColor(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Stat Column (for side-by-side items like HR)

    private func statColumn(icon: String, label: String, value: String, unit: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 3) {
                Image(systemName: icon)
                    .font(.system(size: 9))
                    .foregroundColor(color)
                Text(label)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(.gray)
            }
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value)
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                    .foregroundColor(color)
                Text(unit)
                    .font(.system(size: 10))
                    .foregroundColor(.gray)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Detail Pickers

    private var detailPickersSection: some View {
        VStack(spacing: 6) {
            // Subtype picker (Running → Easy/Tempo/etc, Yoga → Vinyasa/Power/etc)
            if hasSubtypes, let subtypes = activityTypeDef?.subtypes {
                tappablePickerButton(
                    title: subtypePickerTitle,
                    value: selectedSubtype,
                    options: subtypes,
                    selection: $selectedSubtype
                )
            }

            // Focus area picker (Strength only)
            if hasStrength {
                tappablePickerButton(
                    title: "Focus Area",
                    value: selectedFocusArea,
                    options: ActivityTypes.strengthFocusAreas,
                    selection: $selectedFocusArea
                )
            }
        }
    }

    private func tappablePickerButton(title: String, value: String?, options: [String], selection: Binding<String?>) -> some View {
        NavigationLink {
            PickerListView(title: title, value: value, options: options, selection: selection)
        } label: {
            VStack(spacing: 2) {
                if let value = value {
                    // Show the selected value prominently
                    Text(value)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.green)
                    Text(title)
                        .font(.system(size: 9))
                        .foregroundColor(.gray)
                } else {
                    // No selection — show title as tappable prompt
                    Text(title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.green)
                    Text("Tap to select")
                        .font(.system(size: 9))
                        .foregroundColor(.gray)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(Color(white: 0.15))
            .cornerRadius(10)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Saved Confirmation

    // MARK: - Auto-Save Workout (saves immediately like Apple Fitness)

    private func autoSaveWorkout() async {
        let countToward = ActivityTypes.getDefaultCountToward(type: activityType, subtype: selectedSubtype)

        let activity = Activity.create(
            type: activityType,
            subtype: selectedSubtype,
            date: result.startDate,
            duration: result.duration,
            calories: result.calories > 0 ? result.calories : nil,
            avgHr: result.avgHr > 0 ? result.avgHr : nil,
            maxHr: result.maxHr > 0 ? result.maxHr : nil,
            distance: result.distance,
            strengthType: strengthType,
            focusArea: selectedFocusArea,
            notes: nil,
            healthKitUUID: result.workoutUUID,
            countToward: countToward
        )

        savedActivityId = activity.id
        await appVM.saveActivity(activity)
        isSaved = true
    }
}

// MARK: - Picker List View (auto-dismisses on selection)

private struct PickerListView: View {
    @Environment(\.dismiss) private var dismiss

    let title: String
    let value: String?
    let options: [String]
    @Binding var selection: String?

    var body: some View {
        List {
            Button {
                selection = nil
                dismiss()
            } label: {
                HStack {
                    Text("None")
                    Spacer()
                    if value == nil {
                        Image(systemName: "checkmark")
                            .foregroundColor(.green)
                    }
                }
            }
            ForEach(options, id: \.self) { option in
                Button {
                    selection = option
                    dismiss()
                } label: {
                    HStack {
                        Text(option)
                        Spacer()
                        if value == option {
                            Image(systemName: "checkmark")
                                .foregroundColor(.green)
                                .font(.system(size: 12))
                        }
                    }
                }
            }
        }
        .navigationTitle(title)
    }
}
