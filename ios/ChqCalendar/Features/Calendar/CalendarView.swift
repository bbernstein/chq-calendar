import SwiftUI

/// The Events tab's screen (the app's root screen until the tab shell,
/// `RootTabView`, wrapped it in task 16). Picks between two navigation
/// containers based on horizontal size class — both wrap the same
/// `EventListView` (see that file for the day-grouped list, filter bar,
/// search, and empty/offline states shared between the two):
/// - Compact (iPhone): a single-column `NavigationStack` where tapping an
///   event pushes `EventDetailView`.
/// - Regular (iPad): a two-column `NavigationSplitView` — the sidebar is
///   `EventListView` in selection mode, the detail column shows the
///   selected event's `EventDetailView` (or a placeholder when nothing's
///   selected yet), in its own `NavigationStack` so `EventDetailView`'s
///   toolbar renders even though nothing was pushed onto it.
struct CalendarView: View {
    @Bindable var model: AppModel
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
        // Scene-level concerns — `.onOpenURL`, Spotlight's
        // `.onContinueUserActivity`, and `scenePhase` activation
        // (`foregrounded()` + `PendingIntentLink.consume`) — moved to
        // `RootTabView` in task 16: they must exist exactly once per scene,
        // and a tab's content view is no longer a safe owner (it can
        // disappear/reappear as tabs switch).
        //
        // The link can arrive before the snapshot finishes loading (a cold
        // launch via `chqcal://event/…`) or after (a warm launch, or a
        // notification tap while the app's already running) — so
        // consumption is driven by every signal that could change the
        // answer: the link itself, `phase`, whether a refresh is in flight,
        // and the snapshot's own identity (`fetchedAt`). That last one
        // matters because a warm launch's stale cached snapshot sets
        // `phase = .ready` immediately, then a background `refresh()`
        // replaces `snapshot` with fresh data while `phase` never changes
        // again — so `phase` alone would miss that transition entirely. See
        // `AppModel.resolvePendingEventDeepLinkIfPossible` for the full
        // rationale, including why an in-flight refresh must not let an
        // unknown id be cleared out from under it.
        .onChange(of: model.pendingDeepLink) { _, _ in consumePendingDeepLinkIfPossible() }
        .onChange(of: model.phase) { _, _ in consumePendingDeepLinkIfPossible() }
        .onChange(of: model.isRefreshing) { _, _ in consumePendingDeepLinkIfPossible() }
        .onChange(of: model.snapshot?.fetchedAt) { _, _ in consumePendingDeepLinkIfPossible() }
    }

    /// Routes a pending `.event(id:)` deep link once
    /// `AppModel.resolvePendingEventDeepLinkIfPossible()` can resolve it —
    /// the model owns the "is it found / is it confirmed unknown / is it
    /// still too soon to tell" decision (including the refresh-in-flight
    /// guard against clearing a link a still-running refresh might yet
    /// satisfy); this just pushes the resolved event onto the right
    /// navigation surface. Does nothing for `.myDay`/`.map` — `RootTabView`
    /// consumes those at the tab level before this view ever sees them — and
    /// nothing for `.day`, the other link the tab switch deliberately leaves
    /// pending: `EventListView` consumes that one on its own `body`, through
    /// `resolvePendingDayDeepLinkIfPossible`.
    private func consumePendingDeepLinkIfPossible() {
        guard let event = model.resolvePendingEventDeepLinkIfPossible() else { return }
        route(to: event)
    }

    /// Pushes `event` onto whichever navigation surface is active for the
    /// current size class — shared by deep-link consumption above and the
    /// DEBUG-only UI-test hooks below, which both need the exact same
    /// compact-vs-regular routing decision.
    private func route(to event: Event) {
        if horizontalSizeClass == .regular {
            selectedEvent = event
        } else {
            path.append(event)
        }
    }

    // `placement: .navigationBarDrawer(displayMode: .always)` on both
    // containers below is load-bearing on iOS 26 inside the tab shell
    // (task 16). The default placement there is a bottom-anchored field,
    // which occupies the same screen edge as `RootTabView`'s tab bar —
    // verified by screenshot: the tab bar rendered ON TOP of the bottom
    // toolbar group (date pill, Filters, search all present but covered
    // and unusable). Pinning search under the navigation bar vacates the
    // bottom edge; `EventListView` drops its
    // `DefaultToolbarItem(kind: .search)` in the same change (that item
    // existed only to re-surface the bottom-anchored field next to the
    // date/filter pills — see its old comment there). `.always` rather
    // than `.automatic` so search stays discoverable without knowing the
    // pull-down gesture. On iOS 18 this placement is where the field
    // rendered anyway; the explicit `displayMode` is the only behavior
    // change there (visible without scrolling).
    private var stackView: some View {
        NavigationStack(path: $path) {
            EventListView(model: model, selection: nil)
        }
        .searchable(
            text: $searchDraft,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "Search events")
        .submitLabel(.search)
        .onSubmit(of: .search) { KeyboardDismisser.dismiss() }
    }

    private var splitView: some View {
        NavigationSplitView {
            EventListView(model: model, selection: $selectedEvent)
                .searchable(
                    text: $searchDraft,
                    placement: .navigationBarDrawer(displayMode: .always),
                    prompt: "Search events")
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

        // Any `-uitest-*` launch is a screenshot/automation context, so a
        // real system permission dialog is never wanted here — suppress the
        // one-time reminder-authorization ask unconditionally, before any
        // hook below gets a chance to favorite something. Without this,
        // `-uitest-seed-favorites` and `-uitest-star-selected-event` (both
        // below) call `model.toggleFavorite`, which fires
        // `requestReminderAuthorizationIfNeeded()` — and the shipped default
        // preset is `.thirtyMinutesBefore`, not `.none`, so on a
        // freshly-erased simulator (`.notDetermined`, exactly the state
        // `capture-screenshots.sh` starts every run from) that spawns a real
        // notification-permission dialog. Per that script's own comments,
        // such a dialog "survives `simctl terminate` + `simctl launch`," so
        // it would poison every screenshot captured for the rest of the run,
        // not just the one that triggered it.
        model.uitestSuppressReminderAuthorizationPrompt()

        if arguments.contains("-uitest-show-filters") {
            model.uiTestShowFilters = true
        }

        if arguments.contains("-uitest-show-week-theme") {
            model.uiTestShowWeekTheme = true
        }

        // `-uitest-delay-pending-scroll` — see `AppModel.uiTestPendingScrollDelay`
        // for why a UI test needs this to exercise the day rail's pending-
        // scroll staleness check at all. 3 seconds is comfortably longer
        // than opening the date sheet and tapping a scope chip takes.
        if arguments.contains("-uitest-delay-pending-scroll") {
            model.uiTestPendingScrollDelay = 3
        }

        // `-uitest-drop-scrolls <n>` — see `AppModel.uiTestScrollsToDrop` for
        // why a UI test needs to be able to make a `scrollTo` do nothing.
        if let flagIndex = arguments.firstIndex(of: "-uitest-drop-scrolls"),
           arguments.index(after: flagIndex) < arguments.endIndex,
           let count = Int(arguments[arguments.index(after: flagIndex)]), count > 0 {
            model.uiTestScrollsToDrop = count
        }

        if arguments.contains("-uitest-show-about") {
            model.uiTestShowAbout = true
        }

        // `-uitest-seed-favorites id1,id2,id3` favorites each comma-separated
        // event id (skipping any already favorited) so a My Day screenshot
        // (#181) can show a populated plan — including a deliberately
        // overlapping/tight pair — without depending on `xcrun simctl`
        // synthesizing a star tap on each individual row.
        if let flagIndex = arguments.firstIndex(of: "-uitest-seed-favorites"),
           arguments.index(after: flagIndex) < arguments.endIndex {
            let ids = arguments[arguments.index(after: flagIndex)].split(separator: ",").map(String.init)
            for id in ids where !model.favorites.contains(id) {
                model.toggleFavorite(id)
            }
        }

        // `-uitest-tab <events|my-day|map>` lands the app on the named root
        // tab by feeding `model.pendingDeepLink` — the exact pipeline every
        // real tab-switching surface (URL, widget, notification, Spotlight,
        // App Intent) already goes through, so `RootTabView`'s
        // `.onChange(of: model.pendingDeepLink)` routing performs the switch
        // and consumes the link. Runs after `-uitest-seed-favorites` above so
        // a My Day screenshot launch can seed its plan and then land on the
        // tab that displays it. "events" (the default tab) and unknown
        // values are deliberate no-ops.
        if let flagIndex = arguments.firstIndex(of: "-uitest-tab"),
           arguments.index(after: flagIndex) < arguments.endIndex {
            switch arguments[arguments.index(after: flagIndex)] {
            case "my-day":
                model.pendingDeepLink = .myDay
            case "map":
                model.pendingDeepLink = .map(venue: nil)
            default:
                break
            }
        }

        // `-uitest-go-to-day <yyyy-MM-dd>` lands the Events list on a named
        // day by feeding `model.pendingDeepLink` — the same channel
        // `OpenDayIntent` writes through `PendingIntentLink`. Going through
        // the link rather than calling `model.goToDay` directly is the point:
        // the screenshot and the UI test then cover the real pipeline, not a
        // shortcut around it. A non-canonical key is ignored (the link is
        // never constructed), leaving the launch behaving as if the flag were
        // absent.
        //
        // `uiTestDayKey` is captured alongside so `-uitest-select-event-index`
        // below can scope its selection pool to this day (see that flag's
        // comment) — must be declared before that block runs, and it is: this
        // block is handled first.
        var uiTestDayKey: String?
        if let flagIndex = arguments.firstIndex(of: "-uitest-go-to-day"),
           arguments.index(after: flagIndex) < arguments.endIndex {
            let key = arguments[arguments.index(after: flagIndex)]
            if ChqTime.isCanonicalDayKey(key) {
                model.pendingDeepLink = .day(key: key)
                uiTestDayKey = key
            }
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

        if model.uiTestLinkedEvent(at: 0, dayKey: uiTestDayKey) == nil {
            // See the doc comment above: this is the cold-launch sidecar
            // race, not "no linked events exist" — force one more full
            // refresh (bypassing the just-fetched-so-skip-it fast path)
            // before concluding there's really nothing to select. Testing
            // the day-scoped pool (when `uiTestDayKey` is set) rather than
            // the season-wide `uiTestFirstLinkedEvent` matters: the
            // season-wide pool can be non-empty while the day-scoped one
            // is empty only because the sidecar hasn't loaded yet, and the
            // season-wide check would skip the retry and leave the detail
            // column on its placeholder instead of picking up the
            // day-scoped event once the sidecar lands.
            await model.refresh(force: true)
        }
        // `uiTestDayKey` (non-nil only when `-uitest-go-to-day` landed on a
        // canonical day above, in the *same* launch) scopes the selection
        // pool to that day. Without this, `01-season` on iPad picked the
        // season-wide richest linked event independent of `-uitest-go-to-day`
        // — the rail could land on one day while the detail column showed an
        // event from another, contradicting a caption that now promises "jump
        // to any day" (#255). `nil` reproduces the exact season-wide behavior
        // every other caller relies on — `09-reminder`'s
        // `-uitest-select-event-index 2` carries no day flag and must not
        // shift. Out of range inside the scoped-to-that-day pool is a no-op
        // (nil), the same as the season-wide case: it leaves the detail
        // column on its placeholder, visible in review, rather than silently
        // falling back to a season-wide (and therefore possibly
        // wrong-day) pick.
        guard let event = model.uiTestLinkedEvent(at: requestedIndex ?? 0, dayKey: uiTestDayKey) else { return }
        route(to: event)

        if arguments.contains("-uitest-show-add-to-calendar") {
            model.uiTestShowAddToCalendar = true
        }

        // `-uitest-star-selected-event` favorites the just-selected event so
        // `EventDetailView`'s "Remind me" row (#178) has something to render
        // against for a screenshot — like the other hooks here, this exists
        // because `xcrun simctl` can't synthesize the star-button tap a real
        // verification pass would use.
        if arguments.contains("-uitest-star-selected-event"), !model.favorites.contains(event.id) {
            model.toggleFavorite(event.id)
        }
    }
    #endif
}
