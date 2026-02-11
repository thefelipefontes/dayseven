import SwiftUI

// MARK: - App Colors (matching iOS app)

struct AppColors {
    static let strength = Color(red: 0.0, green: 1.0, blue: 0.58)    // #00FF94 green
    static let cardio = Color(red: 1.0, green: 0.58, blue: 0.0)      // #FF9500 orange
    static let recovery = Color(red: 0.0, green: 0.82, blue: 1.0)    // #00D1FF blue
    static let streak = Color.yellow
    static let background = Color.black
    static let cardBackground = Color(white: 0.12)
    static let textPrimary = Color.white
    static let textSecondary = Color.gray

    // Heart Rate Zone Colors
    static let zone1 = Color(red: 0.55, green: 0.55, blue: 0.65)   // blue-gray
    static let zone2 = Color(red: 0.0, green: 0.75, blue: 0.65)    // teal
    static let zone3 = Color(red: 0.75, green: 0.85, blue: 0.0)    // yellow-green
    static let zone4 = Color(red: 1.0, green: 0.58, blue: 0.0)     // orange
    static let zone5 = Color(red: 0.85, green: 0.15, blue: 0.35)   // red/magenta
}

// MARK: - Category Colors

extension ActivityCategoryType {
    var color: Color {
        switch self {
        case .strength: return AppColors.strength
        case .cardio: return AppColors.cardio
        case .recovery: return AppColors.recovery
        }
    }

    var emoji: String {
        switch self {
        case .strength: return "\u{1F4AA}"   // 💪
        case .cardio: return "\u{1F525}"     // 🔥
        case .recovery: return "\u{1F9CA}"   // 🧊
        }
    }

    var sfSymbol: String {
        switch self {
        case .strength: return "dumbbell.fill"
        case .cardio: return "figure.run"
        case .recovery: return "figure.cooldown"
        }
    }
}
