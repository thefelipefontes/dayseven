import Foundation

// MARK: - Offline Queue Manager
// Persists watch writes that couldn't reach Firestore (e.g., no network): new activities,
// post-workout detail edits, and discards. Stored in the App Group UserDefaults so they
// survive app restarts. Flush is triggered automatically when connectivity returns.
//
// Every item is filed under the account it belongs to, in its own UserDefaults keys, and can
// only be read back by naming that account. A flush reads the signed-in account's items and
// writes them to that account's document, so an item can't reach a different one.

class OfflineQueueManager {
    static let shared = OfflineQueueManager()

    private let defaults: UserDefaults?
    private static let pendingActivitiesKey = "pendingActivities"
    private static let pendingUpdatesKey = "pendingActivityUpdates"
    private static let pendingDeletionsKey = "pendingActivityDeletions"
    private static let allKeys = [pendingActivitiesKey, pendingUpdatesKey, pendingDeletionsKey]

    /// Guard against concurrent flush calls from multiple triggers
    var isFlushing = false

    init(defaults: UserDefaults? = UserDefaults(suiteName: SharedDefaults.suiteName)) {
        self.defaults = defaults
    }

    private static func key(_ base: String, for uid: String) -> String {
        "\(base).\(uid)"
    }

    /// Returns true if anything is waiting to be synced for this account
    func hasPendingWork(for uid: String) -> Bool {
        !pendingActivities(for: uid).isEmpty || !pendingUpdates(for: uid).isEmpty || !pendingDeletions(for: uid).isEmpty
    }

    /// Activities waiting to be inserted
    func pendingActivities(for uid: String) -> [Activity] {
        load([Activity].self, forKey: Self.key(Self.pendingActivitiesKey, for: uid))
    }

    /// Detail edits waiting to be applied to activities already in Firestore
    func pendingUpdates(for uid: String) -> [ActivityDetailsUpdate] {
        load([ActivityDetailsUpdate].self, forKey: Self.key(Self.pendingUpdatesKey, for: uid))
    }

    /// Activities waiting to be removed from Firestore (discarded on the watch)
    func pendingDeletions(for uid: String) -> [ActivityID] {
        load([ActivityID].self, forKey: Self.key(Self.pendingDeletionsKey, for: uid))
    }

    /// Add an activity to the offline queue
    func enqueue(_ activity: Activity, for uid: String) {
        var queue = pendingActivities(for: uid)
        // Avoid duplicate entries for the same activity ID
        guard !queue.contains(where: { $0.id == activity.id }) else {
            print("[OfflineQueue] Activity \(activity.id) already in queue, skipping")
            return
        }
        queue.append(activity)
        save(queue, forKey: Self.key(Self.pendingActivitiesKey, for: uid))
        print("[OfflineQueue] Enqueued activity \(activity.id). Queue size: \(queue.count)")
    }

    /// Queue a detail edit, replacing any older queued edit to the same activity. It stays its
    /// own entry even when the activity's save is queued too (merge applies edits after
    /// inserts): rewriting the queued save in place lost the edit whenever a flush had
    /// already snapshotted the old copy.
    func enqueueUpdate(_ update: ActivityDetailsUpdate, for uid: String) {
        var updates = pendingUpdates(for: uid).filter { $0.activityId != update.activityId }
        updates.append(update)
        save(updates, forKey: Self.key(Self.pendingUpdatesKey, for: uid))
        print("[OfflineQueue] Enqueued edit to \(update.activityId). Edits queued: \(updates.count)")
    }

    /// Queue a discard of an activity that may already be in Firestore.
    func enqueueDeletion(_ id: ActivityID, for uid: String) {
        drop(id, for: uid)
        var deletions = pendingDeletions(for: uid)
        guard !deletions.contains(id) else { return }
        deletions.append(id)
        save(deletions, forKey: Self.key(Self.pendingDeletionsKey, for: uid))
        print("[OfflineQueue] Enqueued deletion of \(id). Deletions queued: \(deletions.count)")
    }

    /// Forget any queued insert or edit for this activity (it's being discarded). Without
    /// this, a discarded workout whose auto-save had been queued came back on the next flush.
    /// Returns whether its save was queued.
    @discardableResult
    func drop(_ id: ActivityID, for uid: String) -> Bool {
        let inserts = pendingActivities(for: uid)
        let wasQueued = inserts.contains(where: { $0.id == id })
        if wasQueued {
            save(inserts.filter { $0.id != id }, forKey: Self.key(Self.pendingActivitiesKey, for: uid))
            print("[OfflineQueue] Dropped queued activity \(id)")
        }
        let updates = pendingUpdates(for: uid)
        if updates.contains(where: { $0.activityId == id }) {
            save(updates.filter { $0.activityId != id }, forKey: Self.key(Self.pendingUpdatesKey, for: uid))
        }
        return wasQueued
    }

    /// The current queue applied to a list of activities (for display after a fresh read).
    func applyingPending(to activities: [Activity], for uid: String) -> [Activity] {
        Self.merge(inserts: pendingActivities(for: uid), updates: pendingUpdates(for: uid), deletions: pendingDeletions(for: uid), into: activities).activities
    }

    /// Applies queued work to a fresh read: discards, then inserts that aren't already there
    /// (by id, or as the phone's copy of the same HealthKit workout), then detail edits — last,
    /// so an edit to a workout whose save is queued too lands on it.
    /// `changed` is false when the read already reflects all of it.
    static func merge(inserts: [Activity], updates: [ActivityDetailsUpdate], deletions: [ActivityID], into activities: [Activity]) -> (activities: [Activity], changed: Bool) {
        var merged = activities
        var changed = false

        let before = merged.count
        merged.removeAll { deletions.contains($0.id) }
        changed = changed || merged.count != before

        for activity in inserts where !deletions.contains(activity.id) {
            if !merged.contains(where: { $0.id == activity.id || activity.isSameHealthKitWorkout(as: $0) }) {
                merged.insert(activity, at: 0)
                changed = true
            }
        }

        for update in updates {
            guard let index = merged.firstIndex(where: { $0.id == update.activityId }) else { continue }
            update.apply(to: &merged[index])
            changed = true
        }
        return (merged, changed)
    }

    /// Forget everything queued, for every account (sign-out): unsynced work stays on no watch
    /// after its account has signed out of it.
    func clearAll() {
        guard let defaults = defaults else { return }
        for key in defaults.dictionaryRepresentation().keys
        where Self.allKeys.contains(where: { key == $0 || key.hasPrefix("\($0).") }) {
            defaults.removeObject(forKey: key)
        }
        print("[OfflineQueue] Cleared all queued work")
    }

    /// Older builds kept one queue with no account on it, so what's in it has no owner. Run at
    /// launch, before anything reads the queue: whoever is signed in across the update is who
    /// queued it, and it moves to them. With nobody signed in it goes, because nothing says it
    /// belongs to whoever signs in next.
    func resolveUnownedQueue(signedInUid uid: String?) {
        guard let defaults = defaults,
              Self.allKeys.contains(where: { defaults.object(forKey: $0) != nil }) else { return }
        if let uid = uid {
            load([Activity].self, forKey: Self.pendingActivitiesKey).forEach { enqueue($0, for: uid) }
            load([ActivityDetailsUpdate].self, forKey: Self.pendingUpdatesKey).forEach { enqueueUpdate($0, for: uid) }
            load([ActivityID].self, forKey: Self.pendingDeletionsKey).forEach { enqueueDeletion($0, for: uid) }
        }
        Self.allKeys.forEach { defaults.removeObject(forKey: $0) }
        print("[OfflineQueue] Resolved the queue from before accounts: \(uid == nil ? "signed out, dropped it" : "moved to the signed-in account")")
    }

    /// Remove what a flush wrote. Work queued while the flush was in flight stays queued.
    func removeFlushed(inserts: [ActivityID], updates: [ActivityDetailsUpdate], deletions: [ActivityID], for uid: String) {
        save(pendingActivities(for: uid).filter { !inserts.contains($0.id) }, forKey: Self.key(Self.pendingActivitiesKey, for: uid))
        save(pendingUpdates(for: uid).filter { !updates.contains($0) }, forKey: Self.key(Self.pendingUpdatesKey, for: uid))
        save(pendingDeletions(for: uid).filter { !deletions.contains($0) }, forKey: Self.key(Self.pendingDeletionsKey, for: uid))
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
        if items.isEmpty {
            defaults.removeObject(forKey: key)
        } else if let data = try? JSONEncoder().encode(items) {
            defaults.set(data, forKey: key)
        }
    }
}
