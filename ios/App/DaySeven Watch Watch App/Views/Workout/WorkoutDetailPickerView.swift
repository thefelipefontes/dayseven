import SwiftUI

// MARK: - Workout Detail Picker (Pre-Workout Customization)

struct WorkoutDetailPickerView: View {
    let activityType: String
    let strengthType: String?
    @Binding var path: NavigationPath

    @State private var selectedFocusAreas: Set<String> = []

    private var activityTypeDef: ActivityTypeDefinition? {
        ActivityTypes.all.first { $0.name == activityType }
    }

    var body: some View {
        List {
            if strengthType != nil {
                // Strength: show focus areas
                strengthFocusSection
            } else if let subtypes = activityTypeDef?.subtypes, !subtypes.isEmpty {
                // Cardio/Recovery: show subtypes
                subtypeSection(subtypes)
            }
        }
        .navigationTitle(strengthType ?? activityType)
    }

    // MARK: - Strength Focus Areas

    private var strengthFocusSection: some View {
        Group {
            // Quick start without focus area
            Button {
                path.append(WorkoutDestination.quickStart(activityType: activityType, strengthType: strengthType))
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "play.fill")
                        .font(.system(size: 12))
                        .foregroundColor(.green)
                    Text("Just Start")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.green)
                }
                .padding(.vertical, 2)
            }
            .buttonStyle(.plain)

            // Focus areas (multi-select with checkmarks)
            ForEach(ActivityTypes.strengthFocusAreas, id: \.self) { area in
                Button {
                    if selectedFocusAreas.contains(area) {
                        selectedFocusAreas.remove(area)
                    } else {
                        selectedFocusAreas.insert(area)
                    }
                } label: {
                    HStack {
                        Text(area)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(selectedFocusAreas.contains(area) ? .green : .white)
                        Spacer()
                        if selectedFocusAreas.contains(area) {
                            Image(systemName: "checkmark")
                                .foregroundColor(.green)
                                .font(.system(size: 12))
                        }
                    }
                    .padding(.vertical, 2)
                }
                .buttonStyle(.plain)
            }

            // Start button (appears when ≥1 focus area is selected)
            if !selectedFocusAreas.isEmpty {
                Button {
                    let orderedAreas = ActivityTypes.strengthFocusAreas.filter { selectedFocusAreas.contains($0) }
                    path.append(WorkoutDestination.customStart(
                        activityType: activityType,
                        strengthType: strengthType,
                        subtype: nil,
                        focusAreas: orderedAreas
                    ))
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "play.fill")
                            .font(.system(size: 12))
                            .foregroundColor(.green)
                        Text("Start Workout")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.green)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
                .listRowBackground(Color.green.opacity(0.15))
            }
        }
    }

    // MARK: - Subtypes

    /// Whether the subtypes are Indoor/Outdoor location choices (mandatory, no "Just Start")
    private var isLocationChoice: Bool {
        let subtypes = activityTypeDef?.subtypes ?? []
        return subtypes == ["Outdoor", "Indoor"]
    }

    private func subtypeSection(_ subtypes: [String]) -> some View {
        Group {
            // Quick start without subtype — hidden for Indoor/Outdoor activities
            if !isLocationChoice {
                Button {
                    path.append(WorkoutDestination.quickStart(activityType: activityType, strengthType: nil))
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "play.fill")
                            .font(.system(size: 12))
                            .foregroundColor(.green)
                        Text("Just Start")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.green)
                    }
                    .padding(.vertical, 2)
                }
                .buttonStyle(.plain)
            }

            ForEach(subtypes, id: \.self) { subtype in
                Button {
                    path.append(WorkoutDestination.customStart(
                        activityType: activityType,
                        strengthType: nil,
                        subtype: subtype,
                        focusAreas: nil
                    ))
                } label: {
                    Text(subtype)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.white)
                        .padding(.vertical, 2)
                }
                .buttonStyle(.plain)
            }
        }
    }
}
