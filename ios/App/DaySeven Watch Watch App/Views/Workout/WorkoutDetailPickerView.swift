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

    /// Strength picks light up Strength green; subtypes use the activity's own category
    private var look: CategoryLook {
        if strengthType != nil { return .strength }
        guard let def = activityTypeDef, !def.isHybrid else { return .neutral }
        return CategoryLook(def.category)
    }

    /// The top action: always a white pill with a black play glyph
    private func startPill(_ title: String) -> some View {
        PillLabel(title: title) { PlayGlyph(color: .black, size: 13) }
    }

    /// A row on the card surface, or tinted and outlined in the category colour when picked
    private func pickRow(_ title: String, picked: Bool, trailing: AnyView? = nil) -> some View {
        HStack {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.white)
            Spacer()
            if picked {
                WeekLineIcon(icon: .check, color: look.color, size: 14, lineWidth: 3)
            } else if let trailing {
                trailing
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .background {
            if picked {
                RoundedRectangle(cornerRadius: 12)
                    .fill(look.color.opacity(look == .neutral ? 0.12 : 0.14))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(look.color.opacity(0.35), lineWidth: 1))
            } else {
                TodayCard(cornerRadius: 12)
            }
        }
        .contentShape(Rectangle())
    }

    var body: some View {
        // A plain stack, not a List: the rows sit 5pt apart like the board, not at the
        // List's row height
        ScrollView {
            VStack(spacing: 5) {
                if strengthType != nil {
                    // Strength: show focus areas
                    strengthFocusSection
                } else if let subtypes = activityTypeDef?.subtypes, !subtypes.isEmpty {
                    // Cardio/Recovery: show subtypes
                    subtypeSection(subtypes)
                }
            }
            .padding(.horizontal, 2)
        }
        .navigationTitle(strengthType ?? activityType)
    }

    // MARK: - Strength Focus Areas

    private var strengthFocusSection: some View {
        Group {
            // Top button: "Just Start" when no focus areas selected, "Start Workout" when areas are selected
            Button {
                if selectedFocusAreas.isEmpty {
                    path.append(WorkoutDestination.quickStart(activityType: activityType, strengthType: strengthType))
                } else {
                    let orderedAreas = ActivityTypes.strengthFocusAreas.filter { selectedFocusAreas.contains($0) }
                    path.append(WorkoutDestination.customStart(
                        activityType: activityType,
                        strengthType: strengthType,
                        subtype: nil,
                        focusAreas: orderedAreas
                    ))
                }
            } label: {
                startPill(selectedFocusAreas.isEmpty ? "Just start" : "Start workout")
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
                    pickRow(area, picked: selectedFocusAreas.contains(area))
                }
                .accessibilityAddTraits(selectedFocusAreas.contains(area) ? .isSelected : [])
                .buttonStyle(.plain)
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
                    startPill("Just start")
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
                    // A subtype starts the workout straight away, so it carries a play glyph
                    pickRow(subtype, picked: false,
                            trailing: AnyView(PlayGlyph(color: look.color, size: 13)))
                }
                .buttonStyle(.plain)
            }
        }
    }
}
