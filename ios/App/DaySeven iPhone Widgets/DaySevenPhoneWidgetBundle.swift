import WidgetKit
import SwiftUI

@main
struct DaySevenPhoneWidgetBundle: WidgetBundle {
    var body: some Widget {
        DaySevenProgressWidget()
        if #available(iOS 16.1, *) {
            WorkoutLiveActivityWidget()
        }
    }
}
