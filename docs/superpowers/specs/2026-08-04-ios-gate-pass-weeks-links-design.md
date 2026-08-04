# Design: iOS issues #163 (Gate Pass note), #162 (Weeks/When filter redesign), #158 (Bus & Tram Tracker link)

**Status:** Approved design, pending implementation plan
**Date:** 2026-08-04
**Issues:** [#163](https://github.com/bbernstein/chq-calendar/issues/163), [#162](https://github.com/bbernstein/chq-calendar/issues/162), [#158](https://github.com/bbernstein/chq-calendar/issues/158)

Three independent changes, delivered as three separate PRs (smallest first:
#158 → #163 → #162). All are iOS-first; #158 also touches the web header.

---

## Investigation record (#163) — why a heuristic, not data

The gate-pass access fields (`_tribe_custom_access_type`,
`_tribe_custom_access_note`) exist only as **protected WordPress post meta**
on chq.org. They are rendered server-side by the PHP theme into each event
page's "How To Access This Event" sidebar and are **not exposed by any API**:

- `tribe/events/v1` (our ingest source): `custom_fields: []` on every event
  sampled (~65 across all 16 categories). Its swagger doc confirms the
  single-event endpoint takes only `id`/`password` — no meta expansion.
- `wp/v2/tribe_events`: `meta` carries only registered-public keys; the
  access fields are unregistered and underscore-protected.
- `tec/v1` (experimental, requires the `X-TEC-EEA` acknowledgement header):
  WP-post-shaped payload, no access fields; 500s on some events.
- ICS export, JSON-LD, `cost_details`: nothing.
- tickets.chq.org (Vivaticket) distinguishes the two example events
  structurally (gate-pass events sell "Upgrade Tickets"; non-gate-pass
  events sell Single Tickets only) but only inside server-rendered HTML —
  no JSON endpoint, and behind queue-it during high demand.

Scraping was ruled out (user decision: chq.org is slow; don't add traffic).
The long-term fix — CHQ registering the meta with `show_in_rest`, or
re-creating the fields as Events Calendar PRO "Additional Fields" — goes in
the pending CHQ outreach note. Until then:

**Controlled comparison** (both Amphitheater "Popular Entertainment &
Concerts" events): The Revivalists (Aug 14, in-season Week 7) is included
with the Gate Pass; Indigo Girls (Sept 10, post-season) is not.

**Approved heuristic:** *Amphitheater + during the season ⇒ general
admission is available with a Gate Pass.*

---

## #163 — Gate Pass note in the event detail price row

### Logic

New pure helper in `ios/ChqCalendar/Domain/GatePassPolicy.swift`:

```swift
nonisolated enum GatePassPolicy {
    /// Heuristic (see design doc): Amphitheater events during the season
    /// admit Gate Pass holders to general admission. No data source
    /// exposes this, so it is inferred, not read.
    static func includesGeneralAdmission(_ event: Event) -> Bool
}
```

True iff **both**:

1. `event.displayLocation` compares case-insensitively equal to
   `"Amphitheater"`.
2. `event.start` falls within the season for its own year:
   `weeks.first.start <= start < weeks.last.end` using
   `SeasonCalendar.weeks(forYear:)` (year taken from `event.start` in
   `ChqTime.calendar`). Season dates are used instead of the decoded
   `week` field so the rule cannot silently diverge from the sidecar's
   week tagging.

Known edge: season weeks run noon-Saturday to noon-Saturday, so an
opening-Saturday *morning* Amphitheater event falls outside `week1.start`
and gets no note. Rare and fail-safe (we omit a claim rather than make a
wrong one), so accepted.

### UI

In `EventDetailView`'s existing ticket row (`detailRow(icon: "ticket")`),
below the cost text, when the helper returns true:

```
🎟  $71 – $161
    General admission included with a Gate Pass
```

Caption font, secondary color — same pattern as the venue-address subline
in the location row. The note renders only when the row renders (i.e.
`event.cost != nil`); free/no-cost events are unaffected. When the
helper is false the row is unchanged. No list-view change.

### Tests

`GatePassPolicyTests`: Amphitheater in-season → true (Revivalists-shaped
fixture); Amphitheater post-season → false (Indigo-shaped, Sept 10);
non-Amphitheater in-season → false; case-insensitivity
(`"amphitheater"`); boundary dates (at `week1.start`, just before
`week9.end`, at `week9.end`); `displayLocation == nil` → false.
Detail-view rendering covered at the state level (note visibility is a
pure function of the event fixture).

### Out of scope

Web frontend (doesn't display cost at all today); backend/pipeline (no
new data needed); any per-event scraped access data.

---

## #162 — Dates drawer: When options + week range strip

Two changes to `DateFilterSheet`, per approved decisions:

### A. "When" options become Now · Today · All Season · All Year

`DateScope` changes:

| Case | Raw value | Label | Change |
|---|---|---|---|
| `.next` | `next` | Now | unchanged |
| `.today` | `today` | Today | unchanged |
| `.season` | `season` | All Season | **new** |
| `.all` | `all` | All **Year** | label only |
| `.thisWeek` | `this-week` | This Week | **removed from sheet UI**; case kept |

- `.season` filtering in `EventFilter.apply`: keep events with
  `weeks.first.start <= event.start < weeks.last.end`. Like other
  scopes it is forced to `.all` for non-current years (existing
  `isCurrentYear` collapse; the sheet already shows only "All" for
  past/future years, now labelled "All Year").
- `.thisWeek` survives as a decodable case so persisted selections keep
  filtering exactly as before, but the sheet no longer offers it — the
  week strip covers it. `AppModel.selectWeek`'s special case that mapped
  "tap the current week" to `.thisWeek` is removed: tapping the current
  week now selects that week like any other (uniform strip semantics).
  `FilterChipState`'s current-week ⇄ `.thisWeek` equivalence stays, so a
  persisted `.thisWeek` highlights the current week's segment.
- `DateFilterLabel`: `.season` → "All Season"; `.all` → "All Year"
  (replacing the special-cased "All Dates"; "All Year" vs "All Weeks" is
  unambiguous, which was the reason for the special case). Existing
  week-range labels ("Weeks 3–6") already fit the new selection model.

`DateScope` gains a case — decoding of previously persisted values is
unaffected (all old raw values still exist).

### B. Weeks become a single-row range strip

The 3×3 `LazyVGrid` of `SheetChip`s is replaced by **`WeekRangeStrip`**
(`ios/ChqCalendar/Features/Filters/WeekRangeStrip.swift`): one
horizontal bar, 9 equal segments labelled `1`–`9`, rendered as a single
joined control (segments share one rounded container; the selected run
is one continuous accent capsule). This is deliberately a *range* look,
not nine buttons.

**Selection model (approved):** a week selection is now a single week or
one contiguous range. `FilterSelection.selectedWeeks` stays `Set<Int>`
(no schema/persistence change); the strip is what enforces contiguity.
A persisted non-contiguous set still renders (each run highlighted) and
still filters — the first touch of the strip replaces it wholesale.

**Gesture:** one `DragGesture(minimumDistance: 0)` over the bar.

- Touch-down: segment under the finger becomes the **anchor**; provisional
  selection = that week.
- Drag: provisional selection = `min(anchor, current)...max(anchor, current)`
  where `current` is the segment under the finger. Sliding 3→8→back to 6
  yields 3–6 (the range tracks the finger; it shrinks when you retreat).
  Finger positions clamped to the bar's bounds.
- Touch-up: commit.
  - If `anchor == current` **and** that single week already equals the
    entire current selection → deselect (toggle off, back to no week
    filter).
  - Otherwise → selection becomes the provisional range.
- Provisional state is view-local (`@State`); `AppModel` (and thus
  filtering/persistence) is updated **once, on commit** — no re-filtering
  at drag frequency.

**Model API:** `AppModel.selectWeek(_:)`'s four-branch toggle logic is
replaced by `AppModel.setWeekSelection(_ weeks: Set<Int>)` — sets
`selectedWeeks` and **unconditionally** sets `dateScope = .all` (amended
during final review: an empty commit must also return the scope to
`.all`, otherwise a user arriving with a persisted `.thisWeek` scope gets
a dead tap when deselecting the highlighted current week); scope
selection still clears weeks (`selectScope` unchanged). The pure geometry/reduction logic —
x-offset → segment index, anchor+current → range, commit semantics —
lives in a small testable struct (`WeekStripDrag`), not in the view.

**Sheet-gesture interaction:** the strip claims touches that start on it
(minimum distance 0), so the medium-detent sheet cannot be drag-dismissed
*from the strip itself*; everywhere else on the sheet still works. This
is the standard trade-off for slider-like controls in sheets and is
accepted.

**Current-week marker + past-week dimming (user amendment, added during
execution):** with "This Week" gone from the When row, the current week
must be unmissable. Below the bar, a second 9-cell row of equal flexible
widths carries a small up-pointing triangle plus a "Current Week" caption
(accent-colored) in the current week's cell; the current segment's digit
renders accent/semibold when unselected. Weeks already gone by render
their digits dimmed (`.tertiary`) but stay fully **selectable** — dimmed
means "gone by," not "disabled." State comes from the pre-existing,
already-tested `WeekStripState.timeState(week:now:weeks:)` (revived from
orphanhood; its stale "referenced by nothing" comment updated), with
`now = nil` off the current year so past seasons render neutrally with no
marker — including September of the current year, where all nine weeks
dim and no marker shows.

**Accessibility:** the strip exposes its 9 segments as children — each a
button "Week N" with the selected trait; VoiceOver activation performs
single-select (same as tap commit). Each segment additionally offers a
custom action "Extend selection to week N" that widens the existing
selection into a contiguous range covering N (no-op wording when nothing
is selected: plain selection). Dynamic Type: bare digits at 44 pt min
height; verified against the sheet's existing `accessibility3` preview.

### Tests

- `WeekStripDrag` logic: x→segment mapping (including clamped
  out-of-bounds), anchor/current reduction for rules 1–3 from the issue,
  toggle-off commit, replace-non-contiguous commit.
- `EventFilter`: `.season` includes in-season events and excludes
  pre/post-season ones; non-current-year collapse to `.all` unchanged.
- `DateScope`: decoding of all raw values incl. new `season` and legacy
  `this-week`.
- `DateFilterLabel`: "All Season", "All Year" cases; existing range
  labels unchanged.
- `AppModel`: `setWeekSelection` forces `.all` scope; `selectScope`
  clears weeks; removal of the current-week→`.thisWeek` mapping.
- Updated: `FilterChipStateTests`, `WeekStripStateTests` (superseded
  logic), `DateFilterLabelTests`, `FilterSelectionTests`.

---

## #158 — Bus & Tram Tracker link

Approved placement: iOS More menu **and** web header (the two are
documented as intentionally kept in sync in `AboutInfo.swift`).

- iOS: append to `AboutInfo.quickLinks`:
  `Link(id: "bus-tram-tracker", title: "Bus & Tram Tracker", url: "https://busandtramtracker.chq.org")`.
  The More (ellipsis) menu in `EventListView` renders via `ForEach` — no
  view change. Update `AboutInfoTests` (it pins exact ids/titles/urls and
  links/quickLinks disjointness).
- Web: add the same link as a button in **both** branches of
  `frontend/src/components/layout/Header.tsx` (desktop row + mobile More
  dropdown), matching the existing `window.open` pattern; update
  `Header.test.tsx`.
- Ordering: after Programs/Questions (Feedback, Programs, Questions,
  Bus & Tram Tracker) in both clients.

---

## Delivery & compliance

| PR | Branch | Content |
|---|---|---|
| 1 | `feat/158-bus-tram-link` | iOS quickLinks + web header + tests |
| 2 | `feat/163-gate-pass-note` | `GatePassPolicy` + detail-row note + tests |
| 3 | `feat/162-week-range-strip` | `DateScope.season`, `WeekRangeStrip`, `setWeekSelection`, sheet rework + tests |

Each PR follows the App Store listing rule (CLAUDE.md):

- **#162** changes the filter sheet and **#163** changes the detail view —
  both visibly; regenerate screenshots
  (`ios/Scripts/capture-screenshots.sh` + `compose-screenshots.py`) and
  commit manifest/review copies. If the shot list doesn't cover the
  changed screen, use the documented opt-out wording.
- **#158**'s change is inside the closed More menu; expected opt-out:
  `[skip-screenshots: link added inside More menu; no covered shot shows the open menu]`
  (verify against `ios/Scripts/screenshot-plan.json` at implementation
  time).
- Re-read `docs/app-store/listing-copy.md` in PR 3 — if it describes the
  week filter, the wording may need updating.

Verification per repo checklist: `cd frontend && npm run build`,
`cd backend && npm run validate && npm run build` (PR 1 only, web half),
and the iOS test suite for all three PRs.
