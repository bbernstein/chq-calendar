import SwiftUI

/// The filter pill's sheet: what is active, when, the two facets, and
/// favorites.
///
/// Everything applies live — the list behind the sheet re-filters on every
/// tap, visible at the medium detent. The footer button only dismisses.
/// There is no staged selection, so there is nothing to cancel and no way
/// for the sheet's state and the model's to disagree.
///
/// Favorites lives here rather than in the bar so the pill's badge can
/// account for every filter that narrows the list. See `ActiveFilterCount`.
struct FilterSheet: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss

    private var chips: [ActiveFilterChip] {
        ActiveFilterChips.build(selection: model.filter)
    }

    private var visibleScopes: [DateScope] {
        model.isCurrentYear ? [.next, .today, .season, .all] : [.all]
    }

    private var seasonWeeks: [SeasonWeek] {
        SeasonCalendar.weeks(forYear: model.selectedYear)
    }

    private var weekNumbers: [Int] { seasonWeeks.map(\.number) }

    /// What a strip gesture should treat as already-selected. A persisted
    /// `.thisWeek` scope highlights the current week without any stored
    /// weeks — treating it as that one week makes tapping it deselect
    /// (rather than confusingly "re-select") on the first touch.
    private var effectiveWeekSelection: Set<Int> {
        if model.filter.selectedWeeks.isEmpty,
           model.filter.dateScope == .thisWeek,
           let currentWeek = model.currentWeek {
            return [currentWeek]
        }
        return model.filter.selectedWeeks
    }

    /// The date range in words, above the scope chips. This is
    /// `DateFilterLabel`'s new home: it used to render into the bottom
    /// bar's date pill, which #256 deleted. The label is still exactly
    /// the right sentence for "what does the date part of this filter
    /// currently mean", and ~40 tests describe it.
    private var dateLabel: String {
        DateFilterLabel.text(
            for: model.filter,
            seasonWeekCount: seasonWeeks.count,
            isCurrentYear: model.isCurrentYear)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if !chips.isEmpty {
                        activeSection
                    }
                    whenSection
                    FacetChipCloud(model: model, facet: .venues)
                    FacetChipCloud(model: model, facet: .categories)
                    favoritesSection
                }
                .padding(20)
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !chips.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        // Clears search, venues, categories, and favorites —
                        // deliberately NOT the date scope or week selection.
                        //
                        // Since #256 those live in this same sheet's WHEN
                        // section rather than behind their own pill, which
                        // makes "surely Clear Filters should clear all of
                        // it" a much easier mistake. It should not: a
                        // reader who reached an empty list through a week
                        // selection needs a button that recovers the
                        // *other* filters without also throwing away the
                        // dates they deliberately chose. Keep this scoped
                        // to `clearNonDateFilters()`.
                        Button("Clear Filters") { model.clearNonDateFilters() }
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                // `matchCount`, not `dayGroups` — the footer needs a number,
                // and this sheet is presented over `EventListView`, which is
                // already grouping the same events behind it.
                SheetDismissButton(count: model.matchCount) { dismiss() }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
    }

    private var activeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Active")
                .font(.caption.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
            FlowLayout(spacing: 8) {
                ForEach(chips) { chip in
                    Button {
                        model.remove(chip)
                    } label: {
                        HStack(spacing: 5) {
                            Text(chip.label).lineLimit(1)
                            Image(systemName: "xmark")
                                .font(.caption2.weight(.bold))
                                .opacity(0.7)
                        }
                        .font(.footnote.weight(.medium))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .frame(minHeight: 36)
                        .foregroundStyle(.white)
                        .background(Color.accentColor, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(chip.accessibilityLabel)
                }
            }
        }
    }

    /// The date controls, moved here when `DateFilterSheet` was deleted
    /// (#256). Two questions, deliberately both here and deliberately
    /// distinct from the day rail behind this sheet: the rail *navigates*
    /// ("take me to week 6"), these *filter* ("show me only weeks 3-5").
    /// Every control on the rail navigates; every filter is in this sheet.
    /// That is the rule this design exists to make learnable — do not add
    /// a filtering control to the rail, or a navigating one here.
    private var whenSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("When")
                .font(.caption.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)

            Text(dateLabel)
                .font(.footnote)
                .foregroundStyle(.secondary)

            FlowLayout(spacing: 8) {
                ForEach(visibleScopes, id: \.self) { scope in
                    // Always defer to `FilterChipState`, even when
                    // `visibleScopes` has collapsed to the lone `.all` chip
                    // for a non-current year: a week selection made in
                    // another year survives `AppModel.select(year:)` (it
                    // doesn't clear the filter), and only
                    // `FilterChipState.isScopeSelected` knows that a
                    // non-empty `selectedWeeks` means "All" is *not*
                    // selected. Hardcoding `true` here previously let this
                    // one chip and the week grid both show as checked at
                    // once.
                    //
                    // `isCurrentYear` is what tells it that a persisted
                    // `.next`/`.today`/`.thisWeek` is being ignored by the
                    // pipeline on a past season, so the collapsed "All"
                    // chip reads selected there instead of leaving the
                    // sheet's only date control unchecked.
                    SheetChip(
                        label: scope.label,
                        isSelected: FilterChipState.isScopeSelected(
                            scope, selection: model.filter,
                            currentWeek: model.currentWeek,
                            isCurrentYear: model.isCurrentYear)
                    ) {
                        model.selectScope(scope)
                    }
                }
            }

            let now: Date? = model.isCurrentYear ? model.now() : nil
            let weeks = seasonWeeks
            WeekRangeStrip(
                weekNumbers: weekNumbers,
                isSelected: { number in
                    FilterChipState.isWeekSelected(
                        number, selection: model.filter,
                        currentWeek: model.currentWeek)
                },
                effectiveSelection: effectiveWeekSelection,
                timeState: { WeekStripState.timeState(week: $0, now: now, weeks: weeks) },
                commit: { model.setWeekSelection($0) })
        }
    }

    private var favoritesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Only Show")
                .font(.caption.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
            // `favoritesMatchCount`, not `favorites.count`: every other chip
            // in this sheet shows how many events it would leave given the
            // rest of the selection, and this one has to mean the same thing.
            SheetChip(
                label: "Favorites",
                count: model.favoritesMatchCount,
                isSelected: model.filter.showFavoritesOnly
            ) {
                model.toggleFavoritesOnly()
            }
        }
    }
}
