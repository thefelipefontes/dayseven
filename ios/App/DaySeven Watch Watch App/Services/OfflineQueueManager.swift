import Foundation

// MARK: - Offline Queue Manager
// Persists activities that failed to save to Firestore (e.g., no network).
// Activities are stored in the App Group UserDefaults so they survive app restarts.
// Flush is triggered automatically when connectivity returns.

class OfflineQueueManager {
    static let shared = OfflineQueueManager()

    private let defaults = UserDefaults(suiteName: SharedDefaults.suiteName)
    private static let pendingActivitiesKey = "pendingActivities"

    /// Guard against concurrent flush calls from multiple triggers
    var isFlushing = false

    /// Returns true if there are activities waiting to be synced
    var hasPendingActivities: Bool {
        !pendingActivities.isEmpty
    }

    /// Read the current queue from UserDefaults
    var pendingActivities: [Activity] {
        guard let defaults = defaults,
              let data = defaults.data(forKey: Self.pendingActivitiesKey) else {
            return []
        }
        return (try? JSONDecoder().decode([Activity].self, from: data)) ?? []
    }

    /// Add an activity to the offline queue
    func enqueue(_ activity: Activity) {
        var queue = pendingActivities
        // Avoid duplicate entries for the same activity ID
        guard !queue.contains(where: { $0.id == activity.id }) else {
            print("[OfflineQueue] Activity \(activity.id) already in queue, skipping")
            return
        }
        queue.append(activity)
        save(queue)
        print("[OfflineQueue] Enqueued activity \(activity.id). Queue size: \(queue.count)")
    }

    /// Clear the entire queue (e.g., after successful full flush)
    func clearAll() {
        save([])
        print("[OfflineQueue] Cleared all pending activities")
    }

    private func save(_ activities: [Activity]) {
        guard let defaults = defaults else { return }
        if let data = try? JSONEncoder().encode(activities) {
            defaults.set(data, forKey: Self.pendingActivitiesKey)
        }
    }
}
