# iOS Siri Interaction Vocabulary — Design

**Date:** 2026-08-09
**Issue:** [#193 — iOS: improve Siri interaction vocabulary](https://github.com/bbernstein/chq-calendar/issues/193)
**Status:** Approved design, pending implementation plan
**Target release:** 1.2 (explicitly NOT 1.1 — the 1.1 archive/submission for the
App Store 4.2 response proceeds unchanged; this lands on `main` for the next
version)

## Goal

Make Siri genuinely useful for questions Chautauquans actually ask, e.g.:

- "What's happening this week at Chautauqua?"
- "What is playing in the Amp this week?"
- "What is the next symphony concert?"
- "What am I doing tomorrow?"
- "What movies are playing?"
- "What is the theme this week / week 7?"
- "Who is speaking tomorrow?"
- "What time is the evening show tomorrow?"

## Platform constraint (shapes everything)

Classic App Shortcuts only match **pre-registered phrase templates**. Each
phrase must contain the app's name (or a declared alternative name), and a
phrase can only embed a parameter whose values Siri knows ahead of time (an
`AppEnum` or a pre-declared entity list). Free-form natural language does not
reach the app. "Making Siri useful" therefore means:

1. A smart set of **parameterized phrase templates**.
2. Rich **synonym vocabularies** for the parameter slots (kind of event,
   timeframe, venue).
3. **Alternative app names** so the required app-name mention feels natural.

Siri tolerates minor filler-word variation but not structural rewording, so
each template family enumerates the realistic orderings explicitly (cheap to
add; the implementation plan lists them exhaustively).

## App name vocabulary

Declare via `INAlternativeAppNames` in the app target's Info.plist (hard limit
3 per localization; each entry is a dict with `INAlternativeAppName` and
optional `INAlternativeAppNamePronunciationHint`). The `\(.applicationName)`
token in App Shortcut phrases automatically matches all of them:

| Name | Why |
|---|---|
| `Chautauqua` | Enables "…at Chautauqua" — the natural phrasing in every example above |
| `Chautauqua Calendar` | Natural full form |
| `CHQ` | Short form |

Phrase templates are written with both "in" and "at" prepositions where
natural, so "…at Chautauqua" and "…in CHQ Calendar" both work.

Caveats (recorded, accepted):

- **App Review risk (low):** alternative names are reviewed; "Chautauqua" is
  the institution's name and the app is unofficial (same content-rights
  sensitivity as the 4.2 history). If Review objects, drop that one entry —
  the feature degrades gracefully.
- Users cannot say a bare "What's happening at Chautauqua?" with **no**
  app-name token at all — but "…at Chautauqua" *is* the app-name token once
  the alternative name is declared, which is the point.
- If another installed app also claims "Chautauqua", Siri disambiguates on its
  own; nothing to handle app-side.

## Vocabulary & mapping (`EventKind`)

The controlled vocabulary lives in **`ChqCalendarShared`** as pure,
unit-testable code (like `EventFilter`), separate from the AppIntents types.
Each kind carries spoken synonyms and a matching rule over `filterTokens`
(lowercased tags + category names, already on every cached `Event`) and
`displayLocation`.

| Kind | Synonyms (spoken) | Matches |
|---|---|---|
| lecture | lectures, talks, speakers | tokens: `chautauqua lecture series`, `interfaith lecture`, `special lectures`, `chautauqua literary and scientific circle (clsc)`, `master class` |
| symphony | CSO, classical concert, orchestra | tokens: `chautauqua symphony orchestra/classical concerts`, `chautauqua chamber music` |
| concert | shows, performances, music, entertainment | tokens: `popular entertainment & concerts`, symphony tokens, `school of music` |
| movie | movies, films, cinema | token `movies` OR venue `Chautauqua Cinema` |
| opera | operas | token `opera` |
| theater | plays, drama | token `theater` (venue Bratton reinforces) |
| dance | ballet | token `dance` |
| worship | church services, religious services, sacred song | tokens: `faith and spiritual programming`, `service`, `weekly chaplains` |
| recreation | sports, activities, fitness | token `recreation` |
| family | kids, youth, children's | token `youth programs and activities` |

Notes:

- **Case display titles use the natural plural spoken form** ("movies",
  "lectures", "concerts") because titles are baked verbatim into generated
  Siri utterances (spike finding 3); singular forms and other variants go in
  the case's `synonyms`. The table's Kind column names the concept, not the
  final title string.
- Token strings above are the lowercased category-name forms observed in the
  live 2026 feed; the implementation matches against `filterTokens` (which
  contains both slug and name forms) and should prefer slug forms where those
  are stabler (e.g. `interfaith-lecture`). Verify at implementation time.
- **Generic-word heuristic:** generic words ("show", "performance") are
  synonyms of broad kinds (→ concert) rather than a separate mechanism.
- **Flagship-venue ranking:** when a kind matches many events, flagship venues
  (Amphitheater, Hall of Philosophy, Norton Hall, Bratton Theater, Lenna
  Hall) rank first — so "what's the next lecture" answers the 10:45 Amp
  lecture, not a porch chat.

### Timeframe vocabulary

`today`, `tonight` (today from 5 PM), `tomorrow`, `this week`, `next week`,
`week 1`–`week 9` — resolved in NY time via `ChqTime`/`SeasonCalendar`, the
same week numbering the app already uses. Absent timeframe on a "next ⟨kind⟩"
phrasing → search forward from now, unbounded.

### SDK spike findings (resolved 2026-08-09)

Verified against the installed iOS 26.5 SDK (Xcode 26.6) by compiling a spike
`AppEnum` + parameterized shortcut inside the real app target and inspecting
the exported `Metadata.appintents`:

1. **Synonyms attach directly to `AppEnum` cases** —
   `DisplayRepresentation(title:synonyms:)`, available iOS 17+ (app targets
   iOS 18, so usable everywhere). No alias cases, no `AppEntity`
   workaround. Synonyms export per-case into the app's AppIntents metadata
   (verified in `extract.actionsdata`), which Siri ingests for slot
   matching. `TypeDisplayRepresentation(name:synonyms:)` likewise.
2. **A phrase can contain exactly ONE parameter.** Authoritative: a
   two-parameter phrase passes `swiftc` but `appintentsmetadataprocessor`
   halts the build — "Multiple parameters detected in phrase. A single
   phrase can only use a single parameter." This reshapes the phrase
   templates (see intent surface below): each spoken utterance parameterizes
   one slot (kind OR timeframe OR venue); combined constraints by voice in a
   single utterance are not possible.
3. **Enum case display titles are baked verbatim into the pre-generated Siri
   utterances** (decompressed `nlu.lzfse` shows e.g. "What movie are playing
   in CHQ Calendar" for case title "movie"). Consequence: case titles must
   be the natural plural spoken forms ("movies", "concerts", "lectures") so
   generated utterances read grammatically; singular forms go in synonyms.
4. **Venue as a phrase slot requires an `AppEntity`** (plain `String`
   parameters cannot appear in phrases), with values published via
   `AppShortcutsProvider.updateAppShortcutParameters()` — which the app does
   not currently call; the implementation adds it after each feed load.
   Venue synonyms ("the Amp") ride on the entity's
   `displayRepresentation.synonyms`.
5. `INAlternativeAppNames` is a runtime/install-time plist mechanism —
   nothing to verify at build time; it stays the riskiest item on the
   on-device checklist.

## Intent surface

Existing three intents stay. `NextEventsIntent` gains parameters; two new
intents join. Total **5 App Shortcuts** (system cap 10), each with ~4–8 phrase
templates.

### 1. `NextEventsIntent` (extended) — optional `kind`, `timeframe`, `venue`

One parameter slot per phrase (spike finding 2), so the phrase families each
parameterize a single slot; the other parameters stay unset and the intent
answers with its default scope (upcoming-from-now). Literal words cover the
most common fixed variants (e.g. a literal-"tonight" phrase family), since
literals are free — only *parameters* are limited to one.

- Kind-parameterized (timeframe defaults to upcoming):
  - "What ⟨movies⟩ are ⟨playing|on⟩ ⟨in|at⟩ ⟨Chautauqua⟩"
  - "What's the next ⟨symphony⟩ ⟨in|at⟩ ⟨Chautauqua⟩"
  - "What ⟨movies⟩ are playing ⟨tonight|today|tomorrow|this week⟩ …" —
    literal time words in otherwise kind-parameterized phrases; the intent
    receives only `kind`, so the *spoken answer* still scopes to upcoming.
    Deliberately few of these to avoid promising precision the slot can't
    deliver; the dialog states the timeframe it actually used.
- Timeframe-parameterized (kind unset → everything):
  - "What's ⟨happening|coming up⟩ ⟨this week⟩ ⟨in|at⟩ ⟨Chautauqua⟩"
- Venue-parameterized (kind/timeframe unset):
  - "What's ⟨playing|happening⟩ ⟨in the Amp⟩ ⟨in|at⟩ ⟨Chautauqua⟩" — venue
    entity with synonyms ("the Amp", "the Amphitheater")
- Fixed phrases (no slot):
  - "Who is ⟨speaking|performing⟩ ⟨today|tomorrow⟩ ⟨in|at⟩ ⟨Chautauqua⟩" —
    literal day words; kind implied (lecture); dialog leads with presenter;
    covers "who is giving the 2:00 lecture"
  - "What time is the ⟨evening show|morning lecture⟩ ⟨in|at⟩ ⟨Chautauqua⟩" —
    literal day-part phrases mapping to flagship-venue lookups

### 2. `WeekThemeIntent` (new) — optional `week` (this week / next week / week 1–9)

- "What's the theme ⟨this week|week 7⟩ at ⟨Chautauqua⟩"
- Reads the already-cached weekly-themes sidecar.
- Dialog: "Week 7 (August 8–15): ⟨title⟩."

### 3. `MyScheduleIntent` (new) — optional `timeframe` (default today)

- "What am I doing ⟨tomorrow⟩ at ⟨Chautauqua⟩"
- "What's on my ⟨schedule|plan⟩ ⟨today⟩ in ⟨Chautauqua⟩"
- Reads starred event IDs from the App Group (same data the StarredWidget
  uses), intersected with the timeframe.

`TodayEventsIntent` and `OpenEventIntent` keep their current phrases.

## Data flow & selection engine

Unchanged pattern: intents run against the on-disk App Group cache
(`IntentDataSource` → `SharedSnapshotLoader`), no network, works with the app
cold. New logic:

- **`ChqCalendarShared/Domain/EventKindFilter.swift`** — kind → predicate,
  synonym tables, flagship-venue ranking. Pure statics.
- **`IntentDataSource.select(kind:timeframe:venue:now:)`** — composition over
  the cache read, same shape as `selectUpcoming`/`selectToday`, injected
  `now`.
- **`IntentDialogText.swift`** — dialog strings built by pure functions
  returning `String`, so every spoken shape is unit-testable.

### Spoken answer shapes

Dialog is a one-liner; the full match list is returned as `[EventEntity]`
(existing convention — Shortcuts automations can consume it).

- Single/next match: "Next ⟨symphony⟩: ⟨title⟩, ⟨Tuesday⟩ at ⟨8:15 PM⟩ in the
  ⟨Amphitheater⟩."
- "Who is speaking": leads with presenter when present: "⟨Presenter⟩ speaks
  ⟨tomorrow⟩ at ⟨10:45 AM⟩ in the ⟨Amphitheater⟩: ⟨title⟩."
- List answer: "⟨4 concerts⟩ ⟨this week⟩ — first: ⟨title⟩ ⟨Tuesday 8:15 PM⟩."
  (count + first; never a full read-out)
- My schedule: "You have ⟨3⟩ starred events ⟨tomorrow⟩: ⟨t1⟩, ⟨t2⟩, ⟨t3⟩." /
  zero: "Nothing starred for ⟨tomorrow⟩ yet."
- Theme: "Week ⟨7⟩ (⟨August 8–15⟩): ⟨theme title⟩."

### Degraded states

- **No match in timeframe:** "No ⟨movies⟩ ⟨tomorrow⟩." + when a later match
  exists: "Next one: ⟨day⟩ at ⟨time⟩."
- **Off-season:** reuse 1.1 season-boundary knowledge: "The ⟨2026⟩ season has
  ended. Season ⟨2027⟩ hasn't been announced yet." / "…starts ⟨June 27⟩."
- **Cold cache** (Siri before first launch): "Open CHQ Calendar once to load
  the season schedule."
- **Week out of range:** "The season has 9 weeks."

## Discovery UI

- **"Ask Siri" section on the About tab:** example phrases grouped by what
  they answer; one `SiriTipView` for the flagship phrase + plain styled rows
  for the rest (five stacked tips is noisy); `ShortcutsLink` to the app's
  Shortcuts gallery at the bottom. Copy quotes the *spoken* phrases (per the
  existing `ChqShortcuts` doc-comment rule: quote phrases, not titles).
- **Contextual tip:** after the user stars their first event, My Day shows a
  one-time `SiriTipView` for "What am I doing tomorrow at Chautauqua" —
  discovery at the moment the phrase becomes personally useful.
- App Store listing upkeep rule applies at implementation: About-tab changes
  are user-visible → screenshot regeneration + listing-copy re-read per
  CLAUDE.md.

## Testing

Pure logic gets unit tests; AppIntents wiring stays thin (existing split).

- **`EventKindFilter` tests:** every kind's predicate against fixture events
  (per-category tokens, movie-by-venue, flagship ranking, generic-word
  mapping).
- **Timeframe tests:** today/tonight/tomorrow/this-week/next-week/week-N
  boundaries in NY time, DST-adjacent times, off-season dates, week 10.
- **Dialog-text tests:** each shape (single, list, no-match-with-next,
  off-season, cold cache, zero-starred, theme).
- **`MyScheduleIntent` selection tests:** starred-ID intersection with
  timeframes.
- **Existing `IntentSelectionTests`** extend rather than fork.
- **Not automatable:** actual Siri speech recognition. On-device manual
  checklist (same pattern as the 1.1 on-device pass): say each flagship
  phrase, verify recognition; `INAlternativeAppNames` recognition
  ("Chautauqua" alone) is explicitly on the checklist as the riskiest bit.

## Out of scope

- Apple Intelligence / assistant-schema integration (no calendar schema
  exists; revisit when the platform offers one).
- Free-form natural-language matching (platform doesn't allow it).
- Presenter-name parameter slots ("who is speaking" is answered by the
  *dialog* naming the presenter; the user never speaks a presenter name).
- Web/PWA parity (Siri is iOS-only by nature).
