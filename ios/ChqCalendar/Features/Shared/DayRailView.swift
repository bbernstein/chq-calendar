import SwiftUI

/// A horizontal strip of day chips with an optional control at each end.
///
/// Extracted from My Day (#192), which had it first, so the Events tab's day
/// rail is the same surface rather than a lookalike. The two screens differ
/// only in what the chips count (`DayChipCountStyle`) and what sits at the
/// ends: My Day's chevrons reveal the rest of the season, the Events rail's
/// step one day at a time. Both, not one replacing the other — "go far" and
/// "go one" are different questions.
///
/// **Scroll-to-selection lives here**, because getting it wrong is invisible
/// until a real device: expanding an end prepends or appends chips, which
/// shifts the content under the reader, and re-anchoring on the same day is
/// what holds the selection still so that revealing the past never moves you.
struct DayRailView<Leading: View, Trailing: View>: View {
    let entries: [MyDayChipContent.Entry]
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

    /// The day `scroll(_:to:)` last actually centered on. Distinct from
    /// `selectedDay` itself so the drag-end catch-up below can tell "the
    /// anchor moved while I was suppressing" from "the anchor never
    /// changed, the reader was just dragging" — the first must re-sync, the
    /// second must not, or every manual drag would immediately snap back to
    /// wherever `selectedDay` already pointed the instant the finger lifts
    /// (found by `DayRailUITests.revealByScrolling`'s drag loop timing out
    /// with the target chip's frame never moving at all).
    @State private var lastCenteredDay: String?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    leading()
                    ForEach(entries) { entry in
                        DayChip(
                            dayKey: entry.day,
                            content: entry.content,
                            isSelected: entry.day == selectedDay,
                            isDisabled: disablesEmptyDays && entry.content.isEmpty
                        ) {
                            onSelect(entry.day)
                        }
                        .id(entry.day)
                    }
                    trailing()
                }
                .padding(.horizontal)
            }
            .onScrollPhaseChange { _, newPhase in
                isDragging = newPhase == .tracking || newPhase == .interacting
            }
            .onAppear { scroll(proxy, to: selectedDay) }
            .onChange(of: selectedDay) { _, day in
                guard !isDragging else { return }
                scroll(proxy, to: day)
            }
            .onChange(of: reanchorOn) { _, _ in scroll(proxy, to: selectedDay) }
            // Catches up anything that changed *while* suppressed above: the
            // drag ending is not itself a `selectedDay` change, so without
            // this an anchor move that landed mid-drag would otherwise never
            // get applied.
            .onChange(of: isDragging) { _, dragging in
                guard !dragging, selectedDay != lastCenteredDay else { return }
                scroll(proxy, to: selectedDay)
            }
        }
        // Chained off `ScrollViewReader`, not the `ScrollView` inside it.
        // `ScrollViewReader` contributes no accessibility element of its
        // own, so these three modifiers land on the `ScrollView` below it
        // either way — confirmed by dumping `app.debugDescription` against
        // a running build, which reports `ScrollView, ... identifier:
        // 'day-rail'`. Do not "fix" this by moving the modifiers onto the
        // inner `ScrollView` directly: it would compile and look tidier,
        // but every UI test that queries `app.scrollViews["day-rail"]`
        // depends on the identifier landing exactly here.
        .accessibilityElement(children: .contain)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityIdentifier("day-rail")
    }

    private func scroll(_ proxy: ScrollViewProxy, to day: String?) {
        guard let day else { return }
        lastCenteredDay = day
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

/// One selectable day chip in `MyDayView`'s strip (#192).
///
/// All labelling lives in `MyDayChipContent` so it can be tested without a
/// view host; this type owns only the visual encoding of the four states,
/// which must compose because a day can be empty *and* today *and* selected
/// at once:
///
/// - **Fill** = selected, and nothing else uses fill.
/// - **Today** = the word `"Today"` in `content.topLine` — carried in text
///   precisely so a selected fill cannot swallow it.
/// - **Empty** = dashed stroke plus secondary content, kept (in white) even
///   while selected.
/// - **Count** = the third line, which always occupies its space so chip
///   heights never jitter as events are starred and unstarred.
struct DayChip: View {
    let dayKey: String
    let content: MyDayChipContent
    let isSelected: Bool
    var isDisabled: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
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
            .background(
                isSelected ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.thinMaterial),
                in: RoundedRectangle(cornerRadius: 12)
            )
            .overlay {
                if content.isEmpty {
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(
                            isSelected ? Color.white.opacity(0.7) : Color.secondary.opacity(0.5),
                            style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                }
            }
            .foregroundStyle(foreground)
        }
        .buttonStyle(.plain)
        // An empty day is not a destination: there is nothing to go to, and
        // its accessibility label already says so as a fact rather than an
        // invitation. Disabling it and labelling it honestly are the same
        // decision, made in two places — `DayChipCountStyle.actionPrefix`
        // owns the wording, this owns the affordance. My Day passes
        // `isDisabled: false` always (its empty chips stay tappable —
        // selecting an empty day is how the reader reaches its "Browse …"
        // action, #192); the Events rail passes `disablesEmptyDays: true`
        // through `DayRailView`, so only its empty chips land here `true`.
        .disabled(isDisabled)
        .accessibilityLabel(content.accessibilityLabel)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
        .accessibilityIdentifier("day-chip-\(dayKey)")
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
            Text(" ").font(.caption2)
        }
    }

    private var foreground: AnyShapeStyle {
        if isSelected { return AnyShapeStyle(.white) }
        return content.isEmpty ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary)
    }
}
