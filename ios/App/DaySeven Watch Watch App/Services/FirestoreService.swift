import Foundation
import FirebaseAuth

// MARK: - Firestore REST API Service (watchOS compatible)

class FirestoreService {
    private let projectId = "dayseven-f1a89"
    private var baseURL: String {
        "https://firestore.googleapis.com/v1/projects/\(projectId)/databases/(default)/documents"
    }

    // MARK: - Fetch User Data

    func getUserData(uid: String) async throws -> (goals: UserGoals, streaks: UserStreaks, activities: [Activity], personalRecords: PersonalRecords) {
        let data = try await getDocument("users/\(uid)")

        // Parse goals
        let goals: UserGoals
        if let goalsWrapper = data["goals"] as? [String: Any],
           let goalsMapValue = goalsWrapper["mapValue"] as? [String: Any],
           let goalsMap = goalsMapValue["fields"] as? [String: Any] {
            goals = UserGoals(
                liftsPerWeek: intFromFirestore(goalsMap["liftsPerWeek"]) ?? 4,
                cardioPerWeek: intFromFirestore(goalsMap["cardioPerWeek"]) ?? 3,
                recoveryPerWeek: intFromFirestore(goalsMap["recoveryPerWeek"]) ?? 2,
                stepsPerDay: intFromFirestore(goalsMap["stepsPerDay"]) ?? 10000,
                caloriesPerDay: intFromFirestore(goalsMap["caloriesPerDay"]) ?? 500
            )
        } else {
            goals = .defaults
        }

        // Parse streaks
        let streaks: UserStreaks
        if let streaksWrapper = data["streaks"] as? [String: Any],
           let streaksMapValue = streaksWrapper["mapValue"] as? [String: Any],
           let streaksMap = streaksMapValue["fields"] as? [String: Any] {
            streaks = UserStreaks(
                master: intFromFirestore(streaksMap["master"]) ?? 0,
                lifts: intFromFirestore(streaksMap["lifts"]) ?? 0,
                cardio: intFromFirestore(streaksMap["cardio"]) ?? 0,
                recovery: intFromFirestore(streaksMap["recovery"]) ?? 0,
                stepsGoal: intFromFirestore(streaksMap["stepsGoal"]) ?? 0
            )
        } else {
            streaks = .defaults
        }

        // Parse activities
        var activities: [Activity] = []
        if let activitiesWrapper = data["activities"] as? [String: Any],
           let activitiesArrayValue = activitiesWrapper["arrayValue"] as? [String: Any],
           let activitiesArray = activitiesArrayValue["values"] as? [[String: Any]] {
            for actValue in activitiesArray {
                if let fields = actValue["mapValue"] as? [String: Any],
                   let actFields = fields["fields"] as? [String: Any] {
                    let activity = parseActivity(from: actFields)
                    activities.append(activity)
                }
            }
        }

        // Parse personal records
        let personalRecords: PersonalRecords
        if let prWrapper = data["personalRecords"] as? [String: Any],
           let prMapValue = prWrapper["mapValue"] as? [String: Any],
           let prMap = prMapValue["fields"] as? [String: Any] {
            personalRecords = PersonalRecords(
                longestMasterStreak: intFromFirestore(prMap["longestMasterStreak"]),
                longestStrengthStreak: intFromFirestore(prMap["longestStrengthStreak"]),
                longestCardioStreak: intFromFirestore(prMap["longestCardioStreak"]),
                longestRecoveryStreak: intFromFirestore(prMap["longestRecoveryStreak"])
            )
        } else {
            personalRecords = .defaults
        }

        return (goals, streaks, activities, personalRecords)
    }

    // MARK: - Save Activities

    func saveActivities(uid: String, activities: [Activity]) async throws {
        try await updateDocument("users/\(uid)", fields: [
            "activities": encodeActivitiesArray(activities)
        ])
    }

    // MARK: - Update Streaks

    func updateStreaks(uid: String, streaks: UserStreaks) async throws {
        try await updateDocument("users/\(uid)", fields: [
            "streaks": [
                "mapValue": [
                    "fields": [
                        "master": ["integerValue": String(streaks.master)],
                        "lifts": ["integerValue": String(streaks.lifts)],
                        "cardio": ["integerValue": String(streaks.cardio)],
                        "recovery": ["integerValue": String(streaks.recovery)],
                        "stepsGoal": ["integerValue": String(streaks.stepsGoal)]
                    ]
                ]
            ]
        ])
    }

    // MARK: - Update Personal Records

    func updatePersonalRecords(uid: String, updates: [String: Any]) async throws {
        var fields: [String: Any] = [:]
        for (key, value) in updates {
            if let intVal = value as? Int {
                fields[key] = ["integerValue": String(intVal)]
            }
        }
        // We need to update nested fields within personalRecords
        // Use field mask to update only specific fields
        try await updateDocumentWithFieldMask("users/\(uid)", nestedField: "personalRecords", fields: fields)
    }

    // MARK: - Batch Save (activity + streaks + records in one write)

    func batchSave(uid: String, activities: [Activity], streaks: UserStreaks, recordUpdates: [String: Any]?, weekCelebrations: [String: Any]? = nil) async throws {
        var fields: [String: Any] = [
            "activities": encodeActivitiesArray(activities),
            "streaks": [
                "mapValue": [
                    "fields": [
                        "master": ["integerValue": String(streaks.master)],
                        "lifts": ["integerValue": String(streaks.lifts)],
                        "cardio": ["integerValue": String(streaks.cardio)],
                        "recovery": ["integerValue": String(streaks.recovery)],
                        "stepsGoal": ["integerValue": String(streaks.stepsGoal)]
                    ]
                ]
            ]
        ]

        var fieldMask = ["activities", "streaks"]

        if let records = recordUpdates {
            var prFields: [String: Any] = [:]
            for (key, value) in records {
                if let intVal = value as? Int {
                    prFields[key] = ["integerValue": String(intVal)]
                }
            }
            fields["personalRecords"] = ["mapValue": ["fields": prFields]]
            fieldMask.append("personalRecords")
        }

        if let wc = weekCelebrations {
            var wcFields: [String: Any] = [:]
            if let week = wc["week"] as? String { wcFields["week"] = ["stringValue": week] }
            if let lifts = wc["lifts"] as? Bool { wcFields["lifts"] = ["booleanValue": lifts] }
            if let cardio = wc["cardio"] as? Bool { wcFields["cardio"] = ["booleanValue": cardio] }
            if let recovery = wc["recovery"] as? Bool { wcFields["recovery"] = ["booleanValue": recovery] }
            if let master = wc["master"] as? Bool { wcFields["master"] = ["booleanValue": master] }
            fields["weekCelebrations"] = ["mapValue": ["fields": wcFields]]
            fieldMask.append("weekCelebrations")
        }

        try await updateDocument("users/\(uid)", fields: fields, fieldMask: fieldMask)
    }

    // MARK: - REST API Helpers

    private func getAuthToken() async throws -> String {
        guard let user = Auth.auth().currentUser else {
            throw FirestoreError.notAuthenticated
        }
        return try await user.getIDToken()
    }

    private func getDocument(_ path: String) async throws -> [String: Any] {
        let token = try await getAuthToken()
        let url = URL(string: "\(baseURL)/\(path)")!

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 15

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw FirestoreError.networkError
        }

        guard httpResponse.statusCode == 200 else {
            throw FirestoreError.documentNotFound
        }

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let fields = json["fields"] as? [String: Any] else {
            throw FirestoreError.documentNotFound
        }

        return fields
    }

    private func updateDocument(_ path: String, fields: [String: Any], fieldMask: [String]? = nil) async throws {
        let token = try await getAuthToken()

        var urlString = "\(baseURL)/\(path)"
        if let mask = fieldMask {
            let maskParams = mask.map { "updateMask.fieldPaths=\($0)" }.joined(separator: "&")
            urlString += "?\(maskParams)"
        }

        let url = URL(string: urlString)!

        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 15

        let body: [String: Any] = ["fields": fields]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (responseData, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1
            let responseStr = String(data: responseData, encoding: .utf8) ?? "no body"
            print("[Firestore] updateDocument FAILED status=\(statusCode) path=\(path)")
            print("[Firestore] Response: \(String(responseStr.prefix(500)))")
            throw FirestoreError.saveFailed
        }
        print("[Firestore] updateDocument SUCCESS path=\(path)")
    }

    private func updateDocumentWithFieldMask(_ path: String, nestedField: String, fields: [String: Any]) async throws {
        let token = try await getAuthToken()

        let fieldMaskParams = fields.keys.map { "updateMask.fieldPaths=\(nestedField).\($0)" }.joined(separator: "&")
        let urlString = "\(baseURL)/\(path)?\(fieldMaskParams)"
        let url = URL(string: urlString)!

        // Build nested structure
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 15

        let body: [String: Any] = [
            "fields": [
                nestedField: [
                    "mapValue": [
                        "fields": fields
                    ]
                ]
            ]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw FirestoreError.saveFailed
        }
    }

    // MARK: - Parse Activity from Firestore REST format

    private func parseActivity(from fields: [String: Any]) -> Activity {
        let id: ActivityID
        if let intStr = stringFromFirestore(fields["id"]), let intVal = Int(intStr) {
            id = .int(intVal)
        } else if let intVal = intFromFirestore(fields["id"]) {
            id = .int(intVal)
        } else if let strVal = stringFromFirestore(fields["id"]) {
            id = .string(strVal)
        } else {
            id = .int(Int(Date().timeIntervalSince1970 * 1000))
        }

        return Activity(
            id: id,
            type: stringFromFirestore(fields["type"]) ?? "Other",
            subtype: stringFromFirestore(fields["subtype"]),
            date: stringFromFirestore(fields["date"]) ?? "",
            time: stringFromFirestore(fields["time"]),
            duration: intFromFirestore(fields["duration"]),
            calories: intFromFirestore(fields["calories"]),
            avgHr: intFromFirestore(fields["avgHr"]),
            maxHr: intFromFirestore(fields["maxHr"]),
            distance: doubleFromFirestore(fields["distance"]),
            source: stringFromFirestore(fields["source"]),
            sourceDevice: stringFromFirestore(fields["sourceDevice"]),
            strengthType: stringFromFirestore(fields["strengthType"]),
            focusArea: stringFromFirestore(fields["focusArea"]),
            focusAreas: stringArrayFromFirestore(fields["focusAreas"]),
            notes: stringFromFirestore(fields["notes"]),
            healthKitUUID: stringFromFirestore(fields["healthKitUUID"]),
            linkedHealthKitUUID: stringFromFirestore(fields["linkedHealthKitUUID"]),
            countToward: stringFromFirestore(fields["countToward"]),
            customActivityCategory: stringFromFirestore(fields["customActivityCategory"]),
            customEmoji: stringFromFirestore(fields["customEmoji"]),
            sportEmoji: stringFromFirestore(fields["sportEmoji"]),
            fromAppleHealth: boolFromFirestore(fields["fromAppleHealth"]),
            healthKitSaved: boolFromFirestore(fields["healthKitSaved"]),
            smartSaved: boolFromFirestore(fields["smartSaved"]),
            appleWorkoutName: stringFromFirestore(fields["appleWorkoutName"]),
            photoURL: stringFromFirestore(fields["photoURL"]),
            isPhotoPrivate: boolFromFirestore(fields["isPhotoPrivate"])
        )
    }

    // MARK: - Encode Activity to Firestore REST format

    private func encodeActivity(_ activity: Activity) -> [String: Any] {
        var fields: [String: Any] = [
            "type": ["stringValue": activity.type],
            "date": ["stringValue": activity.date]
        ]

        // Encode ID
        switch activity.id {
        case .int(let val): fields["id"] = ["integerValue": String(val)]
        case .string(let val): fields["id"] = ["stringValue": val]
        }

        // Add optional fields
        if let v = activity.subtype { fields["subtype"] = ["stringValue": v] }
        if let v = activity.time { fields["time"] = ["stringValue": v] }
        if let v = activity.duration { fields["duration"] = ["integerValue": String(v)] }
        if let v = activity.calories { fields["calories"] = ["integerValue": String(v)] }
        if let v = activity.avgHr { fields["avgHr"] = ["integerValue": String(v)] }
        if let v = activity.maxHr { fields["maxHr"] = ["integerValue": String(v)] }
        if let v = activity.distance { fields["distance"] = ["doubleValue": v] }
        if let v = activity.source { fields["source"] = ["stringValue": v] }
        if let v = activity.sourceDevice { fields["sourceDevice"] = ["stringValue": v] }
        if let v = activity.strengthType { fields["strengthType"] = ["stringValue": v] }
        if let v = activity.focusArea { fields["focusArea"] = ["stringValue": v] }
        if let areas = activity.focusAreas, !areas.isEmpty {
            let values = areas.map { ["stringValue": $0] as [String: Any] }
            fields["focusAreas"] = ["arrayValue": ["values": values]]
        }
        if let v = activity.notes { fields["notes"] = ["stringValue": v] }
        if let v = activity.healthKitUUID { fields["healthKitUUID"] = ["stringValue": v] }
        if let v = activity.linkedHealthKitUUID { fields["linkedHealthKitUUID"] = ["stringValue": v] }
        if let v = activity.countToward { fields["countToward"] = ["stringValue": v] }
        if let v = activity.customActivityCategory { fields["customActivityCategory"] = ["stringValue": v] }
        if let v = activity.customEmoji { fields["customEmoji"] = ["stringValue": v] }
        if let v = activity.sportEmoji { fields["sportEmoji"] = ["stringValue": v] }
        if let v = activity.fromAppleHealth { fields["fromAppleHealth"] = ["booleanValue": v] }
        if let v = activity.healthKitSaved { fields["healthKitSaved"] = ["booleanValue": v] }
        if let v = activity.smartSaved { fields["smartSaved"] = ["booleanValue": v] }
        if let v = activity.appleWorkoutName { fields["appleWorkoutName"] = ["stringValue": v] }
        if let v = activity.photoURL { fields["photoURL"] = ["stringValue": v] }
        if let v = activity.isPhotoPrivate { fields["isPhotoPrivate"] = ["booleanValue": v] }

        return fields
    }

    private func encodeActivitiesArray(_ activities: [Activity]) -> [String: Any] {
        let values = activities.map { activity -> [String: Any] in
            ["mapValue": ["fields": encodeActivity(activity)]]
        }
        return ["arrayValue": ["values": values]]
    }

    // MARK: - Firestore REST Value Extractors

    private func stringFromFirestore(_ value: Any?) -> String? {
        guard let dict = value as? [String: Any] else { return nil }
        return dict["stringValue"] as? String
    }

    private func intFromFirestore(_ value: Any?) -> Int? {
        guard let dict = value as? [String: Any] else { return nil }
        if let str = dict["integerValue"] as? String {
            return Int(str)
        }
        if let num = dict["integerValue"] as? Int {
            return num
        }
        // Also handle doubleValue that represents an int
        if let dbl = dict["doubleValue"] as? Double {
            return Int(dbl)
        }
        return nil
    }

    private func doubleFromFirestore(_ value: Any?) -> Double? {
        guard let dict = value as? [String: Any] else { return nil }
        if let dbl = dict["doubleValue"] as? Double {
            return dbl
        }
        if let str = dict["integerValue"] as? String, let intVal = Int(str) {
            return Double(intVal)
        }
        return nil
    }

    private func boolFromFirestore(_ value: Any?) -> Bool? {
        guard let dict = value as? [String: Any] else { return nil }
        return dict["booleanValue"] as? Bool
    }

    private func stringArrayFromFirestore(_ value: Any?) -> [String]? {
        guard let dict = value as? [String: Any],
              let arrayValue = dict["arrayValue"] as? [String: Any],
              let values = arrayValue["values"] as? [[String: Any]] else { return nil }
        return values.compactMap { $0["stringValue"] as? String }
    }
}

// MARK: - Firestore Errors

enum FirestoreError: Error, LocalizedError {
    case documentNotFound
    case encodingFailed
    case notAuthenticated
    case networkError
    case saveFailed

    var errorDescription: String? {
        switch self {
        case .documentNotFound: return "User document not found"
        case .encodingFailed: return "Failed to encode data"
        case .notAuthenticated: return "Not authenticated"
        case .networkError: return "Network error"
        case .saveFailed: return "Failed to save data"
        }
    }
}
