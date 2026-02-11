import Foundation

// MARK: - Parse local date string "YYYY-MM-DD"

func parseLocalDate(_ dateString: String) -> Date? {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.timeZone = .current
    return formatter.date(from: dateString)
}

// MARK: - Format date to "YYYY-MM-DD"

func formatDateString(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.timeZone = .current
    return formatter.string(from: date)
}

// MARK: - Format time to "h:mm a"

func formatTimeString(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "h:mm a"
    formatter.timeZone = .current
    return formatter.string(from: date)
}

// MARK: - Format elapsed seconds to "MM:SS" or "H:MM:SS" (whole seconds)

func formatElapsedTime(_ seconds: Int) -> String {
    let hours = seconds / 3600
    let minutes = (seconds % 3600) / 60
    let secs = seconds % 60

    if hours > 0 {
        return String(format: "%d:%02d:%02d", hours, minutes, secs)
    } else {
        return String(format: "%02d:%02d", minutes, secs)
    }
}

// MARK: - Format elapsed time with hundredths "MM:SS.cc" or "H:MM:SS.cc"

func formatElapsedTimePrecise(_ interval: TimeInterval) -> String {
    let totalSeconds = Int(interval)
    let hundredths = Int((interval - Double(totalSeconds)) * 100)
    let hours = totalSeconds / 3600
    let minutes = (totalSeconds % 3600) / 60
    let secs = totalSeconds % 60

    if hours > 0 {
        return String(format: "%d:%02d:%02d.%02d", hours, minutes, secs, hundredths)
    } else {
        return String(format: "%02d:%02d.%02d", minutes, secs, hundredths)
    }
}

// MARK: - Format duration in minutes to readable string

func formatDuration(_ minutes: Int) -> String {
    if minutes >= 60 {
        let hrs = minutes / 60
        let mins = minutes % 60
        if mins > 0 {
            return "\(hrs)h \(mins)m"
        }
        return "\(hrs)h"
    }
    return "\(minutes)m"
}

// MARK: - Start of current week (Sunday)

func startOfCurrentWeek() -> Date {
    let calendar = Calendar.current
    let today = Date()
    let weekday = calendar.component(.weekday, from: today)
    return calendar.date(byAdding: .day, value: -(weekday - 1), to: calendar.startOfDay(for: today))!
}

// MARK: - Start of today

func startOfToday() -> Date {
    return Calendar.current.startOfDay(for: Date())
}
