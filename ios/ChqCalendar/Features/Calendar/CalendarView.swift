import SwiftUI

/// The app's root screen. Picks between two navigation containers based on
/// horizontal size class — both wrap the same `EventListView` (see that
/// file for the day-grouped list, filter bar, search, and empty/offline
/// states shared between the two):
/// - Compact (iPhone): a single-column `NavigationStack` where tapping an
///   event pushes `EventDetailView`.
/// - Regular (iPad): a two-column `NavigationSplitView` — the sidebar is
///   `EventListView` in selection mode, the detail column shows the
///   selected event's `EventDetailView` (or a placeholder when nothing's
///   selected yet), in its own `NavigationStack` so `EventDetailView`'s
///   toolbar renders even though nothing was pushed onto it.
struct CalendarView: View {
    @Bindable var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    /// `.searchable` is bound to this local draft rather than directly to
    /// `model.filter.searchText`, so keystrokes don't re-run the filter
    /// pipeline on every character. `.task(id:)` below debounces 200 ms
    /// before committing the draft into the model.
    @State private var searchDraft: String = ""

    /// iPad-only: the event shown in the split view's detail column.
    /// Unused (and un-navigated) in compact mode, where `EventListView`
    /// pushes via `NavigationLink` instead.
    @State private var selectedEvent: Event?

    var body: some View {
        Group {
            if horizontalSizeClass == .regular {
                splitView
            } else {
                stackView
            }
        }
        .task(id: searchDraft) {
            try? await Task.sleep(for: .milliseconds(200))
            guard !Task.isCancelled else { return }
            model.filter.searchText = searchDraft
        }
        .task {
            await model.start()
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                Task { await model.foregrounded() }
            }
        }
    }

    private var stackView: some View {
        NavigationStack {
            EventListView(model: model, selection: nil)
        }
        .searchable(text: $searchDraft, prompt: "Search events")
    }

    private var splitView: some View {
        NavigationSplitView {
            EventListView(model: model, selection: $selectedEvent)
                .searchable(text: $searchDraft, prompt: "Search events")
        } detail: {
            NavigationStack {
                if let selectedEvent {
                    EventDetailView(event: selectedEvent, model: model)
                } else {
                    ContentUnavailableView("Select an event", systemImage: "calendar")
                }
            }
        }
    }
}
