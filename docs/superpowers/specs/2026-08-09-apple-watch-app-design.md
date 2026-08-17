# Apple Watch companion app — feature brainstorm

**Issue:** #194 — iOS: Create Apple Watch app
**Status:** Brainstorm / design proposal. No code written. Not yet approved.
**Date:** 2026-08-09

---

## 1. The test this has to pass

The bar the user set: *"If I install this on my watch, it should be worth the
time it takes to install, and clearly useful."*

That is a harsher bar than it sounds, because a watch app competes for two
scarce resources a phone app does not:

1. **A complication slot on the watch face.** There are maybe 4–8 of them and
   the user already has favorites. Ours has to beat Weather.
2. **The user's wrist.** Every notification we send is a physical tap on a
   person's body. Getting that wrong is worse than not shipping.

And the app is only relevant **9 weeks a year** (late June → late August).
That is 17% of the calendar. A complication that shows nothing for the other
43 weeks gets deleted in September and never comes back.

So the design has to answer two questions honestly, not one:

- What makes this genuinely useful *during* the season?
- What does it do the rest of the year so it survives to next June?

---

## 2. What the watch is uniquely good at, at Chautauqua specifically

Chautauqua is an unusual venue and it maps onto the watch's strengths almost
suspiciously well:

| Property of Chautauqua | Why the watch wins |
|---|---|
| Compact, walkable, gridded grounds (~1 mi across); everything is a 3–15 min walk | Departure timing is the whole game, and it's a *time* problem — the watch's native domain |
| Days are dense: morning lecture, afternoon interfaith, evening Amp show, plus classes and worship | "What's next / when do I leave" is asked a dozen times a day |
| You are outdoors and walking for much of the day; phone is in a bag or back at the house | Wrist beats pocket |
| Amphitheater seats ~4,000; lecture halls and Hall of Philosophy are quiet, attentive rooms | A silent haptic tap is socially acceptable; retrieving and unlocking a phone mid-lecture is not |
| Audience skews older | Large, single-purpose glance UI beats a dense browsing app — *if* we respect Dynamic Type |
| Lots of small free events (Hall of Christ, Smith Wilkes, denominational houses, Bestor Plaza) | Serendipity discovery — "something good is starting 4 minutes from here" — only works with time + location |

And what the watch is bad at, which bounds the scope hard:

- Browsing 1,470 events. **Never do this on the watch.**
- Reading event descriptions, presenter bios, long text.
- Search, typing, multi-facet filtering.
- Maps. The grounds are a grid; a bearing arrow and a distance beat a map tile.

**Design principle: the watch is a "now and next" device, not a browsing
device.** Anything that requires exploration stays on the phone. If a screen
needs a scroll bar to be useful, it belongs on the phone.

---

## 3. What we already have that ports for free

This is the strongest argument for doing it at all — a surprising amount of
the hard logic already exists as pure, `Sendable`, `nonisolated`,
Foundation-only domain code in `ChqCalendarShared/`, with no UIKit dependency
and therefore no watchOS porting problem.

| Existing piece | What it already does | Watch use |
|---|---|---|
| `VenueAtlas` | 54 venues with coordinates; `walkingMinutes(from:to:)` — haversine × 1.3 route factor at 80 m/min, rounded up | The entire "leave now" feature |
| `DayPlan` | A day's starred events with `.fine` / `.tight(walk, gap)` / `.overlap(minutes)` transitions between consecutive items | The Today timeline, and conflict warnings |
| `WidgetTimelineBuilder` | Builds `(date, state)` slices so a widget re-renders exactly at event boundaries with no polling; already emits `.countdown(opening:daysUntil:)` for the off-season | Complications, including the off-season state |
| `NextUpWidget` | Already declares `.accessoryRectangular` and `.accessoryInline` | **Those are watch complication families.** Much of the complication work is already written |
| `ReminderPlanner` | Pure favorites + settings → `[PlannedReminder]`, capped at 60 pending | The shape to copy for departure alerts |
| `SeasonCalendar` | The 9-week noon-to-noon season structure per year | Knowing whether we're in season at all |
| `DaypartSlot` | Identifies the flagship morning lecture and evening Amp show | The morning digest's "here's the big stuff" line, even for unstarred events |
| `SharedSnapshotLoader` | Network-free cached reads that degrade to empty rather than throwing | Exactly the posture a watch app needs |
| `ChqTime` | NY-pinned calendar; DST-correct arithmetic throughout | Prevents a whole category of "leave at 9:59 AM" bugs |
| App Intents (#193) | 7 shortcuts / 27 phrases already shipped | "Hey Siri, what's the evening show?" from the wrist |

Structurally, `ChqCalendarShared` is a `PBXFileSystemSynchronizedRootGroup`
already claimed by the app, test, and widget targets. Adding a watch target
means adding one more membership — no new framework target, no module
restructuring.

**Rough read: 60–70% of the domain logic for the proposed v1 already exists
and is already unit-tested.** The new work is mostly UI, a departure planner,
and a data path.

---

## 4. The uncomfortable finding, stated up front

**iOS local notifications already mirror to a paired Apple Watch when the
phone is locked.** So the two ideas in the issue — "tell me to start walking"
and "remind me of the day's activities in the morning" — could both ship
today with **zero watch code**, as an extension to `ReminderPlanner`, and
they would appear on the user's wrist.

That is not an argument against the watch app. It is an argument about
**ordering**, and it makes the project cheaper and lower-risk:

> Build the departure/digest logic in `ChqCalendarShared` and schedule it from
> **iOS**. Every iPhone user gets it, watch or no watch. Then the watch app
> adds the layer that genuinely cannot be mirrored.

What the watch app adds that forwarding cannot:

1. **Complications.** Ambient, zero-tap, on the face. There is no phone
   equivalent. This is the single biggest reason to install.
2. **Custom notification long-look UI + wrist actions.** A mirrored
   notification is a text blob. A watch-native one can show the walk as a
   visual and offer *Snooze 5* / *Which way?* / *Unstar*.
3. **Independence from the phone.** Mirroring requires the phone to be
   reachable and awake-ish. The watch app works with the phone left at the
   house — which, at Chautauqua, is a real and common state.
4. **Discretion.** In an Amp audience of 4,000, or the Hall of Philosophy, a
   wrist tap is invisible. Retrieving a phone is not.

There is also a **strategic** benefit worth naming. The app was rejected under
App Store Guideline 4.2 in August 2026 for having no meaningful iOS-only
capability beyond a write-only EventKit call (see
`docs/plans/2026-08-07-app-store-4.2-rejection-response.md`). A watch app with
complications, wrist haptics tied to on-grounds walking time, and (Tier 2)
on-demand location is a materially stronger 4.2 story than anything currently
in the app. That is a side benefit, not a justification — but it is real.

---

## 5. Proposed features

### Tier 1 — v1, the "glance + alerts" release (approved scope)

No location permission. Everything below runs off time, venue coordinates,
and the user's starred events.

---

#### 1.1 Watch face complications — *"the reason to install"*

The primary surface. Shows the next relevant event and, critically, the
**leave-by time** — not just the start time.

| Family | Content |
|---|---|
| `.accessoryRectangular` | 3 lines: `10:45 AM · Amphitheater` / event title / `Leave 10:29 · 9 min walk` — the best of the four |
| `.accessoryInline` | `10:45 Amp · leave 10:29` |
| `.accessoryCircular` | Countdown ring draining toward leave-time, with the start time in the center |
| `.accessoryCorner` | Start time with venue as curved text |

Reuses `WidgetTimelineBuilder` almost as-is: the timeline rolls over at known
event boundaries, so the complication updates on schedule without burning
watchOS's limited background refresh budget. That pattern is already correct
in the codebase — this is the payoff for having written it that way.

Configuration reuses the existing `WidgetConfigIntent` (venue / category /
starred-only), so a user can pin a complication to "next Amp event" or "my
starred events only".

**Why it's useful:** it answers the day's most-asked question with zero taps,
while you're mid-conversation on Bestor Plaza.

**Off-season:** falls through to `.countdown(opening:daysUntil:)` — *"Chautauqua
opens in 214 days."* Not blank, not embarrassing, and it survives to next June.

---

#### 1.2 "Leave now" departure alerts — *the issue's first idea*

A haptic tap at the moment you should start walking.

```
leaveBy = eventStart − arrivalBuffer(venue) − walkMinutes(origin → venue, pace)
```

Three pieces of new design are required, and each one matters:

**Origin.** Where are you walking *from*?
- If a previous starred event ends before this one, its venue is the origin.
- Otherwise (the first event of the day, or a long gap), use a **Home Base** —
  a venue the user picks once from `VenueAtlas`, or a dropped pin for their
  rental house. This is a new persisted setting, **promoted to its own issue
  (#198)**: it turns out to be worth more to the iOS app than to the watch
  (My Day's first row, walk times on event detail, and a "near my place" sort
  that needs no location permission at all), and it should land first and
  independently.
- If either end can't be resolved, **send nothing.** Fail-safe by omission,
  matching the principle already established in `GatePassPolicy` — never
  fabricate a walk time we can't compute.

**Pace.** `VenueAtlas` hardcodes 80 m/min ("brisk"). Chautauqua's audience
skews well older than that assumption. A 12-minute walk at brisk pace is 17
minutes at a leisurely one — on a campus where most walks are 4–15 minutes,
that is the difference between arriving and missing the opening. Propose a
`WalkingPace` setting: Leisurely (~55 m/min) / Moderate (~70) / Brisk (80,
today's behavior and the default, so nothing changes for existing users).

**Arrival buffer.** Showing up at the Amphitheater at 10:45 for a popular
10:45 lecture means standing. People queue for Amp seats. Propose a default
5-minute buffer, with 15 minutes for the Amphitheater specifically, both
user-adjustable.

**Watch-native long-look:** the walk rendered as a visual, plus actions —
*Snooze 5 min*, *Which way?* (Tier 2), *Not going* (unstars).

**One alert per event.** No nagging, no "last call" follow-up in v1.

**Why it's useful:** this is the single highest-value thing the app can do.
Nobody at Chautauqua misses events because they forgot they existed — they
miss them because they lost track of *when to stand up and start walking*.

---

#### 1.3 Morning digest — *the issue's second idea*

One notification, around 7:00 AM (user-settable), during the season only:

> **Today at Chautauqua · Week 5 — "The Future We Make"**
> 3 starred events. First: Amphitheater, 10:45.
> Also today: Amp lecture 10:45, evening show 8:15.
> ⚠️ Hall of Philosophy at 2:00 is a 12-min walk and you have 5.

Three deliberate choices:

- It names the **week's theme** (`ThemeWeek` / `WeekThemeSummary` exist).
- It surfaces the **flagship daypart events even if unstarred** — `DaypartSlot`
  already identifies the morning lecture and evening show. Someone who starred
  nothing still gets told what the day's two big things are. This is what makes
  the digest useful to a casual attendee rather than only to a planner.
- It **front-loads conflicts.** `DayPlan` already computes `.tight` and
  `.overlap`. Telling you at 7 AM that your 2 PM is impossible is worth more
  than telling you at 1:55 PM.

**Silent, off-season.** No digest between Labor Day and late June. An app that
buzzes your wrist in February to say "nothing today" gets uninstalled.

---

#### 1.4 The Today screen — *the app itself*

Opening the app lands directly on today. No tab bar, no navigation stack to
climb.

- A **hero card** for the current or next event: time, venue, leave-by,
  walking time, cancelled/rescheduled badge.
- Below it, the rest of today's starred events as a short vertical list —
  typically 2–5 rows, which is exactly the length the watch handles well —
  with `DayPlan`'s transition annotations rendered inline (`9 min walk` /
  `⚠️ tight` / `⚠️ overlaps`).
- Crown-scroll to tomorrow. **Two days, that's the limit.** Anything beyond
  tomorrow is a browsing task and belongs on the phone.
- Tap a row → a compact detail: full title, venue, presenter, star toggle,
  and *Open on iPhone* via Handoff (`NSUserActivity` + the existing `DeepLink`
  type).

**Why it's useful:** it's the "am I where I should be?" check, taken during a
conversation without breaking eye contact.

---

#### 1.5 Star from the wrist

Toggle a star from a Today row or from a notification action. Syncs back to
the phone.

Deliberately **not** a discovery flow — you cannot browse to find things to
star on the watch. This exists so that when a friend says "the 4 o'clock at
Smith Wilkes is supposed to be good," you can act on it in two seconds without
digging out a phone.

---

#### 1.6 Siri on the wrist

#193 shipped 7 shortcuts and 27 phrases. Those App Intents currently live in
`ChqCalendar/Intents/` (app target), not in `ChqCalendarShared/`. Moving the
intent definitions into shared source lets the watch app vend them.

*"Hey Siri, what's the evening show?"* while walking down Bestor Plaza,
hands full, phone in a bag, is one of the best uses of a watch there is — and
the vocabulary work is already done and already tested.

Low cost, high value. Mostly a file move plus a target membership.

---

### Tier 2 — location-enabled, on-demand only (approved in principle, ship after v1)

Both features below use `CLLocationManager` **only while the relevant screen is
open**. No background location, no geofences, no always-on tracking. Note that
this would be the **product's first location permission ever** — the existing
`GroundsMapView` is a static annotated map with no user-location dot and no
`NSLocation*` key in the Info.plist. So the permission string and the moment we
prompt both deserve care.

#### 2.1 "Near Me Now"

> *Starting soon, close to you:*
> **2:15 · Hall of Christ** — Brown bag talk · 4 min walk
> **2:30 · Smith Wilkes Hall** — 7 min walk

Events starting in the next ~45 minutes at venues within a ~6-minute walk,
ranked by walk time. Pure function over `(coordinate, events, now,
maxWalkMinutes)` — trivially testable, no new data.

**Why it's useful:** Chautauqua's real texture is the dozens of small free
events most attendees never learn about. This is the serendipity feature, and
it's genuinely only possible with time *and* location together — which is to
say, it's the most watch-native idea in this document.

#### 2.2 "Which way?"

A bearing arrow plus distance — *"Norton Hall · 350 ft · ↗"* — not a map.
The grounds are a walkable grid; you need a direction and a distance, not a
rendered tile you'll squint at. Cheaper, faster, more legible, and better on
battery than MapKit on a watch.

Reachable from a departure notification's long-look and from the Today detail.

---

### Considered and rejected

| Idea | Why not |
|---|---|
| Full event browsing / search / filters on the watch | 1,470 events. This is the phone's job, and doing it badly on the watch would make the app feel worse, not better |
| Event descriptions, presenter bios, images | Long-form reading on a 1.9" screen |
| The grounds map as an actual map | A bearing + distance is more useful and far cheaper (see 2.2) |
| Weather / rain alerts for open-air Amp events | Genuinely tempting — the Amphitheater is open-sided and rain changes plans. But it isn't our data domain, and a wrong forecast on our wrist tap is worse than no forecast. Revisit only if WeatherKit proves cheap |
| Gate pass / ticketing | No data. `GatePassPolicy` is an admission *heuristic*, not a ticket |
| Step count / workout integration | People do walk a lot here. Still not our domain |
| Background geofenced "you haven't left yet" nudges | User declined; also the worst option for battery and App Store review |
| A watch-only complication with no app | Rejected by the scope decision — a complication alone is thin justification for an install, and it can't own the notification long-look |

---

## 6. Data path — the one real technical problem

The watch cannot read the iOS App Group container. `AppGroup` +
`SharedSnapshotLoader` are how the widget shares data with the app; that
mechanism stops at the device boundary.

And the obvious fallback is worse than it looks. **`all-events.json` is
10,147,775 bytes, and CloudFront appears to serve it uncompressed** — verified
2026-08-09: an explicit `Accept-Encoding: gzip` request returned the same byte
count with no `content-encoding` header. Ten megabytes over a watch's Wi-Fi or
LTE is not an acceptable routine path.

*(Aside worth its own issue: 10 MB uncompressed is a web and iOS cost too,
not just a watch problem. Enabling compression on that object looks like a
cheap, broad win.)*

**Recommended: the phone is the source of truth; the watch caches a slim
slice.**

- The iOS app projects the next ~10 days to a `WatchEventSummary`
  (`id`, `title`, `venueID`, `start`, `end`, `isFavorite`, `isCancelled`) plus
  favorites, reminder/pace settings, and Home Base.
- Estimated payload: ~250 events × ~120 bytes ≈ **30 KB** — comfortably inside
  `WCSession.updateApplicationContext`. Use `transferUserInfo` for favorite
  toggles that must not be dropped.
- The watch **persists it to its own container** and always renders from cache
  first. Grounds Wi-Fi is congested in season; a watch that shows nothing when
  the phone is out of range has failed at exactly the moment it's needed.
- Same posture as `SharedSnapshotLoader`: missing or corrupt data degrades to
  "nothing to show yet", never an error state.

**Possible follow-up (backend):** publish a `watch-slice.json` sidecar — next
14 days, slim fields — from the same hourly Lambda that already builds the
article-links sidecar. That would make a genuinely standalone watch app viable
(works with the phone off entirely) and is a small change to an existing
pipeline. Not required for v1.

---

## 7. New shared-domain pieces this implies

All pure, all `nonisolated` / `Sendable`, all unit-testable with no I/O —
following the conventions already established in `ChqCalendarShared/Domain/`:

| Type | Responsibility |
|---|---|
| `WalkingPace` | Leisurely / Moderate / Brisk → m/min. Add a `pace:` overload to `VenueAtlas.walkingMinutes` defaulting to `.brisk`, so the existing signature and its tests are untouched |
| `ArrivalBuffer` | Per-venue arrival padding; Amphitheater defaults higher |
| `HomeBase` | A venue ID or a coordinate, persisted via `UserStateStore` |
| `DeparturePlanner` | `(DayPlan, HomeBase, WalkingPace, buffers, now) → [PlannedDeparture]`. Mirrors `ReminderPlanner`'s shape deliberately |
| `DailyDigest` | `(day's events, favorites, themes, now) → digest content`, including unstarred `DaypartSlot` flagships |
| `WatchPayload` | The `Codable` slim projection and its versioning |
| `NearbyFinder` *(Tier 2)* | `(coordinate, events, now, maxWalkMinutes) → ranked nearby events` |

---

## 8. Risks and constraints

1. **The 64-notification cap is now shared.** `ReminderPlanner` already
   budgets 60 pending to stay under iOS's 64 limit. Departure alerts draw from
   the *same* pool. `DeparturePlanner` and `ReminderPlanner` must be planned
   **together** against one combined budget, or a heavily-starred week silently
   drops reminders. This is the most likely subtle bug in the whole project.
2. **Notification fatigue.** Digest + reminder + departure alert for the same
   event is three taps for one lecture. Needs an explicit coalescing rule —
   probably: if a departure alert exists for an event, suppress its 30-minute
   reminder.
3. **Complication refresh budget.** watchOS limits background refreshes.
   Mitigated by the existing `WidgetTimelineBuilder` pattern (roll at known
   event boundaries, don't poll) — we already do this correctly.
4. **Connectivity in season.** Congested grounds Wi-Fi. Cache-first is
   mandatory, not an optimization.
5. **Accessibility.** Older audience, small screen. Dynamic Type and high
   contrast are requirements, and the 3-line `.accessoryRectangular` layout
   must degrade gracefully at the largest text sizes rather than truncating the
   leave-by time — which is the one line that matters most.
6. **App Store process gap.** A watch app needs its own screenshot set in App
   Store Connect. `ios/Scripts/screenshot-plan.json` and
   `capture-screenshots.sh` don't cover watchOS simulators, and the
   `app-store-assets.yml` guard won't catch that gap. Extending the shot list
   is part of the work, not an afterthought.
7. **Off-season survival.** Covered above, but worth restating as the risk it
   is: the countdown state is what keeps the complication on the face through
   ten months of irrelevance.

---

## 9. Suggested build order

Each step is independently shippable and independently useful, which keeps the
risk low and means we can stop at any point with something worth having.

1. **Shared domain first** — `WalkingPace`, `ArrivalBuffer`, `HomeBase`,
   `DeparturePlanner`, `DailyDigest`, plus the combined notification budget.
   Pure code, fully testable, no watch target needed yet.
2. **iOS-only departure alerts + morning digest.** Ships value to *every*
   iPhone user immediately, watch or not, and de-risks the logic before any
   watch code exists.
3. **Watch target + `WatchPayload` sync.** Plumbing only.
4. **Complications.** The install-justifying feature. Largely a reuse of
   `WidgetTimelineBuilder` and `NextUpWidget`'s accessory families.
5. **Today screen + star toggle + Handoff.**
6. **Watch-native notification long-look and actions.**
7. **Siri intents moved to shared, vended on watch.**
8. **Tier 2: Near Me Now + Which Way** (location permission introduced here,
   in its own release, with its own permission-prompt design).

---

## 10. Open questions

- ~~**Home Base UX.**~~ **Resolved 2026-08-09 → #198.** Both: a searchable
  pick from the 54 `VenueAtlas` venues *and* a labeled dropped pin on the Map
  tab, plus an explicit "not staying on the grounds" case. Prompted
  contextually (never at first launch) and re-confirmed once per season.
- **Digest time.** Fixed 7:00 AM default, or derived from the day's first
  starred event?
- **Should departure alerts apply to unstarred flagship events?** The digest
  surfaces them; should the app also tap your wrist for a 10:45 Amp lecture
  you never starred? Leaning no — unsolicited haptics are the fastest route to
  an uninstall.
- **watchOS deployment target.** The iOS app is already on iOS 18 (raised in
  #151). watchOS 11 is the natural pairing; worth confirming against the
  actual audience's hardware, which likely skews to older watches.
- **Does the `watch-slice.json` sidecar (§6) earn its place in v1?** It's the
  difference between "works with the phone in the room" and "works with the
  phone at home."
