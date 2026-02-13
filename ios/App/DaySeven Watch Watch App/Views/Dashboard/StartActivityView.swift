import SwiftUI

// MARK: - Navigation Destinations

enum WorkoutDestination: Hashable {
    case quickStart(activityType: String, strengthType: String?, countToward: String? = nil)
    case detailPicker(activityType: String, strengthType: String?)
    case customStart(activityType: String, strengthType: String?, subtype: String?, focusArea: String?, countToward: String? = nil)
    case hybridPicker(activityType: String)
}

// MARK: - Start Activity View (One-Tap Start)

struct StartActivityView: View {
    @EnvironmentObject var appVM: AppViewModel
    @Binding var path: NavigationPath

    private let strengthDef = ActivityTypes.all.first { $0.name == "Strength Training" }
    private let cardioTypes = ActivityTypes.forCategory(.cardio)
    private let hybridTypes = ActivityTypes.all.filter { $0.isHybrid }
    private let recoveryTypes = ActivityTypes.all.filter { $0.category == .recovery && !$0.isHybrid }

    var body: some View {
        List {
            // MARK: Strength
            Section {
                if let strengthTypes = strengthDef?.strengthTypes {
                    ForEach(strengthTypes, id: \.self) { type in
                        activityRowWithPlay(
                            symbol: type == "Lifting" ? "dumbbell.fill" : "figure.strengthtraining.functional",
                            name: type,
                            color: AppColors.strength,
                            activityType: "Strength Training",
                            strengthType: type,
                            hasDetails: true
                        )
                    }
                }
            } header: {
                sectionHeader("Strength", symbol: "dumbbell.fill", color: AppColors.strength)
            }

            // MARK: Cardio
            Section {
                ForEach(cardioTypes) { activityType in
                    activityRowWithPlay(
                        symbol: activityType.sfSymbol,
                        name: activityType.name,
                        color: AppColors.cardio,
                        activityType: activityType.name,
                        strengthType: nil,
                        hasDetails: !activityType.subtypes.isEmpty
                    )
                }
            } header: {
                sectionHeader("Cardio", symbol: "figure.run", color: AppColors.cardio)
            }

            // MARK: Mind & Body (Hybrid — counts toward cardio, strength, or recovery)
            Section {
                ForEach(hybridTypes) { activityType in
                    hybridActivityRow(
                        symbol: activityType.sfSymbol,
                        name: activityType.name,
                        activityType: activityType.name
                    )
                }
            } header: {
                sectionHeader("Mind & Body", symbol: "figure.yoga", color: .purple)
            }

            // MARK: Recovery
            Section {
                ForEach(recoveryTypes) { activityType in
                    activityRowWithPlay(
                        symbol: activityType.sfSymbol,
                        name: activityType.name,
                        color: AppColors.recovery,
                        activityType: activityType.name,
                        strengthType: nil,
                        hasDetails: !activityType.subtypes.isEmpty
                    )
                }
            } header: {
                sectionHeader("Recovery", symbol: "figure.cooldown", color: AppColors.recovery)
            }
        }
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
            case .customStart(let activityType, let strengthType, let subtype, let focusArea, let countToward):
                ActiveWorkoutView(
                    workoutMgr: appVM.workoutManager,
                    activityType: activityType,
                    strengthType: strengthType,
                    preSelectedSubtype: subtype,
                    preSelectedFocusArea: focusArea,
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
        name: String,
        color: Color,
        activityType: String,
        strengthType: String?,
        hasDetails: Bool
    ) -> some View {
        let needsLocationChoice = Self.locationActivities.contains(activityType)

        return HStack {
            // Left side: tap for details (if available) or quick start
            Button {
                guard !isWorkoutActive else { return }
                if hasDetails {
                    path.append(WorkoutDestination.detailPicker(activityType: activityType, strengthType: strengthType))
                } else {
                    path.append(WorkoutDestination.quickStart(activityType: activityType, strengthType: strengthType))
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: symbol)
                        .font(.system(size: 20))
                        .foregroundColor(isWorkoutActive ? color.opacity(0.3) : color)
                        .frame(width: 28)
                    Text(name)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(isWorkoutActive ? .gray : .white)
                }
            }
            .buttonStyle(.plain)
            .disabled(isWorkoutActive)

            Spacer()

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
                Image(systemName: "play.circle.fill")
                    .font(.system(size: 36))
                    .foregroundColor(isWorkoutActive ? .green.opacity(0.3) : .green)
            }
            .buttonStyle(.plain)
            .disabled(isWorkoutActive)
        }
        .padding(.vertical, 6)
    }

    // MARK: - Hybrid Activity Row (Yoga/Pilates → count toward picker)

    private func hybridActivityRow(
        symbol: String,
        name: String,
        activityType: String
    ) -> some View {
        HStack {
            Button {
                guard !isWorkoutActive else { return }
                path.append(WorkoutDestination.hybridPicker(activityType: activityType))
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: symbol)
                        .font(.system(size: 20))
                        .foregroundColor(isWorkoutActive ? Color.purple.opacity(0.3) : .purple)
                        .frame(width: 28)
                    Text(name)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(isWorkoutActive ? .gray : .white)
                }
            }
            .buttonStyle(.plain)
            .disabled(isWorkoutActive)

            Spacer()

            Button {
                guard !isWorkoutActive else { return }
                path.append(WorkoutDestination.hybridPicker(activityType: activityType))
            } label: {
                Image(systemName: "play.circle.fill")
                    .font(.system(size: 36))
                    .foregroundColor(isWorkoutActive ? .green.opacity(0.3) : .green)
            }
            .buttonStyle(.plain)
            .disabled(isWorkoutActive)
        }
        .padding(.vertical, 6)
    }

    // MARK: - Section Header

    private func sectionHeader(_ title: String, symbol: String, color: Color) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(color)
            Text(title.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(color)
        }
    }
}

// MARK: - Hybrid "Counts Toward" Picker (Yoga/Pilates)

private struct HybridOption: Identifiable {
    let id: String  // same as value
    let label: String
    let value: String
    let symbol: String
    let color: Color
}

struct HybridCountTowardPickerView: View {
    let activityType: String
    @Binding var path: NavigationPath

    private let options: [HybridOption] = [
        HybridOption(id: "recovery", label: "Recovery", value: "recovery", symbol: "figure.cooldown", color: AppColors.recovery),
        HybridOption(id: "cardio", label: "Cardio", value: "cardio", symbol: "figure.run", color: AppColors.cardio),
        HybridOption(id: "strength", label: "Strength", value: "strength", symbol: "dumbbell.fill", color: AppColors.strength),
    ]

    var body: some View {
        List {
            ForEach(options) { option in
                Button {
                    path.append(WorkoutDestination.quickStart(
                        activityType: activityType,
                        strengthType: nil,
                        countToward: option.value
                    ))
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: option.symbol)
                            .font(.system(size: 16))
                            .foregroundColor(option.color)
                            .frame(width: 24)
                        Text(option.label)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundColor(.white)
                        Spacer()
                        Image(systemName: "play.circle.fill")
                            .font(.system(size: 24))
                            .foregroundColor(.green)
                    }
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
            }
        }
        .navigationTitle(activityType)
    }
}
