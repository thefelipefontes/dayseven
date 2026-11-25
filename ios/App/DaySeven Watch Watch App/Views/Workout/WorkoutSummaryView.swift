import SwiftUI

// MARK: - Workout Summary View

struct WorkoutSummaryView: View {
    @EnvironmentObject var appVM: AppViewModel

    let result: WorkoutResult
    let activityType: String
    let strengthType: String?
    var initialSubtype: String? = nil
    var initialFocusAreas: [String]? = nil
    var initialCountToward: String? = nil
    @ObservedObject var workoutMgr: WorkoutManager

    /// Callback when user taps "Done" or "Discard" — used when shown as overlay
    var onDone: (() -> Void)? = nil

    // Post-workout detail selections
    @State private var selectedSubtype: String? = nil
    @State private var selectedFocusAreas: [String] = []
    @State private var selectedCountToward: String? = nil

    @State private var isSaved = false
    @State private var isAutoSaving = false
    @State private var showDiscardAlert = false
    @State private var savedActivityId: ActivityID?
    // Handle to the auto-save Task so Discard can await its completion (network
    // included) before deleting — awaiting a Task handle is reliable even after
    // the view is torn down, unlike reading @State like isAutoSaving. Its value is the
    // id the workout ended up stored under (see AppViewModel.saveActivity).
    @State private var autoSaveTask: Task<ActivityID?, Never>?

    // Sheet-based pickers (since we're in an overlay, not a NavigationStack)
    @State private var showSubtypePicker = false
    @State private var showFocusAreaPicker = false
    @State private var showCountTowardPicker = false

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

    /// Whether this activity type tracks distance. Indoor cycling has no distance
    /// source (no GPS, no wheel sensor) so distance is always 0 — Apple Fitness
    /// omits it too, so we don't show the row.
    private var showsDistance: Bool {
        if activityType == "Cycle" && (selectedSubtype ?? initialSubtype)?.lowercased() == "indoor" {
            return false
        }
        return ["Running", "Cycle", "Walking", "Elliptical", "Stair Climbing"].contains(activityType)
    }

    /// Whether this is a recovery activity (Sauna, Cold Plunge) — hides calories from summary
    private var isRecoveryActivity: Bool {
        ["sauna", "cold plunge", "contrast therapy"].contains(activityType.lowercased())
    }

    /// Average pace formatted as M:SS /unit. result.distance is canonically MILES,
    /// so we convert to the user's display unit then derive pace.
    private var averagePace: String {
        let unit = appVM.distanceUnit
        let suffix = unit == "km" ? "/km" : "/mi"
        guard let distMiles = result.distance, distMiles > 0.01 else { return "--:-- \(suffix)" }
        let distInUnit = unit == "km" ? distMiles * 1.60934 : distMiles
        let paceSeconds = result.durationSeconds / distInUnit
        let mins = Int(paceSeconds) / 60
        let secs = Int(paceSeconds) % 60
        return "\(mins):\(String(format: "%02d", secs)) \(suffix)"
    }

    /// Distance formatted with unit (e.g. "3.21 mi" / "5.17 km"). result.distance
    /// is in miles canonically.
    private var distanceDisplay: String {
        guard let distMiles = result.distance else { return "" }
        let unit = appVM.distanceUnit
        let value = unit == "km" ? distMiles * 1.60934 : distMiles
        return String(format: "%.2f %@", value, unit == "km" ? "km" : "mi")
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
        if !selectedFocusAreas.isEmpty { parts.append(selectedFocusAreas.joined(separator: ", ")) }
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
        case "Sauna", "Cold Plunge", "Contrast Therapy": return "Activity"
        case "Walking": return "Walk"
        default: return "Workout"
        }
    }

    /// The phone ended this workout and saved it in its own Finish flow, so this summary only
    /// shows the numbers: no auto-save (that was the duplicate), no details to edit, nothing to
    /// discard here.
    private var savedByPhone: Bool {
        result.endedFromPhone
    }

    var body: some View {
        summaryContent
    }

    // MARK: - Summary Content

    private var summaryContent: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Header: the workout in its category's tint, then "WORKOUT COMPLETE"
                headerSection

                // Total time: the one big number
                totalTimeSection
                    .padding(.top, 16)
                    .padding(.bottom, 12)

                // Stats as small cards, two per row
                statsSection

                // Detail pickers
                if savedByPhone {
                    Text("Saved on your iPhone")
                        .font(.system(size: 12))
                        .foregroundColor(WeekColors.muted)
                        .padding(.top, 12)
                } else {
                    detailPickersSection
                        .padding(.top, 10)
                }

                // Done Button — re-saves if user changed any details after auto-save
                Button {
                    Task {
                        await resaveIfNeeded()
                        if let onDone = onDone {
                            onDone()
                        }
                    }
                } label: {
                    PillLabel(title: "Done", fontSize: 15, verticalPadding: 10) { EmptyView() }
                }
                .buttonStyle(.plain)
                .padding(.top, 12)

                // Discard Button — deletes the auto-saved activity
                if !savedByPhone {
                    Button {
                        showDiscardAlert = true
                    } label: {
                        Text("Discard \(activityNoun.lowercased())")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(Self.red.opacity(0.9))
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 4)
                }
            }
            .padding(.horizontal, 2)
        }
        .navigationBarBackButtonHidden(true)
        .onAppear {
            if selectedSubtype == nil { selectedSubtype = initialSubtype }
            if selectedFocusAreas.isEmpty { selectedFocusAreas = initialFocusAreas ?? [] }
            if selectedCountToward == nil { selectedCountToward = initialCountToward }
            // Auto-save immediately (like Apple Fitness)
            if !isSaved && autoSaveTask == nil && !savedByPhone {
                autoSaveTask = Task { await autoSaveWorkout() }
            }
        }
        .alert("Discard \(activityNoun)?", isPresented: $showDiscardAlert) {
            Button("Discard", role: .destructive) {
                // Capture what the background delete needs before we tear the view
                // down. savedActivityId is set synchronously at the top of
                // autoSaveWorkout(), so it's populated by the time the summary is
                // on screen; autoSaveTask lets us wait for the save to *finish*.
                let fallbackId = savedActivityId
                let saveTask = autoSaveTask

                // Dismiss the summary immediately. Never make the user wait on a
                // Firestore round-trip to leave this screen — previously the delete
                // was awaited *before* dismissing, so a slow or unreachable watch
                // connection (or the app suspending mid-wait) left the summary stuck
                // on screen and could abandon the delete entirely.
                workoutMgr.cancelWorkout()
                appVM.phoneService.notifyPhoneWorkoutEnded()
                onDone?()

                // Delete in the background, decoupled from the view's lifecycle.
                Task {
                    // Let the in-flight auto-save complete first so its batchSave
                    // can't land *after* the delete and resurrect the activity. It also
                    // says which id the workout is stored under, which is the phone's
                    // copy when Firestore already had it.
                    var activityId = fallbackId
                    if let saveTask {
                        activityId = await saveTask.value ?? fallbackId
                    }

                    if let activityId {
                        await appVM.deleteActivity(withId: activityId)
                    } else {
                        // Auto-save never produced an id — fall back to a phone
                        // refresh so it re-reads the correct state from Firestore.
                        print("[WorkoutSummary] Discard: no savedActivityId — notifying phone to refresh")
                        appVM.notifyPhoneDataChanged()
                    }
                }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This \(activityNoun.lowercased()) will be permanently deleted.")
        }
        // Sheet-based pickers (work in overlay mode without NavigationStack)
        .sheet(isPresented: $showSubtypePicker) {
            if let subtypes = activityTypeDef?.subtypes {
                NavigationStack {
                    PickerListView(title: subtypePickerTitle, value: selectedSubtype, options: subtypes, selection: $selectedSubtype, tint: look.color)
                }
            }
        }
        .sheet(isPresented: $showFocusAreaPicker) {
            NavigationStack {
                MultiPickerListView(title: "Focus Areas", options: ActivityTypes.strengthFocusAreas, selection: $selectedFocusAreas, tint: look.color)
            }
        }
        .sheet(isPresented: $showCountTowardPicker) {
            NavigationStack {
                if isCircuitActivity {
                    PickerListView(title: "Counts Toward", value: ActivityTypes.circuitCountTowardDisplay(selectedCountToward), options: ActivityTypes.circuitCountTowardOptions, selection: Binding(
                        get: { ActivityTypes.circuitCountTowardDisplay(selectedCountToward) },
                        set: { if let v = $0 { selectedCountToward = ActivityTypes.circuitCountTowardValue(v) } }
                    ), tint: look.color)
                } else {
                    PickerListView(title: "Counts Toward", value: selectedCountToward?.capitalized, options: ActivityTypes.hybridCountTowardOptions, selection: Binding(
                        get: { selectedCountToward?.capitalized },
                        set: { selectedCountToward = $0?.lowercased() }
                    ), tint: look.color)
                }
            }
        }
    }

    // MARK: - Look (board 40's summary)

    private static let red = Color(red: 1.0, green: 0.271, blue: 0.227)     // #FF453A, the heart and Discard
    private static let coral = Color(red: 1.0, green: 0.420, blue: 0.420)   // #FF6B6B, the calories flame
    private static let paceGrey = Color(white: 0.81)                        // #cfcfcf

    /// The workout's category: its colour tints the badge, the "complete" line, the pin and
    /// the picker checkmarks. Hybrid activities follow what they count toward.
    private var look: CategoryLook {
        if strengthType != nil { return .strength }
        switch selectedCountToward ?? initialCountToward {
        case "strength": return .strength
        case "cardio": return .cardio
        case "recovery": return .recovery
        default: break
        }
        guard let def = activityTypeDef else { return .cardio }
        return def.isHybrid ? .neutral : CategoryLook(def.category)
    }

    // MARK: - Header

    private var headerSection: some View {
        HStack(spacing: 9) {
            RoundedRectangle(cornerRadius: 10)
                .fill(look.color.opacity(look == .neutral ? 0.14 : 0.18))
                .frame(width: 34, height: 34)
                .overlay(ActivityIcon(name: strengthType ?? activityType,
                                      sfSymbol: activityTypeDef?.sfSymbol ?? "figure.mixed.cardio",
                                      color: look.color, size: 19))
            VStack(alignment: .leading, spacing: 2) {
                Text(displayName)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                CapsText("\(activityNoun) complete", size: 9, color: look.color)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 2)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Total Time

    /// "31m" or "1h 5m": the numbers big, the units smaller
    private var totalTimeSection: some View {
        let hours = result.duration / 60, minutes = result.duration % 60
        let big = { (s: String) in Text(s).font(.system(size: 44, weight: .heavy)).tracking(-1.8) }
        let unit = { (s: String) in Text(s).font(.system(size: 20, weight: .heavy)).tracking(-0.4) }
        let time: Text = hours > 0
            ? big("\(hours)") + unit("h ") + big("\(minutes)") + unit("m")
            : big("\(minutes)") + unit("m")
        return VStack(spacing: 5) {
            time
                .foregroundColor(.white)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            CapsText("Total time", size: 9.5)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Total time \(formatDuration(result.duration))")
    }

    // MARK: - Stats Section

    private var hasDistanceData: Bool {
        guard showsDistance, let dist = result.distance else { return false }
        return dist > 0.01
    }

    private struct StatCard: Identifiable {
        let id: String
        let icon: WeekLineIcon.Icon
        let iconColor: Color
        let label: String
        let value: Text
        let unit: String
    }

    /// The same stats, under the same conditions as before: distance and pace where the
    /// workout tracks distance, no calories for Sauna/Cold Plunge/Contrast
    private var statCards: [StatCard] {
        var cards: [StatCard] = []
        let unit = appVM.distanceUnit == "km" ? "km" : "mi"
        if hasDistanceData, let distMiles = result.distance {
            let value = unit == "km" ? distMiles * 1.60934 : distMiles
            cards.append(StatCard(id: "distance", icon: .pin, iconColor: look.color, label: "Distance",
                                  value: Text(String(format: "%.2f", value)), unit: unit))
            cards.append(StatCard(id: "pace", icon: .pace, iconColor: Self.paceGrey, label: "Avg pace",
                                  value: Text(averagePaceValue), unit: "/\(unit)"))
        }
        if !isRecoveryActivity {
            cards.append(StatCard(id: "cal", icon: .calories, iconColor: Self.coral, label: "Cal",
                                  value: Text("\(result.calories)"), unit: ""))
        }
        cards.append(StatCard(id: "hr", icon: .heart, iconColor: Self.red, label: "Avg · Max",
                              value: Text("\(result.avgHr)") + Text(" · ").foregroundColor(WeekColors.faint) + Text("\(result.maxHr)"),
                              unit: ""))
        return cards
    }

    private var statsSection: some View {
        let cards = statCards
        let rows = stride(from: 0, to: cards.count, by: 2).map { Array(cards[$0..<min($0 + 2, cards.count)]) }
        return VStack(spacing: 6) {
            ForEach(rows, id: \.first!.id) { row in
                HStack(spacing: 6) {
                    ForEach(row) { statCard($0) }
                }
            }
        }
    }

    /// A small card: the line icon and grey caps label, then a white value and a small grey unit
    private func statCard(_ card: StatCard) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                WeekLineIcon(icon: card.icon, color: card.iconColor, size: 10, lineWidth: 2.4)
                CapsText(card.label, size: 8)
            }
            (card.value.font(.system(size: 17, weight: .bold)).foregroundColor(.white)
             + Text(card.unit.isEmpty ? "" : " " + card.unit)
                .font(.system(size: 11, weight: .semibold)).foregroundColor(WeekColors.faint))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(EdgeInsets(top: 7, leading: 8, bottom: 8, trailing: 8))
        .background(TodayCard(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }

    /// "9:56" — the pace number alone (the unit goes in the card's small grey suffix)
    private var averagePaceValue: String {
        averagePace.components(separatedBy: " ").first ?? averagePace
    }

    // MARK: - Detail Pickers

    private var isHybridActivity: Bool {
        activityTypeDef?.isHybrid ?? false
    }

    private var isCircuitActivity: Bool {
        strengthType == "Circuit"
    }

    private var detailPickersSection: some View {
        VStack(spacing: 6) {
            // Counts toward picker
            if isHybridActivity {
                sheetPickerButton(
                    title: "Counts Toward",
                    value: selectedCountToward?.capitalized,
                    showSheet: $showCountTowardPicker
                )
            } else if isCircuitActivity {
                sheetPickerButton(
                    title: "Counts Toward",
                    value: ActivityTypes.circuitCountTowardDisplay(selectedCountToward),
                    showSheet: $showCountTowardPicker
                )
            }

            // Subtype picker (Running → Easy/Tempo/etc)
            if hasSubtypes {
                sheetPickerButton(
                    title: subtypePickerTitle,
                    value: selectedSubtype,
                    showSheet: $showSubtypePicker
                )
            }

            // Focus area picker (Strength only)
            if hasStrength {
                sheetPickerButton(
                    title: "Focus Areas",
                    value: selectedFocusAreas.isEmpty ? nil : selectedFocusAreas.joined(separator: ", "),
                    showSheet: $showFocusAreaPicker
                )
            }
        }
    }

    /// A picker button that opens a sheet (works in overlay mode without NavigationStack)
    private func sheetPickerButton(title: String, value: String?, showSheet: Binding<Bool>) -> some View {
        Button {
            showSheet.wrappedValue = true
        } label: {
            // A card-surface row: the caps title, the value (or "Tap to choose"), a chevron
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    CapsText(title, size: 8.5)
                    Text(value ?? "Tap to choose")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(value == nil ? WeekColors.muted : .white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                Spacer(minLength: 4)
                WeekLineIcon(icon: .chevronRight, color: WeekColors.faint, size: 11, lineWidth: 2.6)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(TodayCard(cornerRadius: 12))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Auto-Save Workout (saves immediately like Apple Fitness)

    private func autoSaveWorkout() async -> ActivityID? {
        isAutoSaving = true
        defer { isAutoSaving = false }

        // Defensive guard — if every upstream entry path forgot to populate
        // the workout's activity type, never save with type: "". Fall back to
        // "Other" so the entry at least renders and the user can edit it on
        // the phone instead of seeing a blank row with a heartbeat icon.
        let resolvedType = activityType.isEmpty ? "Other" : activityType

        let countToward = ActivityTypes.getDefaultCountToward(type: resolvedType, subtype: selectedSubtype, strengthType: strengthType, countToward: selectedCountToward)

        let activity = Activity.create(
            type: resolvedType,
            subtype: selectedSubtype,
            date: result.startDate,
            duration: result.duration,
            calories: result.calories > 0 ? result.calories : nil,
            avgHr: result.avgHr > 0 ? result.avgHr : nil,
            maxHr: result.maxHr > 0 ? result.maxHr : nil,
            distance: result.distance,
            strengthType: strengthType,
            focusAreas: selectedFocusAreas.isEmpty ? nil : selectedFocusAreas,
            notes: nil,
            healthKitUUID: result.workoutUUID,
            countToward: countToward
        )

        savedActivityId = activity.id
        let storedId = await appVM.saveActivity(activity)
        if let storedId { savedActivityId = storedId }
        isSaved = true
        return storedId
    }

    // MARK: - Re-save if user changed details after auto-save

    private func resaveIfNeeded() async {
        // Done can be tapped while the auto-save is still on the network. Wait for it: an edit
        // sent before the save lands finds nothing to edit, and the save then lands with the
        // original details. Its value is also the id the workout really went under.
        if let autoSaveTask, let storedId = await autoSaveTask.value {
            savedActivityId = storedId
        }
        guard let activityId = savedActivityId else { return }

        // Check if any details differ from what was auto-saved
        let currentFocusAreas = selectedFocusAreas.isEmpty ? nil : selectedFocusAreas
        let currentSubtype = selectedSubtype
        let currentCountToward = ActivityTypes.getDefaultCountToward(type: activityType, subtype: selectedSubtype, strengthType: strengthType, countToward: selectedCountToward)
        // What the auto-save stamped (it resolves the default too), so an untouched Circuit
        // doesn't read as changed and re-save on every Done.
        let savedCountToward = ActivityTypes.getDefaultCountToward(type: activityType, subtype: initialSubtype, strengthType: strengthType, countToward: initialCountToward)

        let initialFocusAreasResolved = (initialFocusAreas?.isEmpty ?? true) ? nil : initialFocusAreas
        let needsUpdate = currentFocusAreas != initialFocusAreasResolved
            || currentSubtype != initialSubtype
            || currentCountToward != savedCountToward

        guard needsUpdate else { return }

        await appVM.updateActivityDetails(ActivityDetailsUpdate(
            activityId: activityId,
            subtype: currentSubtype,
            focusAreas: currentFocusAreas,
            countToward: currentCountToward
        ))
        print("[WorkoutSummary] Re-saved activity with updated details")
    }
}

// MARK: - Picker List View (auto-dismisses on selection)

private struct PickerListView: View {
    @Environment(\.dismiss) private var dismiss

    let title: String
    let value: String?
    let options: [String]
    @Binding var selection: String?
    /// The workout's category colour for the checkmark
    var tint: Color = .white

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
                            .foregroundColor(tint)
                            .font(.system(size: 12, weight: .bold))
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
                                .foregroundColor(tint)
                                .font(.system(size: 12, weight: .bold))
                        }
                    }
                }
            }
        }
        .navigationTitle(title)
    }
}

// MARK: - Multi Picker List View (toggle multiple selections)

private struct MultiPickerListView: View {
    @Environment(\.dismiss) private var dismiss

    let title: String
    let options: [String]
    @Binding var selection: [String]
    /// The workout's category colour for the checkmarks
    var tint: Color = .white

    var body: some View {
        List {
            ForEach(options, id: \.self) { option in
                Button {
                    if selection.contains(option) {
                        selection.removeAll { $0 == option }
                    } else {
                        selection.append(option)
                    }
                } label: {
                    HStack {
                        Text(option)
                        Spacer()
                        if selection.contains(option) {
                            Image(systemName: "checkmark")
                                .foregroundColor(tint)
                                .font(.system(size: 12, weight: .bold))
                        }
                    }
                }
            }

            if !selection.isEmpty {
                Button {
                    dismiss()
                } label: {
                    Text("Done")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .navigationTitle(title)
    }
}
