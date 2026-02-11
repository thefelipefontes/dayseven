import SwiftUI

// MARK: - Heart Rate Zone

enum HeartRateZone: Int, CaseIterable {
    case recovery = 1
    case fatBurn = 2
    case aerobic = 3
    case threshold = 4
    case peak = 5

    var name: String {
        switch self {
        case .recovery:  return "RECOVERY"
        case .fatBurn:   return "FAT BURN"
        case .aerobic:   return "AEROBIC"
        case .threshold: return "THRESHOLD"
        case .peak:      return "MAX"
        }
    }

    var label: String {
        return "ZONE \(rawValue)"
    }

    var color: Color {
        switch self {
        case .recovery:  return AppColors.zone1
        case .fatBurn:   return AppColors.zone2
        case .aerobic:   return AppColors.zone3
        case .threshold: return AppColors.zone4
        case .peak:      return AppColors.zone5
        }
    }

    /// Zone thresholds as percentage of max HR
    /// Zone 1: <60%, Zone 2: 60-70%, Zone 3: 70-80%, Zone 4: 80-90%, Zone 5: >90%
    var lowerBoundPercent: Double {
        switch self {
        case .recovery:  return 0.0
        case .fatBurn:   return 0.60
        case .aerobic:   return 0.70
        case .threshold: return 0.80
        case .peak:      return 0.90
        }
    }

    var upperBoundPercent: Double {
        switch self {
        case .recovery:  return 0.60
        case .fatBurn:   return 0.70
        case .aerobic:   return 0.80
        case .threshold: return 0.90
        case .peak:      return 1.0
        }
    }

    /// Determine which zone a heart rate falls into, given a max HR.
    static func zone(for heartRate: Double, maxHR: Double) -> HeartRateZone {
        guard maxHR > 0 else { return .recovery }
        let percent = heartRate / maxHR
        switch percent {
        case ..<0.60:     return .recovery
        case 0.60..<0.70: return .fatBurn
        case 0.70..<0.80: return .aerobic
        case 0.80..<0.90: return .threshold
        default:          return .peak
        }
    }

    /// Returns normalized position (0.0 to 1.0) within the zone bar.
    /// Maps 50%-100% of max HR across the full bar width.
    static func normalizedPosition(for heartRate: Double, maxHR: Double) -> Double {
        guard maxHR > 0 else { return 0 }
        let percent = heartRate / maxHR
        let position = (percent - 0.50) / 0.50
        return Swift.min(Swift.max(position, 0.0), 1.0)
    }
}
