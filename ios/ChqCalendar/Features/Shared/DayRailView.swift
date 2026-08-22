import SwiftUI
import UIKit

/// Opaque background for the rail's chips and both end controls.
///
/// Replaces `.thinMaterial` everywhere on the rail (accessibility follow-up
/// to #245): the rail sits over the scrolling event list, so a translucent
/// background's effective contrast varies with whatever list content
/// happens to be behind it at the moment an on-device audit samples it —
/// `performAccessibilityAudit` failed contrast even on non-empty chips,
/// whose only fault was being drawn over the wrong content at that instant.
/// An opaque system colour makes contrast a fixed, testable property
/// instead of a function of scroll position. `secondarySystemBackground`
/// reads as a layer above the rail's own `.bar` background (`EventListView.
/// dayRail`) rather than blending into it, and adapts to light/dark
/// automatically, same as the material it replaces.
extension Color {
    /// Named asset (`DayChipBackground.colorset`), not
    /// `Color(.secondarySystemBackground)`: an on-device audit reported
    /// "Contrast failed" on ordinary chip text over the latter despite
    /// visually — and, sampled from a real screenshot, numerically —
    /// clearing 16:1, while the selected chip's asset-catalog
    /// `DayChipSelected` fill audited clean at a lower margin. The values
    /// are the same pixels either way (`#F2F2F7` light / `#1C1C1E` dark,
    /// `UIColor.secondarySystemBackground`'s own constants) — only the
    /// route SwiftUI resolves them through changed, which is what the
    /// audit's own contrast check turned out to be sensitive to for
    /// UIKit-bridged dynamic colours inside a custom `Button` label.
    static var dayRailControlBackground: Color {
        Color("DayChipBackground")
    }
}

/// A horizontal strip of day chips with an optional control at each end.
///
/// Extracted from My Day (#192), which had it first, so the Events tab's day
/// rail is the same surface rather than a lookalike. The two screens differ
/// only in what the chips count (`DayChipCountStyle`), what sits at the ends,
/// and whether a week band runs above them. My Day keeps its chevrons, which
/// reveal the rest of the season; the Events rail dropped its own one-day step
/// chevrons in #256 to buy chip space, and reaches a distant week through the
/// band instead (empty-day stepping survives there as a VoiceOver rotor
/// action — see `EventListView.dayRail`).
///
/// **Scroll-to-selection lives here**, because getting it wrong is invisible
/// until a real device: expanding an end prepends or appends chips, which
/// shifts the content under the reader, and re-anchoring on the same day is
/// what holds the selection still so that revealing the past never moves you.
struct DayRailView<Leading: View, Trailing: View>: View {
    let entries: [MyDayChipContent.Entry]

    /// The week band above the chips: one segment per chip, in the same
    /// order as `entries` (#256). Empty — the default — renders no band at
    /// all, which is what My Day passes: it has no season weeks to show, so
    /// its call site needs no change.
    ///
    /// Same-length-and-same-order-as-`entries` is the caller's contract, and
    /// `EventListView` honours it by building both from one `railDayKeys`
    /// array rather than two calls that happen to agree.
    /// `resolvedSegment(at:day:)` still re-checks each segment's own
    /// `dayKey` against the chip it is about to sit over: a silent one-chip
    /// offset would read as the whole band being shifted by a day, which is
    /// exactly the class of defect a band is worst at making visible.
    var bandSegments: [WeekBandSegment] = []

    /// Tapping a band segment navigates to that week. `nil` — the default —
    /// leaves the band decorative, which is what My Day passes: it has no
    /// week band at all.
    var onSelectWeek: ((Int) -> Void)? = nil

    /// Which weeks a band tap can actually reach, and what VoiceOver reads
    /// for each — `WeekBands.destinations(...)`, computed by the screen that
    /// knows the filter.
    ///
    /// A week **absent** from a non-nil map is unreachable: its fill dims and
    /// its tap does not fire, mirroring the empty chips beneath it
    /// (`disablesEmptyDays: true`) rather than looking ordinary and silently
    /// refusing. `nil` — the default — means the caller has no reachability
    /// to offer, and every band stays a plain, tappable `Week n`.
    var weekDestinations: [Int: WeekBandDestination]? = nil

    let selectedDay: String?
    /// Names the strip as a whole for VoiceOver. A group of links or buttons
    /// needs a group role and a label; a bare container's label is dropped
    /// (the lesson from the web header menu, PR #228/#219).
    let accessibilityLabel: String

    /// My Day's empty chips stay tappable — selecting an empty day is how the
    /// reader reaches its "Browse …" action (#192). The Events rail's do not:
    /// there is no section to land on. Same chip, two answers, so the screen
    /// decides rather than the chip.
    var disablesEmptyDays: Bool = false

    let onSelect: (String) -> Void
    @ViewBuilder let leading: () -> Leading
    @ViewBuilder let trailing: () -> Trailing

    /// Extra values that must re-anchor the strip when they change — the
    /// expand toggles on My Day. Passed as an opaque list rather than the
    /// booleans themselves so the Events rail, which has no such toggles,
    /// does not have to invent them.
    var reanchorOn: [AnyHashable] = []

    /// True while a finger is actively dragging the strip itself (SwiftUI's
    /// `.tracking`/`.interacting` scroll phases — `.decelerating` and
    /// `.animating` do not count, since those cover momentum after the
    /// finger lifts and our *own* programmatic `scrollTo`, neither of which
    /// is a reader fighting the rail).
    ///
    /// Once `selectedDay` tracked scroll (task 10), it can change many times
    /// a second while the reader scrolls the list — re-centering on every
    /// one of those changes would fight a reader who has, at the same
    /// moment, grabbed the rail to drag it themselves (e.g. mid-fling
    /// momentum from the list while reaching for a distant chip).
    ///
    /// **Not a `DragGesture`.** A `simultaneousGesture(DragGesture(...))`
    /// was tried first and reverted: even non-exclusive, adding a second
    /// recognizer changed the touch-arbitration timing enough that
    /// `DayRailUITests`' synthetic `press(forDuration:thenDragTo:)` drags
    /// stopped moving the horizontal `ScrollView` at all (confirmed by
    /// three tests failing — `testADistantChipTapLandsOnThatDay`,
    /// `testChangingScopeAfterADistantTapDoesNotLaterHijackTheList`,
    /// `testMyDaysEmptyChipIsTappable` — all via `revealByScrolling`, all
    /// with the same "chip frame never moved" signature). `onScrollPhaseChange`
    /// (iOS 18) reads the `ScrollView`'s own native phase instead of adding
    /// a competing recognizer, so nothing about its gesture handling
    /// changes.
    @State private var isDragging = false

    /// The day, and the `reanchorOn` value, that `scroll(_:to:)` last
    /// actually centered under. Distinct from `selectedDay`/`reanchorOn`
    /// themselves so the drag-end catch-up below can tell "what the rail
    /// should show has diverged from what it's actually centered on" from
    /// "the reader was just dragging and nothing net changed" — only the
    /// first must re-sync.
    ///
    /// **Why a value comparison, not a "something changed while dragging"
    /// flag.** A flag set by `onChange` and cleared on drag-end was tried
    /// first: it over-triggers on a `selectedDay` value that changes away
    /// and back to the same thing *during* a single drag (found live —
    /// `testChangingScopeAfterADistantTapDoesNotLaterHijackTheList`, which
    /// opens a sheet immediately before `revealByScrolling`'s drag loop,
    /// started failing with the flag version: the sheet's presentation
    /// nudges the list's layout enough to blip `visibleDays` once while a
    /// drag is in flight, arming the flag on a change that had already
    /// self-corrected by the time dragging ended — and the catch-up then
    /// fired anyway, re-centering the rail back onto the untouched
    /// `selectedDay` and undoing the manual reveal). Comparing against what
    /// is actually centered doesn't have that failure mode: a value that
    /// blips and returns during a drag never differs from what was already
    /// centered before the drag started, so no catch-up fires for it.
    ///
    /// **Why not compare `selectedDay` alone (an even earlier version).**
    /// `reanchorOn` firing needs the identical catch-up but does *not*
    /// change `selectedDay` at all — My Day's expand toggle re-anchors the
    /// strip on the *same* day, whose chip has simply moved under a resize.
    /// Tracking both lets the same comparison serve both triggers.
    @State private var lastCentered: (day: String, reanchorOn: [AnyHashable])?

    /// `leading()`/`trailing()` are fixed furniture at the rail's two ends —
    /// outside the horizontal `ScrollView` entirely — and only the chips
    /// scroll between them. Before this shape (#245), both were part of the
    /// same scrolling `HStack` as the chips: swiping the strip a few days
    /// along scrolled `⟳ Now` and both step chevrons away with it, leaving
    /// no way back to today except swiping back to find them. Pulling them
    /// out of the scrollable content is what keeps them reachable no matter
    /// how far the chips have scrolled.
    var body: some View {
        HStack(spacing: RailMetrics.chipGutter) {
            leading()
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    // The band and the chips are one `VStack` per day inside
                    // one `HStack` inside this single `ScrollView`, so they
                    // share one scroll offset and cannot desync, and each
                    // band segment is exactly its chip's width because the
                    // same stack lays both out. Alignment is structural, not
                    // something two parallel layouts agree on today and drift
                    // apart on tomorrow.
                    //
                    // The band's *painted run* is the one thing allowed out of
                    // that grid: within a week it bleeds half a gutter each
                    // way so the week reads as one continuous bar rather than
                    // seven identical bars with seven identical gaps. That is
                    // a `.background` with negative padding inside
                    // `WeekBandSegmentView` and changes no frame — segment
                    // width, tap target and accessibility frame all stay
                    // chip-width. Do not "tidy" the two back together.
                    HStack(spacing: RailMetrics.chipGutter) {
                        ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                            VStack(spacing: 2) {
                                // Not `Color.clear` for an absent band: a
                                // zero-segment rail is My Day, which has no
                                // season weeks to show, and an invisible
                                // 14pt strip there is not "no band" — it is
                                // a band's worth of dead space pushing the
                                // chips down. Inside the Events rail
                                // `bandSegments` is never empty, so an
                                // out-of-season *day* still gets its clear
                                // segment and stays aligned with its
                                // in-season neighbours.
                                if !bandSegments.isEmpty {
                                    WeekBandSegmentView(
                                        segment: resolvedSegment(at: index, day: entry.day),
                                        day: entry.day,
                                        // The *fill* bridges the gutter to a
                                        // neighbour in the same week; the
                                        // segment's own frame does not. See
                                        // `WeekBandRun.bridgesGutter(after:in:)`.
                                        bridgesLeading: WeekBandRun.bridgesGutter(
                                            after: index - 1, in: bandSegments),
                                        bridgesTrailing: WeekBandRun.bridgesGutter(
                                            after: index, in: bandSegments),
                                        onSelectWeek: onSelectWeek,
                                        weekDestinations: weekDestinations
                                    )
                                    // Capped here rather than on the label
                                    // alone so the band's own height
                                    // (`@ScaledMetric` inside) and the label
                                    // it has to hold are measured against the
                                    // *same* size. Capping only the label
                                    // left a 14pt strip with 28pt text
                                    // bleeding out of it above and below at
                                    // AX XXXL; capping only the height would
                                    // clip the label instead. Past
                                    // `.accessibility1` the band stops
                                    // growing, which keeps it from eating the
                                    // event list it exists to navigate — the
                                    // chip text below is uncapped and still
                                    // carries the day at full size.
                                    .dynamicTypeSize(...DynamicTypeSize.accessibility1)
                                }
                                DayChip(
                                    dayKey: entry.day,
                                    content: entry.content,
                                    isSelected: entry.day == selectedDay,
                                    isDisabled: disablesEmptyDays && entry.content.isEmpty
                                ) {
                                    onSelect(entry.day)
                                }
                            }
                            // On the `VStack`, not the chip: `ScrollViewProxy.
                            // scrollTo` centres the *outermost* view carrying
                            // the id, so leaving it on the chip would centre
                            // the chip and let the band slide out of the
                            // scrolled frame.
                            .id(entry.day)
                        }
                    }
                    .padding(.horizontal, 8)
                }
                .onScrollPhaseChange { _, newPhase in
                    isDragging = newPhase == .tracking || newPhase == .interacting
                }
                .onAppear { scroll(proxy, to: selectedDay) }
                .onChange(of: selectedDay) { _, day in
                    guard !isDragging else { return }
                    scroll(proxy, to: day)
                }
                // Gated the same as `selectedDay` above — this re-centre is
                // exactly as capable of fighting a manual drag (My Day's expand
                // toggle can fire while the reader has a finger on the rail),
                // so it must not bypass the guard just because its trigger
                // isn't `selectedDay` itself.
                .onChange(of: reanchorOn) { _, _ in
                    guard !isDragging else { return }
                    scroll(proxy, to: selectedDay)
                }
                // Catches up anything that changed *while* suppressed above: the
                // drag ending is not itself a `selectedDay`/`reanchorOn` change,
                // so without this a re-centre that landed mid-drag would
                // otherwise never get applied. Only fires when the target
                // actually diverged from what's centered now — see
                // `lastCentered`'s doc for why a plain "something changed" flag
                // was tried and reverted.
                .onChange(of: isDragging) { _, dragging in
                    guard !dragging, let day = selectedDay,
                        lastCentered?.day != day || lastCentered?.reanchorOn != reanchorOn
                    else { return }
                    scroll(proxy, to: day)
                }
                // Every UI test that queries the rail resolves it as
                // `app.scrollViews["day-rail"]`, and `revealByScrolling`
                // derives its drag coordinates from that element's frame —
                // both depend on the identifier landing on exactly this
                // `ScrollView`, not the outer `HStack` that now also holds
                // `leading()`/`trailing()`. That's also the more correct
                // frame for those drag coordinates now: it no longer
                // includes the two fixed controls at the ends.
                .accessibilityIdentifier("day-rail")
            }
            trailing()
        }
        // On the outer `HStack` now that `leading()`/`trailing()` live
        // beside the `ScrollView` rather than inside it — a group of
        // controls still needs one group role and one label covering the
        // whole strip (the lesson from the web header menu, PR #228/#219).
        // `.contain` keeps every descendant (the two end controls, each
        // chip) individually accessible; only the container-level role and
        // label move here.
        .accessibilityElement(children: .contain)
        .accessibilityLabel(accessibilityLabel)
    }

    /// The segment for `index`, but only if it really is the one for `day`.
    ///
    /// Same-length-and-same-order-as-`entries` is `bandSegments`' documented
    /// contract, but a band is unusually bad at showing when that contract
    /// breaks: a whole band shifted one chip to the left looks exactly like
    /// a band, just wrong. Re-checking the key costs one string compare per
    /// chip and turns a silent misalignment into a visible gap, plus a trap
    /// in DEBUG so the caller's own test run finds it first.
    private func resolvedSegment(at index: Int, day: String) -> WeekBandSegment? {
        guard !bandSegments.isEmpty else { return nil }
        guard index < bandSegments.count, bandSegments[index].dayKey == day else {
            assertionFailure(
                "bandSegments must be one-per-entry and in the same order as entries; "
                    + "index \(index) is "
                    + "\(index < bandSegments.count ? bandSegments[index].dayKey : "missing") "
                    + "but the chip there is \(day)")
            return nil
        }
        return bandSegments[index]
    }

    private func scroll(_ proxy: ScrollViewProxy, to day: String?) {
        guard let day else { return }
        lastCentered = (day, reanchorOn)
        withAnimation(.easeInOut(duration: 0.2)) {
            proxy.scrollTo(day, anchor: .center)
        }
    }
}

extension DayRailView {
    func reanchoring(on values: [AnyHashable]) -> Self {
        var copy = self
        copy.reanchorOn = values
        return copy
    }
}

/// Where the week band's painted fill runs, and where it breaks.
///
/// A free namespace rather than a member of `DayRailView`, which is generic
/// over its two end-control view types and so cannot be named in a test
/// without inventing them — and this is a pure function of the segment list
/// that deserves testing without a view host.
enum WeekBandRun {
    /// How far an unreachable week's fill is faded (#256 review fix).
    ///
    /// **The fill, never the `WEEK n` label.** `DayChip` records at length
    /// why the rail has no `.disabled()` left in it: SwiftUI's disabled
    /// dimming is a compositing pass over the whole label, and it took an
    /// empty chip's text to a sampled ~3.7:1 in an on-device audit. Fading
    /// only the fill cannot repeat that — the label keeps `.primary`, and
    /// because the ramp sits *between* the rail's background and the label's
    /// colour in both appearances (light: a grey fill under black text on a
    /// near-white bar; dark: a grey fill under white text on a near-black
    /// bar), a faded fill composites *toward* the background and so can only
    /// raise the label's contrast, never lower it.
    ///
    /// Here rather than on `WeekBandSegmentView`, which is `private` and so
    /// cannot be named from a test: `WeekBandContrastTests` computes the
    /// faded composite against this exact value, and a copy of the number in
    /// the test would check a constant nothing uses.
    static let unreachableFillOpacity: Double = 0.3

    /// Whether the band's fill runs straight through the gutter between the
    /// chips at `index` and `index + 1`, instead of stopping at the chip's
    /// edge the way the segment's own frame does.
    ///
    /// **This is the whole reason a week reads as a week.** Every chip is
    /// separated from the next by the same `RailMetrics.chipGutter`, within a
    /// week and across a week boundary alike — so a band drawn strictly
    /// chip-by-chip is a row of identical bars with identical gaps, and a
    /// week's *extent* is invisible: nothing but the `WEEK n` text says a
    /// week exists at all. Bridging the gutters inside a week turns each week
    /// into one continuous run, and then the one gap that survives — the seam
    /// through a boundary Saturday, see `WeekBandSegmentView.fillRun` — is
    /// the only break in the band and therefore unmistakable.
    ///
    /// Two adjacent days bridge when they share a week. A boundary Saturday
    /// shares its closing week with the Friday before it and its opening week
    /// with the Sunday after, so it bridges *both* ways and its own split is
    /// where the break goes. An out-of-season day shares nothing, so a run
    /// ends at the season's edge.
    static func bridgesGutter(after index: Int, in segments: [WeekBandSegment]) -> Bool {
        guard index >= 0, index + 1 < segments.count else { return false }
        let left = segments[index]
        let right = segments[index + 1]
        guard !left.weekNumbers.isEmpty, !right.weekNumbers.isEmpty else { return false }
        // `weekNumbers` holds 0, 1, or 2 entries by construction (a shared
        // Saturday is the only 2-entry case), and this runs twice per
        // segment on every rail render — i.e. on every day-section boundary
        // crossed while scrolling (#256 review fix, same path as
        // `WeekBands.segments`'s single-season-build fix). A `Set` over a
        // domain this small buys nothing but an allocation, so this checks
        // membership directly instead. Must compare every element on both
        // sides, not just `first`: a boundary Saturday's `[1, 2]` shares its
        // *second* entry with the week after it, which a `first == first`
        // shortcut would miss.
        return left.weekNumbers.contains(where: right.weekNumbers.contains)
    }
}

/// The rail's shared horizontal metrics.
///
/// One place, because the band's fill overflow is *derived* from the chip
/// gutter rather than a second literal that happens to match today: the fill
/// bridges exactly half a gutter on each side, so two bridged neighbours meet
/// with no hairline and no overlap seam. Two independent `8`s would drift the
/// moment one of them was tuned.
private enum RailMetrics {
    /// Space between two day chips, and between the two fixed end controls
    /// and the scrolling strip.
    static let chipGutter: CGFloat = 8

    /// How far a bridged band fill overflows its own segment on one side —
    /// half the gutter, so two neighbours' overflows meet exactly at the
    /// gutter's midpoint.
    static var bandBleed: CGFloat { chipGutter / 2 }

    /// The break between two weeks' runs, drawn through the middle of the
    /// boundary Saturday they share.
    ///
    /// Deliberately *narrower* than a chip gutter: it is the only gap left in
    /// the band, so it does not need to shout, and a wider one would start to
    /// look like the per-chip gaps this design removed. Half a gutter keeps it
    /// proportional to the bleed either side of it.
    static var weekSeam: CGFloat { chipGutter / 2 }

    /// Rounding on a run's outer ends. Small enough to stay a bar rather than
    /// a capsule at 14pt, large enough that a run reads as one closed shape.
    static let bandCornerRadius: CGFloat = 3
}

/// One day's slice of the week band above the chips (#256).
///
/// A shared Saturday carries **both** weeks' tones, split down the middle —
/// that is what says "this day is in both" directly, rather than leaving the
/// reader to infer it from two labels either side of a single flat colour.
///
/// Its own type rather than a `@ViewBuilder` method on `DayRailView` for one
/// concrete reason: `@ScaledMetric` reads the environment of the view that
/// declares it, so `height` here scales against the *capped*
/// `dynamicTypeSize` the call site applies to this view, not against the
/// rail's uncapped one. A method on `DayRailView` could only have read the
/// rail's, and the band would have grown past the label it holds.
private struct WeekBandSegmentView: View {
    let segment: WeekBandSegment?
    let day: String

    /// Whether this day's *fill* continues into the gutter on that side,
    /// because the neighbour there is in the same week.
    ///
    /// **Fill only — never the frame.** The segment's frame, its
    /// `contentShape` tap target and its accessibility element all stay
    /// exactly one chip wide, which is what makes band-to-chip alignment
    /// structural (the same `HStack` lays out both) rather than two layouts
    /// agreeing. Only the painted run overflows, via negative padding inside
    /// a `.background`, which cannot change the size of the view it is drawn
    /// behind. Keep the two separable: collapsing them would make a week's
    /// chips wider than its neighbours' and pull the band out of line with
    /// the chips it labels.
    let bridgesLeading: Bool
    let bridgesTrailing: Bool

    let onSelectWeek: ((Int) -> Void)?

    /// See `DayRailView.weekDestinations`. `nil` means "no reachability
    /// information", not "nothing is reachable".
    let weekDestinations: [Int: WeekBandDestination]?

    /// Scales with `.caption2`, the label's own text style, so the strip and
    /// the `WEEK n` inside it stay in proportion at every text size instead
    /// of the text outgrowing a fixed 14pt strip.
    @ScaledMetric(relativeTo: .caption2) private var height: CGFloat = 14

    var body: some View {
        Color.clear
            .frame(height: height)
            // The run is a `.background`, not the view itself, for the same
            // reason the label is an `.overlay`: a background is laid out
            // against its parent's size and cannot change it. That is what
            // lets the fill overflow into the gutters (negative padding
            // below) while this view — and so the `VStack` and the chip under
            // it — stays exactly one chip wide.
            .background(alignment: .center) {
                fillRun
                    .padding(.leading, -leadingBleed)
                    .padding(.trailing, -trailingBleed)
            }
            // An `.overlay`, not a second `ZStack` child: an overlay is sized
            // by its parent and cannot widen it, so a `WEEK n` label wider
            // than one chip overhangs into its neighbours (clipped only by
            // the scroll view) instead of stretching this segment — and with
            // it the enclosing `VStack`, and with that the chip below — past
            // the width every other chip has. The label names a whole week,
            // so overhanging is correct; widening one column of the rail is
            // not.
            .overlay {
                if let week = segment?.labelledWeek {
                    Text("WEEK \(week)")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { navigate() }
            // Only a *labelled* segment is exposed to VoiceOver, and
            // `WeekBands.segments` places at most one of those per week.
            // Exposing every in-season segment instead would put sixty-odd
            // extra stops in front of a reader swiping the rail, most of them
            // carrying no label at all — an unlabelled element being itself
            // the thing an audit flags. Nine elements reading "Week 1"
            // through "Week 9" is the band's actual content. The tap target
            // stays on every segment above, where it is a pointer affordance
            // rather than a stop.
            .accessibilityElement()
            .accessibilityHidden(segment?.labelledWeek == nil)
            .accessibilityLabel(spokenLabel)
            // A band is a control, and until this trait landed it announced
            // as plain text: VoiceOver gave a reader no way to know "Week 6"
            // could be activated, and an unreachable week was indistinguishable
            // from a reachable one. Traits and label move together — the trait
            // is only added where `navigate()` will actually fire, so
            // "double tap to activate" is never announced for a week the tap
            // silently refuses.
            .accessibilityAddTraits(isNavigable ? [.isButton] : [])
            // Not left to the `.onTapGesture` above: a tap gesture on an
            // `.accessibilityElement()` container is not reliably what
            // VoiceOver's activation invokes. `WeekRangeStrip.segment` states
            // its action the same way for the same reason.
            .accessibilityAction { navigate() }
            .accessibilityIdentifier("day-band-\(day)")
    }

    /// The week this segment's tap means, when it means one and can reach it.
    ///
    /// `WeekBandSegment.navigationTarget` answers only the first half — a
    /// shared Saturday has no unambiguous week, so it is never a tap target
    /// regardless of reachability. `weekDestinations` answers the second.
    private var targetWeek: Int? {
        guard let week = segment?.navigationTarget else { return nil }
        guard let weekDestinations else { return week }
        return weekDestinations[week] == nil ? nil : week
    }

    private var isNavigable: Bool { targetWeek != nil }

    private func navigate() {
        guard let targetWeek else { return }
        onSelectWeek?(targetWeek)
    }

    /// Named by destination, never by direction — `WeekBands` builds the
    /// phrase so it can be tested without a view host, and so an unreachable
    /// week is stated as a fact ("Week 6, no events") rather than offered.
    ///
    /// Only a *labelled* segment is exposed at all, so this is read for at
    /// most one segment per week.
    private var spokenLabel: String {
        guard let week = segment?.labelledWeek else { return "" }
        guard let weekDestinations else { return "Week \(week)" }
        return weekDestinations[week]?.accessibilityLabel
            ?? WeekBands.unreachableLabel(week: week)
    }

    /// A bleed is only ever applied to a segment that actually has a run to
    /// draw; a nil segment (out of season, or the misalignment
    /// `DayRailView.resolvedSegment` refuses to guess at) paints nothing, so
    /// it must not paint nothing *wider*.
    ///
    /// **The `segment == nil` short-circuit is load-bearing, not defensive.**
    /// `bridgesLeading`/`bridgesTrailing` are looked up by *raw index* into
    /// `DayRailView.bandSegments`, which is the one place the band does not
    /// re-check that the index really belongs to this chip; refusing to bleed
    /// when this view has no segment of its own is what keeps a stale or
    /// misaligned bridge answer from painting a run over a day that has none.
    private var leadingBleed: CGFloat {
        segment == nil || !bridgesLeading ? 0 : RailMetrics.bandBleed
    }

    private var trailingBleed: CGFloat {
        segment == nil || !bridgesTrailing ? 0 : RailMetrics.bandBleed
    }

    /// This day's piece of its week's run.
    ///
    /// One bar for an ordinary day, two for a boundary Saturday — split down
    /// the middle, carrying both weeks' tones, with `RailMetrics.weekSeam`
    /// between them. That seam is the *only* gap in an otherwise continuous
    /// band: every gutter inside a week is bridged (see
    /// `WeekBandRun.bridgesGutter(after:in:)`), so the reader does not have
    /// to compare two greys across a gap to find a boundary — the shape
    /// breaks there and nowhere else, and the colour change merely confirms
    /// it. The seam lands on the shared Saturday's centre line, which is also
    /// what says "this one day is in both weeks."
    @ViewBuilder
    private var fillRun: some View {
        let steps = runSteps
        let weeks = segment?.weekNumbers ?? []
        if steps.count == 1 {
            bar(step: steps[0], week: weeks.first,
                roundsLeading: !bridgesLeading, roundsTrailing: !bridgesTrailing)
        } else if steps.count == 2 {
            HStack(spacing: RailMetrics.weekSeam) {
                // Both inner ends are rounded: they are the ends of two
                // different weeks' runs, not the middle of one. Each half
                // also dims on its own week's reachability — a shared
                // Saturday can close a week that still has events and open
                // one that has none.
                bar(step: steps[0], week: weeks.first,
                    roundsLeading: !bridgesLeading, roundsTrailing: true)
                bar(step: steps[1], week: weeks.count > 1 ? weeks[1] : nil,
                    roundsLeading: true, roundsTrailing: !bridgesTrailing)
            }
        } else {
            // Outside the season there is no week, so the band says nothing
            // rather than guessing one.
            Color.clear
        }
    }

    /// The ramp steps this segment draws, at most two.
    ///
    /// `WeekBandSegment.rampSteps` mirrors `weekNumbers`, which
    /// `SeasonCalendar.weekNumbers(spanningDayOf:)` documents as one week for
    /// an ordinary day and two for the Saturday two weeks share — a day
    /// cannot be in three Chautauqua weeks, so three entries would mean that
    /// contract had changed under us. Recording the assumption the way
    /// `DayRailView.resolvedSegment(at:day:)` records its own: DEBUG builds
    /// trap so the change is found by its author's own test run, release
    /// builds draw the first two rather than crash a rail over a colour.
    private var runSteps: [Double] {
        guard let segment else { return [] }
        if segment.rampSteps.count > 2 {
            assertionFailure(
                "WeekBandSegment.rampSteps carries \(segment.rampSteps.count) steps for "
                    + "\(segment.dayKey); the band can only draw one week or two")
        }
        return Array(segment.rampSteps.prefix(2))
    }

    /// One week's piece of run, rounded only where the run actually ends —
    /// at a seam, or at the edge of the season. A rounded end inside a run
    /// would be a false boundary, and a square end at a real one would blunt
    /// the only signal this design has left.
    private func bar(
        step: Double, week: Int?, roundsLeading: Bool, roundsTrailing: Bool
    ) -> some View {
        let radius = RailMetrics.bandCornerRadius
        return UnevenRoundedRectangle(
            topLeadingRadius: roundsLeading ? radius : 0,
            bottomLeadingRadius: roundsLeading ? radius : 0,
            bottomTrailingRadius: roundsTrailing ? radius : 0,
            topTrailingRadius: roundsTrailing ? radius : 0,
            style: .continuous
        )
        .fill(Self.rampColor(step)
            .opacity(isReachable(week) ? 1 : WeekBandRun.unreachableFillOpacity))
    }

    /// Whether the fill for `week` is drawn at full strength.
    ///
    /// Reachability is per *week*, not per segment, precisely so a shared
    /// Saturday's two halves can disagree.
    private func isReachable(_ week: Int?) -> Bool {
        guard let weekDestinations, let week else { return true }
        return weekDestinations[week] != nil
    }


    /// The ramp, interpolated between two named assets rather than nine
    /// hand-tuned colours. Lightness varies and hue does not, so adjacent
    /// weeks always differ, the season reads as a gradient, and colour-vision
    /// deficiency costs nothing.
    ///
    /// **On the endpoint values, and why they are grey.** They were checked,
    /// not eyeballed: `WeekBandContrastTests` computes the WCAG 2.1 ratio
    /// between each endpoint and the `.primary` label drawn on it, in both
    /// appearances, against the 4.5:1 AA floor. Both endpoints are the worst
    /// cases — the mix is monotonic in lightness, so every intermediate week
    /// sits between them — which is why that test checks the two ends and not
    /// the middle. If a future palette change fails there, the fix is to pull
    /// the endpoints closer together (less lightness travel, still monotonic)
    /// or to demote the fill to a thin rule under a normally-coloured label —
    /// never to loosen the floor.
    ///
    /// The plan's starting palette was a blue ramp (`#DCE6F2`/`#8FA9C6`
    /// light, `#22303F`/`#5A7794` dark). It was replaced after a dark-mode
    /// screenshot at week 9: `#5A7794` computes 1.196:1 against
    /// `DayChipSelected` dark, and the band segment and the selected chip
    /// directly beneath it merged into a single shape — the selected chip
    /// appeared to have grown a flag. The ramp is a neutral cool grey now,
    /// which is what keeps the accent blue meaning exactly one thing on this
    /// rail. Darkening the dark end also bought the white `WEEK n` label real
    /// headroom: 4.67:1 on the old palette, 6.75:1 on this one. The light end
    /// moved the same way for the same reason a screenshot showed —
    /// `#DCE6F2` was so close to `DayChipBackground` that week 1's band was
    /// all but invisible.
    private static func rampColor(_ step: Double) -> Color {
        Color("WeekBandStart").mix(with: Color("WeekBandEnd"), by: step)
    }
}

/// One selectable day chip in `MyDayView`'s strip (#192).
///
/// All labelling lives in `MyDayChipContent` so it can be tested without a
/// view host; this type owns only the visual encoding of the four states,
/// which must compose because a day can be empty *and* today *and* selected
/// at once:
///
/// - **Fill** = selected, and nothing else uses fill. Selected fill is
///   `DayChipSelected`, a colour asset (not `Color.accentColor` directly)
///   darkened enough from the app's `#5B7F95` accent that white chip text
///   clears WCAG AA's 4.5:1 against it — the accent itself only reaches
///   4.27:1, which an on-device audit reported as "nearly passed."
/// - **Today** = the word `"Today"` in `content.topLine` — carried in text
///   precisely so a selected fill cannot swallow it.
/// - **Empty** = a dashed stroke, at an opacity firmed up to stay legible
///   now that the text itself is no longer dimmed (see `foreground`) —
///   dimming text was flagged by the same on-device audit as a contrast
///   failure, since `.secondary` compounded with the (formerly
///   translucent) chip background rather than reading as an intentional
///   affordance.
/// - **Count** = the third line, which always occupies its space — as a
///   fixed-height reservation rather than a blank `Text(" ")` when zero, so
///   chip heights never jitter as events are starred and unstarred *and*
///   an empty chip carries no phantom text for a screen reader or an
///   accessibility audit to trip over.
struct DayChip: View {
    let dayKey: String
    let content: MyDayChipContent
    let isSelected: Bool
    var isDisabled: Bool = false
    let action: () -> Void

    /// Scales with Dynamic Type the same way `.caption2` text does, so the
    /// empty count line's reserved height (see `countLine`) keeps matching
    /// a populated one's at every text size, not just the default.
    @ScaledMetric(relativeTo: .caption2) private var countLineHeight: CGFloat = 14

    var body: some View {
        // No `.disabled()` anywhere in this chip's ancestry (accessibility
        // follow-up to #245, second pass). SwiftUI dims a disabled
        // control's *entire* label as a single compositing pass applied
        // from *outside* it — an `.environment(\.isEnabled, true)` placed
        // inside the label cannot cancel that, because the dimming isn't
        // something the label's descendants read from the environment,
        // it's applied to the already-rendered label as a unit. That's
        // what an on-device audit caught on the Events rail's disabled
        // empty chips (`disablesEmptyDays: true`): their text measured a
        // real, sampled ~3.7:1 contrast — dimmed to mid-grey against the
        // chip fill — despite `foreground` below never asking for anything
        // but `.primary`.
        //
        // A first fix kept `.disabled()` but split the chip into a hidden
        // visual plus a `Color.clear`-labelled `Button` carrying the
        // disabled state, so there was nothing visible left for the
        // dimming pass to touch. That was audit-clean, but a `Color.clear`
        // overlay is a poor hit target: it broke tap delivery after a
        // synthetic drag (6 of 15 `DayRailUITests`). The actual fix is
        // narrower — an empty chip on the Events rail was never a control
        // that happened to be disabled, it's not a control at all, since
        // there is no section for it to go to. So the two states aren't
        // "enabled `Button`" vs. "disabled `Button`", they're "`Button`" vs.
        // "plain view": with no `.disabled()` in play there is no dimming
        // pass, and `chipVisual` renders at full, undimmed contrast through
        // one ordinary view hierarchy either way — nothing to split.
        if isDisabled {
            // An empty day on the Events rail: named as a fact
            // (`content.accessibilityLabel` already reads as one — e.g.
            // "Sunday, August 16, no events" — never "Go to"), not offered
            // as a destination, and carrying no button trait. My Day always
            // passes `isDisabled: false` (its empty chips stay tappable —
            // selecting one is how the reader reaches its "Browse …"
            // action, #192); only the Events rail's `disablesEmptyDays:
            // true` ever reaches this branch.
            chipVisual
                .accessibilityLabel(content.accessibilityLabel)
                .accessibilityAddTraits(isSelected ? [.isSelected] : [])
                .accessibilityIdentifier("day-chip-\(dayKey)")
        } else {
            Button(action: action) {
                chipVisual
            }
            .buttonStyle(.plain)
            .accessibilityLabel(content.accessibilityLabel)
            .accessibilityAddTraits(isSelected ? [.isSelected] : [])
            .accessibilityIdentifier("day-chip-\(dayKey)")
        }
    }

    private var chipVisual: some View {
        VStack(spacing: 2) {
            Text(content.topLine)
                .font(.caption.weight(content.isToday ? .bold : .regular))
            Text(content.dateLine)
                .font(.subheadline.weight(isSelected ? .semibold : .regular))
            countLine
        }
        .frame(minWidth: 58)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background {
            // Concrete `Color`, not the ternary-into-`AnyShapeStyle` this
            // was before (accessibility follow-up to #245): the on-device
            // audit kept reporting contrast failures on ordinary chip text
            // even after the fill became a deterministic opaque colour,
            // and stopped once the type erasure was removed —
            // `AnyShapeStyle` apparently isn't fully legible to the
            // audit's own background inspection.
            if isSelected {
                RoundedRectangle(cornerRadius: 12).fill(Color("DayChipSelected"))
            } else {
                RoundedRectangle(cornerRadius: 12).fill(Color.dayRailControlBackground)
            }
        }
        .overlay {
            if content.isEmpty {
                // Opacity firmed up from 0.7/0.5 (accessibility follow-up
                // to #245): with the text itself no longer dimmed to
                // signal "empty" (see `foreground`), the dashed stroke is
                // the affordance's only remaining carrier and had to read
                // clearly on its own.
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(
                        isSelected ? Color.white.opacity(0.85) : Color.secondary.opacity(0.75),
                        style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
            }
        }
        .foregroundStyle(foreground)
    }

    /// Always rendered, blank when the count is zero, so every chip is the
    /// same height whether or not anything is starred on it.
    @ViewBuilder
    private var countLine: some View {
        if content.count > 0 {
            if let symbol = content.symbol {
                Label("\(content.count)", systemImage: symbol)
                    .font(.caption2)
                    .labelStyle(.titleAndIcon)
            } else {
                Text("\(content.count)").font(.caption2)
            }
        } else {
            // A non-text height reservation (accessibility follow-up to
            // #245): a blank `Text(" ")` here used to hand the on-device
            // audit a text element carrying a single-space label to flag
            // — on both the contrast and Dynamic Type checks — for content
            // nothing was ever meant to speak. `Color.clear` reserves the
            // same line height without presenting any element for the
            // audit, or a screen reader, to trip over; the chip's own
            // `accessibilityLabel` already says "no events" for this case.
            Color.clear
                .frame(height: countLineHeight)
                .accessibilityHidden(true)
        }
    }

    /// No longer dims empty-day text to `.secondary` (accessibility
    /// follow-up to #245): compounded with the chip's then-translucent
    /// background, that dimming was itself a contrast failure the
    /// on-device audit caught — on `Mon`/`Thu` too, which aren't even
    /// empty, showing the real fault was the background, not the emptiness
    /// signal riding on top of it. Empty is still fully legible via the
    /// dashed stroke (`overlay` above) and the absent/blank count line.
    private var foreground: AnyShapeStyle {
        isSelected ? AnyShapeStyle(.white) : AnyShapeStyle(.primary)
    }
}
