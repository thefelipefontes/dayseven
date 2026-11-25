import SwiftUI

// MARK: - Navigation Destinations

enum WorkoutDestination: Hashable {
    case quickStart(activityType: String, strengthType: String?, countToward: String? = nil)
    case detailPicker(activityType: String, strengthType: String?)
    case customStart(activityType: String, strengthType: String?, subtype: String?, focusAreas: [String]?, countToward: String? = nil)
    case hybridPicker(activityType: String)
}

// MARK: - Start Activity View (One-Tap Start)

struct StartActivityView: View {
    @EnvironmentObject var appVM: AppViewModel
    @Binding var path: NavigationPath

    @State private var showAllCardio = false
    @State private var showAllRecovery = false

    private static let defaultVisibleCount = 4

    private let strengthTypes = ActivityTypes.forCategory(.strength)
    private let cardioTypes = ActivityTypes.all.filter { $0.category == .cardio && !$0.isHybrid }
    private let hybridTypes = ActivityTypes.all.filter { $0.isHybrid }
    private let recoveryTypes = ActivityTypes.all.filter { $0.category == .recovery && !$0.isHybrid }

    var body: some View {
        List {
            // MARK: Strength
            Section {
                ForEach(strengthTypes) { activityType in
                    activityRowWithPlay(
                        symbol: activityType.sfSymbol,
                        iconKey: activityType.name,
                        name: activityType.displayName,
                        look: .strength,
                        activityType: "Strength Training",
                        strengthType: activityType.name,
                        hasDetails: true
                    )
                }
            } header: {
                sectionHeader("Strength", look: .strength)
            }

            // MARK: Cardio
            Section {
                let visibleCardio = showAllCardio ? cardioTypes : Array(cardioTypes.prefix(Self.defaultVisibleCount))
                ForEach(visibleCardio) { activityType in
                    activityRowWithPlay(
                        symbol: activityType.sfSymbol,
                        iconKey: activityType.name,
                        name: activityType.displayName,
                        look: .cardio,
                        activityType: activityType.name,
                        strengthType: nil,
                        hasDetails: !activityType.subtypes.isEmpty
                    )
                }
                if !showAllCardio && cardioTypes.count > Self.defaultVisibleCount {
                    seeMoreButton(count: cardioTypes.count - Self.defaultVisibleCount) {
                        showAllCardio = true
                    }
                }
            } header: {
                sectionHeader("Cardio", look: .cardio)
            }

            // MARK: Hybrid (Yoga/Pilates pick counts-toward; Walking picks indoor/outdoor)
            Section {
                ForEach(hybridTypes) { activityType in
                    if activityType.subtypes.isEmpty {
                        hybridActivityRow(
                            symbol: activityType.sfSymbol,
                            iconKey: activityType.name,
                            name: activityType.displayName,
                            activityType: activityType.name
                        )
                    } else {
                        activityRowWithPlay(
                            symbol: activityType.sfSymbol,
                            iconKey: activityType.name,
                            name: activityType.displayName,
                            look: .neutral,
                            activityType: activityType.name,
                            strengthType: nil,
                            hasDetails: true
                        )
                    }
                }
            } header: {
                sectionHeader("Hybrid", look: .neutral)
            }

            // MARK: Recovery
            Section {
                let visibleRecovery = showAllRecovery ? recoveryTypes : Array(recoveryTypes.prefix(Self.defaultVisibleCount))
                ForEach(visibleRecovery) { activityType in
                    activityRowWithPlay(
                        symbol: activityType.sfSymbol,
                        iconKey: activityType.name,
                        name: activityType.displayName,
                        look: .recovery,
                        activityType: activityType.name,
                        strengthType: nil,
                        hasDetails: !activityType.subtypes.isEmpty
                    )
                }
                if !showAllRecovery && recoveryTypes.count > Self.defaultVisibleCount {
                    seeMoreButton(count: recoveryTypes.count - Self.defaultVisibleCount) {
                        showAllRecovery = true
                    }
                }
            } header: {
                sectionHeader("Recovery", look: .recovery)
            }
        }
        // Rows as compact as the board's (the badge plus 7pt), not the List's default height
        .environment(\.defaultMinListRowHeight, 40)
        .navigationDestination(for: WorkoutDestination.self) { destination in
            switch destination {
            case .quickStart(let activityType, let strengthType, let countToward):
                ActiveWorkoutView(
                    workoutMgr: appVM.workoutManager,
                    activityType: activityType,
                    strengthType: strengthType,
                    preSelectedCountToward: countToward,
                    navigationPath: $path
                )
            case .detailPicker(let activityType, let strengthType):
                WorkoutDetailPickerView(
                    activityType: activityType,
                    strengthType: strengthType,
                    path: $path
                )
            case .customStart(let activityType, let strengthType, let subtype, let focusAreas, let countToward):
                ActiveWorkoutView(
                    workoutMgr: appVM.workoutManager,
                    activityType: activityType,
                    strengthType: strengthType,
                    preSelectedSubtype: subtype,
                    preSelectedFocusAreas: focusAreas,
                    preSelectedCountToward: countToward,
                    navigationPath: $path
                )
            case .hybridPicker(let activityType):
                HybridCountTowardPickerView(
                    activityType: activityType,
                    path: $path
                )
            }
        }
    }

    // MARK: - Activity Row with Play Button

    /// Whether a workout is currently running — blocks starting another
    private var isWorkoutActive: Bool {
        appVM.workoutManager.isActive
    }

    /// Activities that require Indoor/Outdoor selection before starting
    private static let locationActivities: Set<String> = ["Running", "Cycle", "Walking"]

    private func activityRowWithPlay(
        symbol: String,
        iconKey: String,
        name: String,
        look: CategoryLook,
        activityType: String,
        strengthType: String?,
        hasDetails: Bool
    ) -> some View {
        let needsLocationChoice = Self.locationActivities.contains(activityType)

        return HStack(spacing: 6) {
            // Left side: tap for details (if available) or quick start
            // Spacer is inside the label so the entire row area is tappable
            Button {
                guard !isWorkoutActive else { return }
                if hasDetails {
                    path.append(WorkoutDestination.detailPicker(activityType: activityType, strengthType: strengthType))
                } else {
                    path.append(WorkoutDestination.quickStart(activityType: activityType, strengthType: strengthType))
                }
            } label: {
                rowLabel(symbol: symbol, iconKey: iconKey, name: name, look: look)
            }
            .buttonStyle(.plain)
            .disabled(isWorkoutActive)

            // Right side: play button
            // For location activities (Running/Walking/Cycling), go to Indoor/Outdoor picker
            // For others, instant quick start
            Button {
                guard !isWorkoutActive else { return }
                if needsLocationChoice {
                    path.append(WorkoutDestination.detailPicker(activityType: activityType, strengthType: strengthType))
                } else {
                    path.append(WorkoutDestination.quickStart(activityType: activityType, strengthType: strengthType))
                }
            } label: {
                PlayCircle(look: look, dimmed: isWorkoutActive)
            }
            .buttonStyle(.plain)
            .disabled(isWorkoutActive)
            .accessibilityLabel("Start \(name)")
        }
        .modifier(CardRow())
    }

    /// The tinted badge with the activity's icon, then its name.
    private func rowLabel(symbol: String, iconKey: String, name: String, look: CategoryLook) -> some View {
        HStack(spacing: 9) {
            RoundedRectangle(cornerRadius: 9)
                .fill(look.badgeTint)
                .frame(width: 30, height: 30)
                .overlay(ActivityIcon(name: iconKey, sfSymbol: symbol, color: look.color, size: 16))
            Text(name)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
        }
        .opacity(isWorkoutActive ? 0.35 : 1)
        .contentShape(Rectangle())
    }

    // MARK: - Hybrid Activity Row (Yoga/Pilates → count toward picker)

    private func hybridActivityRow(
        symbol: String,
        iconKey: String,
        name: String,
        activityType: String
    ) -> some View {
        HStack(spacing: 6) {
            Button {
                guard !isWorkoutActive else { return }
                path.append(WorkoutDestination.hybridPicker(activityType: activityType))
            } label: {
                rowLabel(symbol: symbol, iconKey: iconKey, name: name, look: .neutral)
            }
            .buttonStyle(.plain)
            .disabled(isWorkoutActive)

            Button {
                guard !isWorkoutActive else { return }
                path.append(WorkoutDestination.hybridPicker(activityType: activityType))
            } label: {
                PlayCircle(look: .neutral, dimmed: isWorkoutActive)
            }
            .buttonStyle(.plain)
            .disabled(isWorkoutActive)
            .accessibilityLabel("Start \(name)")
        }
        .modifier(CardRow())
    }

    // MARK: - See More Button

    private func seeMoreButton(count: Int, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Text("See \(count) more")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(WeekColors.daysLeft)
                WeekLineIcon(icon: .chevronDown, color: WeekColors.faint, size: 12, lineWidth: 2.6)
                Spacer()
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(Color.clear)
    }

    // MARK: - Section Header

    /// The category's line icon in its colour, then the title in grey caps.
    private func sectionHeader(_ title: String, look: CategoryLook) -> some View {
        HStack(spacing: 6) {
            if look == .neutral {
                Image(systemName: "wind")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(WeekColors.muted)
            } else {
                WeekLineIcon(icon: look.icon, color: look.color, size: 12)
            }
            CapsText(title, size: 10)
        }
    }
}

// MARK: - Start-page pieces

/// The round play button in the category's tint, with the glyph in its colour.
struct PlayCircle: View {
    let look: CategoryLook
    var dimmed = false
    var size: CGFloat = 30

    var body: some View {
        Circle()
            .fill(look.tint)
            .frame(width: size, height: size)
            .overlay(PlayGlyph(color: look.color, size: size * 0.4).offset(x: 1))
            .opacity(dimmed ? 0.35 : 1)
    }
}

/// A list row on the phone's card surface.
struct CardRow: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.vertical, 1)
            .listRowBackground(TodayCard(cornerRadius: 15))
            .listRowInsets(EdgeInsets(top: 6, leading: 7, bottom: 6, trailing: 7))
    }
}

// MARK: - Hybrid "Counts Toward" Picker (Yoga/Pilates)


struct HybridCountTowardPickerView: View {
    let activityType: String
    @Binding var path: NavigationPath

    private let options: [(label: String, value: String, look: CategoryLook)] = [
        ("Recovery", "recovery", .recovery),
        ("Cardio", "cardio", .cardio),
        ("Strength", "strength", .strength),
    ]

    var body: some View {
        List {
            ForEach(options, id: \.value) { option in
                Button {
                    path.append(WorkoutDestination.quickStart(
                        activityType: activityType,
                        strengthType: nil,
                        countToward: option.value
                    ))
                } label: {
                    HStack(spacing: 9) {
                        RoundedRectangle(cornerRadius: 9)
                            .fill(option.look.badgeTint)
                            .frame(width: 30, height: 30)
                            .overlay(WeekLineIcon(icon: option.look.icon, color: option.look.color, size: 16))
                        Text(option.label)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.white)
                        Spacer(minLength: 0)
                        PlayCircle(look: option.look)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Start, counts toward \(option.label)")
                .modifier(CardRow())
            }
        }
        .environment(\.defaultMinListRowHeight, 40)
        .navigationTitle(activityType)
    }
}
