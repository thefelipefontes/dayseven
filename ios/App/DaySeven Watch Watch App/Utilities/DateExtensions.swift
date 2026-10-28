import Foundation

// MARK: - Fixed-format date strings shared with the phone

// "yyyy-MM-dd" and "h:mm a" here are data, not display text: the phone parses them as
// Gregorian dates with English AM/PM. A plain DateFormatter follows the user's settings, so
// a watch on the Buddhist or Japanese calendar wrote this year as 2569 or 0008, an Arabic
// locale wrote Arabic-Indic digits, and 24-hour time could turn "h:mm a" into "15:04".
// Every such string goes through these two.
private func makeFixedFormatter(_ format: String) -> DateFormatter {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .autoupdatingCurrent
    formatter.dateFormat = format
    return formatter
}

private let dayFormatter = makeFixedFormatter("yyyy-MM-dd")
private let timeFormatter = makeFixedFormatter("h:mm a")

// MARK: - Parse local date string "YYYY-MM-DD"

func parseLocalDate(_ dateString: String) -> Date? {
    dayFormatter.date(from: dateString)
}

// MARK: - Format date to "YYYY-MM-DD"

func formatDateString(_ date: Date) -> String {
    dayFormatter.string(from: date)
}

// MARK: - Format time to "h:mm a"

func formatTimeString(_ date: Date) -> String {
    timeFormatter.string(from: date)
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
    SharedDefaults.weekStart(containing: Date())
}

// MARK: - Start of today

func startOfToday() -> Date {
    return Calendar.current.startOfDay(for: Date())
}
