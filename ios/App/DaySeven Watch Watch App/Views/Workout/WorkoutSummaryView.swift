import SwiftUI

// MARK: - Workout Summary View

struct WorkoutSummaryView: View {
    @EnvironmentObject var appVM: AppViewModel

    let result: WorkoutResult
    let activityType: String
    let strengthType: String?
    var initialSubtype: String? = nil
    var initialFocusArea: String? = nil
    @Binding var navigationPath: NavigationPath

    // Post-workout detail selections
    @State private var selectedSubtype: String? = nil
    @State private var selectedFocusArea: String? = nil

    @State private var isSaving = false
    @State private var isSaved = false
    @State private var showDiscardAlert = false

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

    /// Activity-aware noun: "Activity" for Sauna/Cold Plunge, "Walk" for Walking, "Workout" for everything else
    private var activityNoun: String {
        switch activityType {
        case "Sauna", "Cold Plunge": return "Activity"
        case "Walking": return "Walk"
        default: return "Workout"
        }
    }

    var body: some View {
        if isSaved {
            savedConfirmation
        } else {
            summaryContent
        }
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

                // Save Button
                Button {
                    Task { await saveWorkout() }
                } label: {
                    HStack {
                        if isSaving {
                            ProgressView()
                                .tint(.black)
                                .scaleEffect(0.8)
                        }
                        Text(isSaving ? "Saving..." : "Save \(activityNoun)")
                            .font(.system(size: 14, weight: .bold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(isSaving ? Color.gray : Color.green)
                    .foregroundColor(.black)
                    .cornerRadius(12)
                }
                .buttonStyle(.plain)
                .disabled(isSaving)

                // Discard Button
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
        }
        .alert("Discard \(activityNoun)?", isPresented: $showDiscardAlert) {
            Button("Discard", role: .destructive) {
                navigationPath = NavigationPath()
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This \(activityNoun.lowercased()) won't be saved.")
        }
    }

    // MARK: - Stats Section

    private var hasDistanceData: Bool {
        guard showsDistance, let dist = result.distance else { return false }
        return dist > 0.01
    }

    private var statsSection: some View {
        VStack(spacing: 6) {
            // Top row: Duration, (Distance), Cals
            HStack(spacing: 0) {
                statItem(icon: "clock", value: formatDuration(result.duration), label: "Duration")
                if hasDistanceData {
                    statItem(icon: "figure.run", value: String(format: "%.2f mi", result.distance!), label: "Distance", color: .blue)
                }
                statItem(icon: "flame.fill", value: "\(result.calories)", label: "Cals Burned", color: .orange)
            }

            // Bottom row: Avg HR, Max HR (centered)
            HStack(spacing: 0) {
                Spacer()
                statItem(icon: "heart.fill", value: "\(result.avgHr)", label: "Avg HR", color: .red)
                statItem(icon: "heart.fill", value: "\(result.maxHr)", label: "Max HR", color: .red)
                Spacer()
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: - Stat Item

    private func statItem(icon: String, value: String, label: String, color: Color = .white) -> some View {
        VStack(spacing: 2) {
            HStack(spacing: 3) {
                Image(systemName: icon)
                    .font(.system(size: 10))
                    .foregroundColor(color)
                Text(value)
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundColor(.white)
            }
            Text(label)
                .font(.system(size: 8))
                .foregroundColor(.gray)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Detail Pickers

    private var detailPickersSection: some View {
        VStack(spacing: 6) {
            // Subtype picker (Running → Easy/Tempo/etc, Yoga → Vinyasa/Power/etc)
            if hasSubtypes, let subtypes = activityTypeDef?.subtypes {
                pickerLink(
                    title: "Type",
                    value: selectedSubtype,
                    options: subtypes,
                    selection: $selectedSubtype
                )
            }

            // Focus area picker (Strength only)
            if hasStrength {
                pickerLink(
                    title: "Focus Area",
                    value: selectedFocusArea,
                    options: ActivityTypes.strengthFocusAreas,
                    selection: $selectedFocusArea
                )
            }
        }
    }

    private func pickerLink(title: String, value: String?, options: [String], selection: Binding<String?>) -> some View {
        NavigationLink {
            List {
                Button {
                    selection.wrappedValue = nil
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
                        selection.wrappedValue = option
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
        } label: {
            HStack(spacing: 4) {
                Text(title)
                    .font(.system(size: 10))
                    .foregroundColor(.gray)
                Text(value ?? "None")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.green)
                Image(systemName: "chevron.right")
                    .font(.system(size: 8))
                    .foregroundColor(.gray)
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: - Saved Confirmation

    private var savedConfirmation: some View {
        VStack(spacing: 12) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 40))
                .foregroundColor(.green)

            Text("Saved!")
                .font(.system(size: 18, weight: .bold))
                .foregroundColor(.white)

            Text(fullDisplayName)
                .font(.system(size: 13))
                .foregroundColor(.gray)

            if appVM.weeklyProgress.allGoalsMet {
                Text("\u{1F525} All goals complete!")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(.yellow)
            }

            Button("Done") {
                navigationPath = NavigationPath()
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
        }
        .navigationBarBackButtonHidden(true)
    }

    // MARK: - Save Workout

    private func saveWorkout() async {
        isSaving = true

        let countToward = ActivityTypes.getDefaultCountToward(type: activityType, subtype: selectedSubtype)

        let activity = Activity.create(
            type: activityType,
            subtype: selectedSubtype,
            date: Date(),
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

        await appVM.saveActivity(activity)
        isSaving = false
        isSaved = true
    }
}
