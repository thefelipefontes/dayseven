import Foundation

// MARK: - Offline Queue Manager
// Persists watch writes that couldn't reach Firestore (e.g., no network): new activities,
// post-workout detail edits, and discards. Stored in the App Group UserDefaults so they
// survive app restarts. Flush is triggered automatically when connectivity returns.

class OfflineQueueManager {
    static let shared = OfflineQueueManager()

    private let defaults = UserDefaults(suiteName: SharedDefaults.suiteName)
    private static let pendingActivitiesKey = "pendingActivities"
    private static let pendingUpdatesKey = "pendingActivityUpdates"
    private static let pendingDeletionsKey = "pendingActivityDeletions"

    /// Guard against concurrent flush calls from multiple triggers
    var isFlushing = false

    /// Returns true if anything is waiting to be synced
    var hasPendingWork: Bool {
        !pendingActivities.isEmpty || !pendingUpdates.isEmpty || !pendingDeletions.isEmpty
    }

    /// Activities waiting to be inserted
    var pendingActivities: [Activity] {
        load([Activity].self, forKey: Self.pendingActivitiesKey)
    }

    /// Detail edits waiting to be applied to activities already in Firestore
    var pendingUpdates: [ActivityDetailsUpdate] {
        load([ActivityDetailsUpdate].self, forKey: Self.pendingUpdatesKey)
    }

    /// Activities waiting to be removed from Firestore (discarded on the watch)
    var pendingDeletions: [ActivityID] {
        load([ActivityID].self, forKey: Self.pendingDeletionsKey)
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
        save(queue, forKey: Self.pendingActivitiesKey)
        print("[OfflineQueue] Enqueued activity \(activity.id). Queue size: \(queue.count)")
    }

    /// Queue a detail edit. An edit to an activity that is itself still queued is folded into
    /// it; otherwise it replaces any older queued edit to the same activity.
    func enqueueUpdate(_ update: ActivityDetailsUpdate) {
        var inserts = pendingActivities
        if let index = inserts.firstIndex(where: { $0.id == update.activityId }) {
            update.apply(to: &inserts[index])
            save(inserts, forKey: Self.pendingActivitiesKey)
            print("[OfflineQueue] Folded edit into queued activity \(update.activityId)")
            return
        }
        var updates = pendingUpdates.filter { $0.activityId != update.activityId }
        updates.append(update)
        save(updates, forKey: Self.pendingUpdatesKey)
        print("[OfflineQueue] Enqueued edit to \(update.activityId). Edits queued: \(updates.count)")
    }

    /// Queue a discard of an activity that may already be in Firestore.
    func enqueueDeletion(_ id: ActivityID) {
        drop(id)
        var deletions = pendingDeletions
        guard !deletions.contains(id) else { return }
        deletions.append(id)
        save(deletions, forKey: Self.pendingDeletionsKey)
        print("[OfflineQueue] Enqueued deletion of \(id). Deletions queued: \(deletions.count)")
    }

    /// Forget any queued insert or edit for this activity (it's being discarded). Without
    /// this, a discarded workout whose auto-save had been queued came back on the next flush.
    func drop(_ id: ActivityID) {
        let inserts = pendingActivities
        if inserts.contains(where: { $0.id == id }) {
            save(inserts.filter { $0.id != id }, forKey: Self.pendingActivitiesKey)
            print("[OfflineQueue] Dropped queued activity \(id)")
        }
        let updates = pendingUpdates
        if updates.contains(where: { $0.activityId == id }) {
            save(updates.filter { $0.activityId != id }, forKey: Self.pendingUpdatesKey)
        }
    }

    /// The current queue applied to a list of activities (for display after a fresh read).
    func applyingPending(to activities: [Activity]) -> [Activity] {
        Self.merge(inserts: pendingActivities, updates: pendingUpdates, deletions: pendingDeletions, into: activities).activities
    }

    /// Applies queued work to a fresh read: discards, then detail edits, then inserts that
    /// aren't already there (by id, or as the phone's copy of the same HealthKit workout).
    /// `changed` is false when the read already reflects all of it.
    static func merge(inserts: [Activity], updates: [ActivityDetailsUpdate], deletions: [ActivityID], into activities: [Activity]) -> (activities: [Activity], changed: Bool) {
        var merged = activities
        var changed = false

        let before = merged.count
        merged.removeAll { deletions.contains($0.id) }
        changed = changed || merged.count != before

        for update in updates {
            guard let index = merged.firstIndex(where: { $0.id == update.activityId }) else { continue }
            update.apply(to: &merged[index])
            changed = true
        }

        for activity in inserts where !deletions.contains(activity.id) {
            if !merged.contains(where: { $0.id == activity.id || activity.isSameHealthKitWorkout(as: $0) }) {
                merged.insert(activity, at: 0)
                changed = true
            }
        }
        return (merged, changed)
    }

    /// Remove what a flush wrote. Work queued while the flush was in flight stays queued.
    func removeFlushed(inserts: [ActivityID], updates: [ActivityDetailsUpdate], deletions: [ActivityID]) {
        save(pendingActivities.filter { !inserts.contains($0.id) }, forKey: Self.pendingActivitiesKey)
        save(pendingUpdates.filter { !updates.contains($0) }, forKey: Self.pendingUpdatesKey)
        save(pendingDeletions.filter { !deletions.contains($0) }, forKey: Self.pendingDeletionsKey)
        print("[OfflineQueue] Cleared flushed work")
    }

    private func load<T: Decodable>(_ type: [T].Type, forKey key: String) -> [T] {
        guard let defaults = defaults,
              let data = defaults.data(forKey: key) else {
            return []
        }
        return (try? JSONDecoder().decode(type, from: data)) ?? []
    }

    private func save<T: Encodable>(_ items: [T], forKey key: String) {
        guard let defaults = defaults else { return }
        if let data = try? JSONEncoder().encode(items) {
            defaults.set(data, forKey: key)
        }
    }
}
