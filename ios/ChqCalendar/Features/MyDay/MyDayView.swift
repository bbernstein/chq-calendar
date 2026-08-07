import SwiftUI

/// Placeholder for the My Day tab (task 16 shell). Task 17 replaces this
/// body with the real day-plan UI built on `DayPlan` (#181), keeping the
/// signature below — `RootTabView` already constructs it with both
/// arguments:
/// - `model`: the shared `AppModel` (favorites, snapshot, day plan inputs).
/// - `switchToEvents`: switches the tab shell to the Events tab — the
///   empty-state escape hatch ("no favorites yet → go browse events").
struct MyDayView: View {
    @Bindable var model: AppModel
    var switchToEvents: () -> Void = {}

    var body: some View {
        ContentUnavailableView(
            "My Day",
            systemImage: "star.circle",
            description: Text("Coming in this version."))
    }
}
