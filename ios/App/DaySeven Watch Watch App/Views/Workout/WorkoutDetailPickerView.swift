import SwiftUI

// MARK: - Workout Detail Picker (Pre-Workout Customization)

struct WorkoutDetailPickerView: View {
    let activityType: String
    let strengthType: String?
    @Binding var path: NavigationPath

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

            // Focus areas
            ForEach(ActivityTypes.strengthFocusAreas, id: \.self) { area in
                Button {
                    path.append(WorkoutDestination.customStart(
                        activityType: activityType,
                        strengthType: strengthType,
                        subtype: nil,
                        focusArea: area
                    ))
                } label: {
                    Text(area)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.white)
                        .padding(.vertical, 2)
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Subtypes

    private func subtypeSection(_ subtypes: [String]) -> some View {
        Group {
            // Quick start without subtype
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

            ForEach(subtypes, id: \.self) { subtype in
                Button {
                    path.append(WorkoutDestination.customStart(
                        activityType: activityType,
                        strengthType: nil,
                        subtype: subtype,
                        focusArea: nil
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
