import SwiftUI
import Combine
import WatchKit

// MARK: - Celebration Types

enum CelebrationType: String, CaseIterable {
    case steps
    case calories
    case strength
    case cardio
    case recovery
    case master

    var color: Color {
        switch self {
        case .steps: return .green
        case .calories: return .orange
        case .strength: return AppColors.strength
        case .cardio: return AppColors.cardio
        case .recovery: return AppColors.recovery
        case .master: return AppColors.streak
        }
    }

    var icon: String {
        switch self {
        case .steps: return "figure.walk"
        case .calories: return "flame.fill"
        case .strength: return "dumbbell.fill"
        case .cardio: return "figure.run"
        case .recovery: return "figure.cooldown"
        case .master: return "flame.fill"
        }
    }

    var title: String {
        switch self {
        case .steps: return "Steps Goal!"
        case .calories: return "Calories Goal!"
        case .strength: return "Strength Goal!"
        case .cardio: return "Cardio Goal!"
        case .recovery: return "Recovery Goal!"
        case .master: return "Week Complete!"
        }
    }

    /// Whether this is a daily goal (resets each day) vs weekly goal
    var isDaily: Bool {
        self == .steps || self == .calories
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

        if type.isDaily {
            if var daily = defaults.dictionary(forKey: SharedDefaults.dailyGoalsCelebratedKey) as? [String: Any] {
                daily[type.rawValue] = false
                defaults.set(daily, forKey: SharedDefaults.dailyGoalsCelebratedKey)
            }
        } else {
            if var weekly = defaults.dictionary(forKey: SharedDefaults.weekCategoryCelebratedKey) as? [String: Any] {
                weekly[type.rawValue] = false
                defaults.set(weekly, forKey: SharedDefaults.weekCategoryCelebratedKey)
            }
        }
        print("[Celebration] Cleared \(type.rawValue) celebration flag")
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
        guard let defaults = defaults else { return false }

        if type.isDaily {
            guard let daily = defaults.dictionary(forKey: SharedDefaults.dailyGoalsCelebratedKey) as? [String: Any] else { return false }
            // Reset if date changed
            let todayStr = todayDateString()
            if daily["date"] as? String != todayStr { return false }
            return daily[type.rawValue] as? Bool ?? false
        } else {
            guard let weekly = defaults.dictionary(forKey: SharedDefaults.weekCategoryCelebratedKey) as? [String: Any] else { return false }
            let weekStr = currentWeekKey()
            if weekly["week"] as? String != weekStr { return false }
            return weekly[type.rawValue] as? Bool ?? false
        }
    }

    private func markCelebrated(_ type: CelebrationType) {
        guard let defaults = defaults else { return }

        if type.isDaily {
            var daily = defaults.dictionary(forKey: SharedDefaults.dailyGoalsCelebratedKey) as? [String: Any] ?? [:]
            let todayStr = todayDateString()
            // Reset if new day
            if daily["date"] as? String != todayStr {
                daily = ["date": todayStr]
            }
            daily[type.rawValue] = true
            defaults.set(daily, forKey: SharedDefaults.dailyGoalsCelebratedKey)
        } else {
            var weekly = defaults.dictionary(forKey: SharedDefaults.weekCategoryCelebratedKey) as? [String: Any] ?? [:]
            let weekStr = currentWeekKey()
            // Reset if new week
            if weekly["week"] as? String != weekStr {
                weekly = ["week": weekStr]
            }
            weekly[type.rawValue] = true
            defaults.set(weekly, forKey: SharedDefaults.weekCategoryCelebratedKey)
        }
    }

    // MARK: - Haptic Sequences

    private func playHapticSequence(for type: CelebrationType) {
        switch type {
        case .steps, .calories:
            // 4 notification taps + success — similar to Apple Fitness ring close
            let haptics: [WKHapticType] = [.notification, .notification, .notification, .notification, .success]
            playSequence(haptics, interval: 0.25)

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

    private func todayDateString() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    private func currentWeekKey() -> String {
        let calendar = Calendar.current
        let today = Date()
        let weekday = calendar.component(.weekday, from: today) // 1 = Sunday
        let startOfWeek = calendar.date(byAdding: .day, value: -(weekday - 1), to: calendar.startOfDay(for: today))!
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: startOfWeek)
    }
}
