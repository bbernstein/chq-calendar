import SwiftUI

/// Placeholder for the Map tab (task 16 shell). Task 18 replaces this body
/// with the real grounds map built on `VenueAtlas` (#182), keeping the
/// signature below — `RootTabView` already constructs it with `model`.
///
/// Deep-link contract for task 18: a `chqcal://map/<venue>` link has
/// already been consumed by `RootTabView` by the time this tab is showing;
/// the requested venue (if any) is waiting in `model.mapFocusVenue`. The
/// real map view should read it, focus/select that venue, and clear it back
/// to `nil` once acted on. A plain `chqcal://map` link sets it to `nil`.
struct GroundsMapView: View {
    @Bindable var model: AppModel

    var body: some View {
        ContentUnavailableView(
            "Map",
            systemImage: "map",
            description: Text("Coming in this version."))
    }
}
