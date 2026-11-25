import SwiftUI
import Combine
import WatchKit

// MARK: - Celebration Types

enum CelebrationType: String, CaseIterable {
    // The watch celebrates a category finishing for the week, right after the save that
    // finished it. (The daily Steps and Calories celebrations never fired and are gone.)
    case strength
    case cardio
    case recovery
    case master

    var color: Color {
        switch self {
        case .strength: return AppColors.strength
        case .cardio: return AppColors.cardio
        case .recovery: return AppColors.recovery
        case .master: return WeekColors.gold
        }
    }

    /// Home's line icon for the category
    var lineIcon: WeekLineIcon.Icon {
        switch self {
        case .strength: return .strength
        case .cardio: return .cardio
        case .recovery: return .recovery
        case .master: return .strength
        }
    }

    var title: String {
        switch self {
        case .strength: return "Strength done"
        case .cardio: return "Cardio done"
        case .recovery: return "Recovery done"
        case .master: return "Week won"
        }
    }
}

// MARK: - Celebration Event

struct CelebrationEvent: Equatable {
    let type: CelebrationType
    let streakCount: Int?
    let timestamp: Date

    static func == (lhs: CelebrationEvent, rhs: CelebrationEvent) -> Bool {
        lhs.type == rhs.type && lhs.timestamp == rhs.timestamp
    }
}

// MARK: - Celebration Manager

@MainActor
class CelebrationManager: ObservableObject {
    @Published var activeCelebration: CelebrationEvent? = nil

    private var dismissTimer: Timer?
    private var celebrationQueue: [CelebrationEvent] = []
    private let defaults = SharedDefaults.shared

    // MARK: - Trigger Celebration

    func triggerCelebration(_ type: CelebrationType, streakCount: Int? = nil, isBackground: Bool) {
        guard !hasCelebrated(type) else {
            print("[Celebration] Already celebrated \(type.rawValue) — skipping")
            return
        }

        markCelebrated(type)

        // Always play haptics (works in background too)
        playHapticSequence(for: type)
        print("[Celebration] \(type.rawValue) haptic played (background=\(isBackground))")

        // If foreground, also show visual overlay
        if !isBackground {
            let event = CelebrationEvent(type: type, streakCount: streakCount, timestamp: Date())

            if activeCelebration != nil {
                // Queue it — will play after current one dismisses
                celebrationQueue.append(event)
                print("[Celebration] Queued \(type.rawValue) (queue size: \(celebrationQueue.count))")
            } else {
                showCelebration(event)
            }
        }
    }

    // MARK: - Clear Celebration (for activity deletion)

    func clearCelebration(_ type: CelebrationType) {
        guard let defaults = defaults else { return }

        if var weekly = defaults.dictionary(forKey: SharedDefaults.weekCategoryCelebratedKey) {
            weekly[type.rawValue] = false
            defaults.set(weekly, forKey: SharedDefaults.weekCategoryCelebratedKey)
        }
        print("[Celebration] Cleared \(type.rawValue) celebration flag")
    }

    // MARK: - Reset (sign-out)

    /// Drops whatever is showing or queued. The stored flags are cleared with the rest of the
    /// account's data (SharedDefaults.clearUserData).
    func reset() {
        dismissTimer?.invalidate()
        dismissTimer = nil
        celebrationQueue = []
        activeCelebration = nil
    }

    // MARK: - Show / Dismiss

    private func showCelebration(_ event: CelebrationEvent) {
        activeCelebration = event
        print("[Celebration] Showing \(event.type.rawValue) overlay")

        dismissTimer?.invalidate()
        dismissTimer = Timer.scheduledTimer(withTimeInterval: 3.5, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.dismissCurrent()
            }
        }
    }

    private func dismissCurrent() {
        activeCelebration = nil

        // Process queue after a short gap
        if !celebrationQueue.isEmpty {
            let next = celebrationQueue.removeFirst()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
                self?.showCelebration(next)
            }
        }
    }

    // MARK: - Duplicate Prevention

    private func hasCelebrated(_ type: CelebrationType) -> Bool {
        guard let defaults = defaults,
              let weekly = defaults.dictionary(forKey: SharedDefaults.weekCategoryCelebratedKey) else { return false }
        if weekly["week"] as? String != currentWeekKey() { return false }
        return weekly[type.rawValue] as? Bool ?? false
    }

    private func markCelebrated(_ type: CelebrationType) {
        guard let defaults = defaults else { return }

        var weekly = defaults.dictionary(forKey: SharedDefaults.weekCategoryCelebratedKey) ?? [:]
        let weekStr = currentWeekKey()
        // Reset if new week
        if weekly["week"] as? String != weekStr {
            weekly = ["week": weekStr]
        }
        weekly[type.rawValue] = true
        defaults.set(weekly, forKey: SharedDefaults.weekCategoryCelebratedKey)
    }

    // MARK: - Haptic Sequences

    private func playHapticSequence(for type: CelebrationType) {
        switch type {
        case .strength, .cardio, .recovery:
            // 3 rising taps + success
            let haptics: [WKHapticType] = [.directionUp, .directionUp, .directionUp, .success]
            playSequence(haptics, interval: 0.2)

        case .master:
            // Longer celebration — click + 4 rising taps + success
            let haptics: [WKHapticType] = [.click, .directionUp, .directionUp, .directionUp, .directionUp, .success]
            playSequence(haptics, interval: 0.2)
        }
    }

    private func playSequence(_ haptics: [WKHapticType], interval: TimeInterval) {
        for (index, haptic) in haptics.enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + interval * Double(index)) {
                WKInterfaceDevice.current().play(haptic)
            }
        }
    }

    // MARK: - Date Helpers

    private func currentWeekKey() -> String {
        formatDateString(startOfCurrentWeek())
    }
}
