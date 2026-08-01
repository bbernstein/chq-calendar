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

    #if DEBUG
    /// Compact-mode-only: bound to `stackView`'s `NavigationStack` so
    /// `-uitest-select-linked-event` can push a detail view programmatically
    /// (see `applyUITestHooks` below). Unused in Release builds, where the
    /// stack manages its own internal path as before.
    @State private var path = NavigationPath()
    #endif

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
            #if DEBUG
            applyUITestHooks()
            #endif
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                Task { await model.foregrounded() }
            }
        }
    }

    private var stackView: some View {
        #if DEBUG
        NavigationStack(path: $path) {
            EventListView(model: model, selection: nil)
        }
        .searchable(text: $searchDraft, prompt: "Search events")
        #else
        NavigationStack {
            EventListView(model: model, selection: nil)
        }
        .searchable(text: $searchDraft, prompt: "Search events")
        #endif
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

    #if DEBUG
    // MARK: UI-test hooks (DEBUG only)

    /// Honors `ProcessInfo.processInfo.arguments` after `model.start()`
    /// reaches a settled phase, to make interactive states reachable for
    /// screenshot-based verification — `xcrun simctl` can't synthesize taps.
    /// This whole method (and its call site above) compiles out of Release
    /// builds.
    private func applyUITestHooks() {
        let arguments = ProcessInfo.processInfo.arguments

        if arguments.contains("-uitest-show-filters") {
            model.uiTestShowFilters = true
        }

        // `-uitest-search <term>` reads the argument that follows it and
        // commits it straight to `model.filter.searchText`. `searchDraft` is
        // set too so the visible search field shows the term, but the
        // committed value is written directly rather than left to the
        // `.task(id: searchDraft)` debounce above — waiting on that debounce
        // would race the screenshot script's fixed settle delay.
        if let flagIndex = arguments.firstIndex(of: "-uitest-search"),
           arguments.index(after: flagIndex) < arguments.endIndex {
            let term = arguments[arguments.index(after: flagIndex)]
            searchDraft = term
            model.filter.searchText = term
        }

        let wantsLinkedEvent = arguments.contains("-uitest-select-linked-event")
            || arguments.contains("-uitest-show-add-to-calendar")
        guard wantsLinkedEvent, let event = model.uiTestFirstLinkedEvent else { return }

        if horizontalSizeClass == .regular {
            selectedEvent = event
        } else {
            path.append(event)
        }

        if arguments.contains("-uitest-show-add-to-calendar") {
            model.uiTestShowAddToCalendar = true
        }
    }
    #endif
}
