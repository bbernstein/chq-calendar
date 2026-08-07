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

    /// Compact-mode-only: bound to `stackView`'s `NavigationStack`. Used by
    /// `-uitest-select-linked-event` (DEBUG only, see `applyUITestHooks`
    /// below) to push a detail view programmatically, and by pending
    /// deep-link consumption (`consumePendingDeepLinkIfPossible`, all
    /// configurations) to push the linked event's detail view.
    @State private var path = NavigationPath()

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
        // The other half of that binding. `clearAll()`, `clearNonDateFilters()`
        // and `remove(.search)` all write `filter.searchText = ""` without
        // going through the field, so without this the field keeps showing a
        // term the model no longer has — and the next keystroke commits the
        // stale draft, silently reapplying a filter the user just removed.
        // (Before this branch, `clearFilters()` preserved `searchText`, so
        // the two could not disagree.)
        //
        // The inequality guard is what keeps this from fighting the debounce
        // above: the write the debounce makes is already equal, so it does
        // not bounce back through here.
        .onChange(of: model.filter.searchText) { _, committed in
            if committed != searchDraft { searchDraft = committed }
        }
        .task {
            await model.start()
            // Covers the case where a deep link arrived (setting
            // `pendingDeepLink`) before this `.task` ran, and `start()`
            // resolved a cached snapshot synchronously without the
            // `onChange(of: model.phase)` above having anything to fire on
            // in between — e.g. `phase` was already `.launching` and never
            // changes if a cached snapshot loads directly into `.ready`.
            consumePendingDeepLinkIfPossible()
            #if DEBUG
            await applyUITestHooks()
            #endif
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                Task { await model.foregrounded() }
            }
        }
        .onOpenURL { url in
            if let link = DeepLink.parse(url) {
                model.pendingDeepLink = link
            }
        }
        // The link can arrive before the snapshot finishes loading (a cold
        // launch via `chqcal://event/…`) or after (a warm launch, or a
        // notification tap while the app's already running) — so
        // consumption is driven by both the link itself changing and the
        // snapshot's load state changing, whichever comes second.
        .onChange(of: model.pendingDeepLink) { _, _ in consumePendingDeepLinkIfPossible() }
        .onChange(of: model.phase) { _, _ in consumePendingDeepLinkIfPossible() }
    }

    /// Routes a pending `.event(id:)` deep link once the target event is
    /// resolvable, then clears it. Does nothing (and does not clear) for
    /// `.myDay`/`.map` — those stay pending until the tab shell (task 16)
    /// exists to consume them. If the snapshot hasn't loaded yet, the link
    /// stays pending for the next call; once a snapshot exists, an unknown
    /// id is cleared rather than left dangling forever.
    private func consumePendingDeepLinkIfPossible() {
        guard case .event(let id) = model.pendingDeepLink else { return }
        guard let snapshot = model.snapshot else { return }

        guard let event = snapshot.events.first(where: { $0.id == id }) else {
            model.pendingDeepLink = nil
            return
        }

        if horizontalSizeClass == .regular {
            selectedEvent = event
        } else {
            path.append(event)
        }
        model.pendingDeepLink = nil
    }

    private var stackView: some View {
        NavigationStack(path: $path) {
            EventListView(model: model, selection: nil)
        }
        .searchable(text: $searchDraft, prompt: "Search events")
        .submitLabel(.search)
        .onSubmit(of: .search) { KeyboardDismisser.dismiss() }
    }

    private var splitView: some View {
        NavigationSplitView {
            EventListView(model: model, selection: $selectedEvent)
                .searchable(text: $searchDraft, prompt: "Search events")
                .submitLabel(.search)
                .onSubmit(of: .search) { KeyboardDismisser.dismiss() }
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
    ///
    /// `async` for one reason: on a simulator with no on-disk cache yet (a
    /// freshly-erased capture run's very first launch), `model.start()`'s
    /// article-links sidecar fetch races a short, best-effort timeout
    /// (`EventRepository`'s `sidecarTimeout`, 3s in production) against a
    /// genuinely cold network path — no DNS/TLS session to reuse the way a
    /// same-process relaunch would have. Losing that race is silent by
    /// design (sidecars degrade to "no links" rather than blocking the
    /// whole snapshot), so `uiTestFirstLinkedEvent` can come back `nil` on
    /// that first launch even though real linked events exist and the very
    /// next launch finds them fine. Observed directly capturing screenshots:
    /// identical launches of the same build, back to back, differed only in
    /// whether this raced. The retry below forces one more full refresh
    /// before giving up, which is enough to clear it in practice.
    private func applyUITestHooks() async {
        let arguments = ProcessInfo.processInfo.arguments

        if arguments.contains("-uitest-show-filters") {
            model.uiTestShowFilters = true
        }

        if arguments.contains("-uitest-show-week-theme") {
            model.uiTestShowWeekTheme = true
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

        // `-uitest-select-event-index <n>` reads the argument that follows
        // it — same shape as `-uitest-search <term>` above — and selects the
        // nth-richest linked event (0-based) instead of always the richest.
        // It shares `AppModel.uiTestLinkedEvents`, the cold-launch retry and
        // the selection plumbing below with `-uitest-select-linked-event`,
        // which is just index 0; this is one mechanism with a parameter, not
        // a second one.
        //
        // It exists because on iPad both split-view columns are always
        // visible, so `01-season` (which only wants a populated detail
        // column so the shot isn't two-thirds empty) and `04-detail` were
        // selecting the same event and capturing byte-identical images.
        // A non-numeric value is ignored, leaving `requestedIndex` nil and
        // the shot behaving as if the flag were absent.
        var requestedIndex: Int?
        if let flagIndex = arguments.firstIndex(of: "-uitest-select-event-index"),
           arguments.index(after: flagIndex) < arguments.endIndex {
            requestedIndex = Int(arguments[arguments.index(after: flagIndex)])
        }

        let wantsLinkedEvent = arguments.contains("-uitest-select-linked-event")
            || arguments.contains("-uitest-show-add-to-calendar")
            || requestedIndex != nil
        guard wantsLinkedEvent else { return }

        if model.uiTestFirstLinkedEvent == nil {
            // See the doc comment above: this is the cold-launch sidecar
            // race, not "no linked events exist" — force one more full
            // refresh (bypassing the just-fetched-so-skip-it fast path)
            // before concluding there's really nothing to select.
            await model.refresh(force: true)
        }
        guard let event = model.uiTestLinkedEvent(at: requestedIndex ?? 0) else { return }

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
