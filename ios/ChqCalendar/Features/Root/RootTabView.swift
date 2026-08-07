import CoreSpotlight
import SwiftUI

/// The app's three top-level destinations (task 16, #181/#182).
/// `nonisolated` (like `DeepLink`) so `DeepLinkTabRoute` below can carry a
/// value without dragging main-actor isolation into pure routing logic.
nonisolated enum AppTab: Hashable, Sendable {
    case events
    case myDay
    case map
}

/// The pure "where does this deep link land in the tab shell" decision,
/// split out of `RootTabView` so it's testable without a SwiftUI scene.
///
/// Two-phase consumption contract (see `AppModel.pendingDeepLink`):
/// - `.event` is **not** consumed by the tab switch — `CalendarView` owns
///   resolving it against the snapshot, which may not have loaded yet, so
///   the link must stay pending after `RootTabView` selects the Events tab.
/// - `.myDay` and `.map` **are** consumed by the tab switch itself: the tab
///   selection is the whole navigation. A `.map` link's optional venue
///   outlives the link as `AppModel.mapFocusVenue`, which `GroundsMapView`
///   (task 18) reads and clears.
nonisolated struct DeepLinkTabRoute: Equatable, Sendable {
    /// The tab the link lands on.
    let tab: AppTab

    /// Whether selecting `tab` fully consumes the link (clears
    /// `pendingDeepLink`). `false` only for `.event` — see above.
    let consumesLink: Bool

    /// For a consumed `.map` link, the venue focus to hand `AppModel`
    /// (`nil` for a plain `chqcal://map`, which also *clears* any stale
    /// focus from an earlier venue link). Always `nil` for non-map links,
    /// which must not touch `AppModel.mapFocusVenue` at all.
    let mapFocusVenue: String?

    static func resolve(_ link: DeepLink) -> DeepLinkTabRoute {
        switch link {
        case .event:
            return DeepLinkTabRoute(tab: .events, consumesLink: false, mapFocusVenue: nil)
        case .myDay:
            return DeepLinkTabRoute(tab: .myDay, consumesLink: true, mapFocusVenue: nil)
        case .map(let venue):
            return DeepLinkTabRoute(tab: .map, consumesLink: true, mapFocusVenue: venue)
        }
    }
}

/// The app's root view (task 16): an Events / My Day / Map tab shell around
/// what used to be the root `CalendarView`.
///
/// Owns everything that must exist exactly once per scene, regardless of
/// which tab is showing — all of it relocated verbatim from `CalendarView`:
/// - `.onOpenURL` and `.onContinueUserActivity(CSSearchableItemActionType)`
///   feed `model.pendingDeepLink`, same as before.
/// - `scenePhase` activation: `model.foregrounded()` plus
///   `PendingIntentLink.consume` (the App-Intent handoff). Living here —
///   above the `TabView` rather than inside any tab — is what keeps
///   `foregrounded()` firing exactly once per activation; `CalendarView`'s
///   copy was removed in the same change (a tab's view can disappear/
///   reappear on tab switches, which would have made it a double- or
///   zero-fire owner).
/// - Tab-level deep-link routing via `DeepLinkTabRoute` above.
struct RootTabView: View {
    @Bindable var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab: AppTab = .events

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Events", systemImage: "calendar", value: AppTab.events) {
                CalendarView(model: model)
            }
            Tab("My Day", systemImage: "star.circle", value: AppTab.myDay) {
                MyDayView(model: model, switchToEvents: { selectedTab = .events })
            }
            Tab("Map", systemImage: "map", value: AppTab.map) {
                GroundsMapView(model: model, switchToEvents: { selectedTab = .events })
            }
        }
        .onOpenURL { url in
            if let link = DeepLink.parse(url) {
                model.pendingDeepLink = link
            }
        }
        // Tapping a Spotlight search result for one of `SpotlightIndexer`'s
        // indexed events (#180, task 13) hands the app a
        // `CSSearchableItemActionType` user activity carrying the tapped
        // item's `CSSearchableItemActivityIdentifier` — this app's own
        // `"event-<id>"` `uniqueIdentifier` — in `userInfo`. Folds into the
        // same `pendingDeepLink` pipeline every other launch surface
        // (`.onOpenURL`, a notification tap, a widget's `widgetURL`, an App
        // Intent) already feeds.
        .onContinueUserActivity(CSSearchableItemActionType) { activity in
            guard let identifier = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String,
                  let eventID = SpotlightIndexer.eventID(fromActivityIdentifier: identifier)
            else { return }
            model.pendingDeepLink = .event(id: eventID)
        }
        .onChange(of: model.pendingDeepLink) { _, _ in routePendingLinkIfNeeded() }
        // Covers a link that arrived before this view's `body` was first
        // evaluated — e.g. `NotificationDelegate.onOpenEvent` setting
        // `pendingDeepLink` during a notification-tap cold launch, before
        // there was an `onChange` observer to notice.
        .task { routePendingLinkIfNeeded() }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                Task { await model.foregrounded() }
                // An App Intent (task 12) can run with no `AppModel` in
                // scope at all — Shortcuts may launch `OpenEventIntent`
                // with the app not running — so it hands its target event
                // off via `PendingIntentLink`'s App Group `UserDefaults`
                // key instead of setting `pendingDeepLink` directly. This
                // is the other half of that handoff: on every return to
                // `.active` (covering both "intent launched the app" and
                // "intent ran while the app was already suspended in the
                // background"), check for a pending link and fold it into
                // the same `pendingDeepLink` pipeline `.onOpenURL` and a
                // notification tap already use. Harmless — and cheap — when
                // nothing is pending.
                //
                // Accepted limitation (inherited from `CalendarView`, task
                // 12): this only fires on a transition INTO `.active`. An
                // intent that runs while the app is already foreground-
                // active (e.g. a Siri overlay presented on top of the
                // running app, with no backgrounding in between) writes the
                // key but nothing re-reads it until the next `scenePhase`
                // cycle — so the link sits unconsumed until the app is
                // backgrounded and reactivated.
                if let link = PendingIntentLink.consume(from: AppGroup.userDefaults()) {
                    model.pendingDeepLink = link
                }
            }
        }
    }

    /// Applies `DeepLinkTabRoute` to whatever is pending: switches tabs for
    /// every link kind, consumes `.myDay`/`.map` (handing a `.map` venue off
    /// to `model.mapFocusVenue` for task 18's `GroundsMapView`), and leaves
    /// `.event` pending for `CalendarView`'s snapshot-aware resolution.
    private func routePendingLinkIfNeeded() {
        guard let link = model.pendingDeepLink else { return }
        let route = DeepLinkTabRoute.resolve(link)
        selectedTab = route.tab
        if route.consumesLink {
            if route.tab == .map {
                model.mapFocusVenue = route.mapFocusVenue
            }
            model.pendingDeepLink = nil
        }
    }
}
