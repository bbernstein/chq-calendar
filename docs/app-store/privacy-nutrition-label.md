# App Store privacy nutrition label — CHQ Calendar

This document is the answer key for App Store Connect's App Privacy
questionnaire. It exists so that whoever fills in that form does not have to
re-derive the reasoning from the codebase — the reasoning is here, with the
evidence that backs it.

**Cross-reference:** these claims must stay in agreement with the public
privacy policy at `https://www.chqcal.org/privacy` (source:
`frontend/src/app/privacy/page.tsx`). If either document changes, change the
other in the same commit. As of this writing they agree: the live `/privacy`
page's "How We Measure Site Traffic" section already states the corrected
posture below (aggregate visitor counting, not "not used for profiling").

---

## Headline answer

**In App Store Connect, App Privacy → "Do you or your third-party partners
collect any data from this app?" → answer Yes.**

Select **only**:

| Data type | Linked to you? | Used for tracking? |
|---|---|---|
| Usage Data → Product Interaction | **No** (Not Linked to You) | **No** (Not Used for Tracking) |

Everything else on Apple's data-type list (Contact Info, Health & Fitness,
Financial Info, Location, Contacts, User Content, Browsing History, Search
History, Identifiers, Purchases, Diagnostics, Sensitive Info) is **not
collected**. Do not select any of them.

The resulting App Store product page label will read **"Data Not Linked to
You"** — not "No Data Collected."

### This is a correction, not the original plan

The design spec (`docs/superpowers/specs/2026-08-01-ios-app-store-submission-design.md`
§6.8) originally said the answer was "Data Not Collected" outright, reasoning
that the CloudFront access logs were purely operational. A review done while
writing the Task 2 privacy page checked that reasoning against the actual
infrastructure and found it false — the logs aren't purely operational, they
drive named behavioural-measurement queries (see below). The maintainer
ruled the answer must be "declare," not "not collected." The spec's §6.8
preserves the original wrong wording inline as a correction rather than
silently overwriting it, because that same wrong wording had already been
copied into the Task 2 brief and briefly shipped to the privacy page before
it was caught. This document reflects the corrected, final answer only.

**Do not write "Data Not Collected" as the headline answer for this app.**
**Do not describe the CloudFront measurement as "not used for profiling."**
Both statements are the error this document exists to prevent from
recurring.

---

## Step 1 verification (re-run before trusting this document)

Every claim below was re-verified against the source on 2026-08-01, on
branch `feat/ios-app-store-submission`, before this document was written.
Re-run these if the app's networking, storage, or permissions code changes:

```bash
cd /Users/bernard/src/chq/chq-calendar
grep -rniE "analytics|firebase|amplitude|mixpanel|sentry|IDFA|AdSupport|AppTrackingTransparency" ios/ChqCalendar --include="*.swift"
grep -rn "URLSession(" ios/ChqCalendar --include="*.swift"
grep -rn "EKEventStore\|EKAuthorization\|NSCalendars" ios/ChqCalendar --include="*.swift"
```

Results (as re-run for this document):

- The analytics/tracking grep produced only false-positive substring matches
  inside identifiers such as `EventRepository`'s `cachedEventsEntry` /
  `eventsEntry` (the case-insensitive `sentry` pattern matches the `sEntry`
  substring of `...Entry`). No real analytics or tracking SDK, and no
  `IDFA`/`AdSupport`/`AppTrackingTransparency` usage, appears anywhere in
  `ios/ChqCalendar`.
- `URLSession(configuration: .ephemeral)` is the sole `URLSession(` hit,
  in `ios/ChqCalendar/Data/CalendarAPI.swift:90`, inside `LiveCalendarAPI`,
  whose `baseURL` (line 86) is `https://www.chqcal.org`.
- `EKEventStore` appears only in
  `ios/ChqCalendar/Features/Detail/AddToCalendarView.swift`, which calls
  `store.requestWriteOnlyAccessToEvents()` — write-only, never read. The
  corresponding build setting is
  `INFOPLIST_KEY_NSCalendarsWriteOnlyAccessUsageDescription` in both
  app-target blocks of `ios/ChqCalendar.xcodeproj/project.pbxproj`
  (there is no separate `Info.plist` file — the app generates its
  Info.plist from `INFOPLIST_KEY_*` build settings).

All expectations held. Nothing here required stopping.

---

## Evidence table — what the app itself does

| Claim | Evidence |
|---|---|
| No analytics or tracking SDKs | `grep -rniE "analytics\|firebase\|amplitude\|mixpanel\|sentry\|IDFA\|AdSupport\|AppTrackingTransparency" ios/ChqCalendar --include="*.swift"` returns no real hits (see verification above) |
| No accounts | No auth/sign-in code anywhere in the iOS target — `ios/ChqCalendar/Data/` has no login, token, or credential type |
| No advertising identifiers | No `AdSupport` or `AppTrackingTransparency` import/usage anywhere in `ios/ChqCalendar` |
| Network access is plain HTTPS GET, no persistent cookie/credential storage | `URLSession(configuration: .ephemeral)` in `ios/ChqCalendar/Data/CalendarAPI.swift:90`, used by `LiveCalendarAPI` against `https://www.chqcal.org` (line 86). An ephemeral session keeps no cookie jar or credential store across launches — `EventRepository`/`DataCaching` own all caching decisions instead of the URL loading system |
| Preferences stay on device | `ios/ChqCalendar/Data/UserStateStore.swift` persists `FilterSelection` and favorite event IDs to `UserDefaults` (`UserDefaults.standard` by default) |
| Event data cached on device only | `ios/ChqCalendar/Data/DiskCache.swift` writes to the app's standard cache location, `Library/Caches/chq-data/` (line ~65-69) |
| Calendar access is write-only, opt-in per event | `ios/ChqCalendar/Features/Detail/AddToCalendarView.swift` owns the app's single `EKEventStore`, calls `requestWriteOnlyAccessToEvents()`, and only writes the specific event the user taps "Add to Calendar" for — it never reads or enumerates existing calendar entries |

**The app transmits nothing beyond plain HTTPS GETs** to
`https://www.chqcal.org` for static JSON (events, article links, weekly
themes, version) — no request bodies, no user-identifying headers beyond
what any HTTPS client sends.

---

## What the server side does — stated plainly

The claims above cover the app binary. They are not the whole picture,
because the CloudFront distribution that serves the app's JSON payloads is
instrumented, and the app's own traffic flows through that instrumentation.

- `ios/ChqCalendar/Data/CalendarAPI.swift:86` sets `LiveCalendarAPI.baseURL`
  to `https://www.chqcal.org` — every fetch the app makes (events, article
  links, weekly themes, version checks) is a request against this same
  CloudFront distribution that serves the public website.
- That distribution's access logging (Phase A traffic analytics, PR #145,
  live since 2026-07-19) records each request's client IP and user-agent,
  and an S3 lifecycle rule (`infrastructure/traffic-analytics.tf`, rule
  `expire-raw-logs`, prefix `cf/`) retains the raw logs for **90 days**
  before expiring them.
- `infrastructure/traffic-analytics.tf:296` derives a per-visitor hash key
  from those two fields:

  ```hcl
  cf_visitor_key = "lower(to_hex(md5(to_utf8(c_ip || '|' || cs_user_agent))))"
  ```

  This is a pseudonymous identifier, not a raw log line — it exists
  specifically so requests can be grouped by "probably the same visitor"
  across time.
- Named Athena saved queries built on that key (`infrastructure/traffic-analytics.tf`,
  workgroup `chautauqua-calendar-traffic`) compute, among others:
  - **05 — Unique visitors by day** and **06 — Unique visitors by week**:
    `COUNT(DISTINCT cf_visitor_key)` per day/week.
  - **07 — Unique visitors (season)**: the same count over the whole
    season.
  - **08 — New vs. returning visitors by day**: buckets visitors by
    whether their `cf_visitor_key` was seen on ≥2 distinct days.
  - **12 — Visitors by network/carrier (ASN)**: `COUNT(DISTINCT
    cf_visitor_key)` grouped by autonomous system number, to see how much
    apparent "uniqueness" is actually one carrier's NAT pool.

  (Full query set and reasoning: `docs/runbooks/traffic-analytics.md`.)

**Deriving a visitor key and computing new-vs-returning counts over time is
behavioural measurement, not passive operational logging.** Calling this
"not used for profiling" — the original spec's framing — was wrong, and is
the specific error this document corrects. It measures behavior (how many
distinct visitors return, on what cadence) even though it does so in
aggregate and without any identity attached.

---

## Why the declaration is nonetheless narrow

Apple's App Privacy questionnaire and its *Tracking* definition (the thing
that would require an App Tracking Transparency prompt and a "Used for
Tracking" answer) are about a specific, narrower harm than "any
measurement happens." Apple defines tracking as linking data with
third-party data for advertising purposes, or sharing data with a data
broker. None of that applies here:

- No ad tech of any kind — no ad SDK, no ad network callback, no bidding
  pixel.
- No third-party data sharing — the visitor key is computed and queried
  entirely within this AWS account's own S3/Athena pipeline; it is never
  sent to, or joined with data from, any outside party.
- No cross-app or cross-site linkage — the key is scoped to requests
  against `chqcal.org`'s own CloudFront distribution; there is no shared
  identifier that would let it be correlated with the user's activity
  anywhere else.
- No accounts — CHQ Calendar has no sign-in of any kind, so there is
  nothing durable to link the visitor key *to*. It is derived from IP +
  user-agent, which are network-layer facts, not an assigned, durable,
  per-user identifier tied to a real-world identity.

Because of this, the correct answer is: this is Usage Data (specifically
Product Interaction — counting how visitors use the site), it is **Not
Linked to You** (no identity, no account, nothing to link it to), and it
is **Not Used for Tracking** (no ads, no brokers, no cross-context
linkage).

**The asymmetry that drives this decision:** over-declaring (checking
"Yes, we collect Usage Data" when a stricter reading might excuse it)
carries no rejection risk — Apple does not reject apps for declaring more
than the minimum. Under-declaring — telling Apple "No data collected" when
a named, running Athena query is in fact counting returning visitors —
carries real risk: an App Review or post-release audit that finds the
CloudFront analytics stack would make the "No Data Collected" answer false,
which is a Guideline 5.1.1 misrepresentation problem, not a technicality.
When the honest reading is ambiguous, declare.

---

## Revisit triggers

This answer is not permanent. Re-open this document and reconsider the
declaration if any of the following happens:

- **The deferred first-party visitor-ID work ships** (a cookie or
  `localStorage`-based visitor identifier layered on top of, or replacing,
  the CDN-log-derived key). A durable, app-assigned identifier is a
  materially different privacy posture than an IP/user-agent hash computed
  after the fact from access logs, and would very likely move the answer
  from "Usage Data, Not Linked to You" toward **"Data Linked to You."**
- **Any account or sign-in system lands** (see
  `docs/superpowers/specs/2026-07-03-user-accounts-preferences-sync-design.md`
  and its companion plan — merged as design docs but not yet implemented as
  of 2026-08-01). Once there is an account to link the visitor key to,
  "Not Linked to You" stops being true.
- **Any analytics SDK, ad SDK, or crash-reporting SDK is added** to the iOS
  target. Re-run the Step 1 verification greps in this document; a real
  hit (not a substring false-positive like `...Entry`) changes the answer.
- **The CloudFront logging scope or retention changes** — e.g., if IPs are
  no longer retained, or a query is added that ties visits to a
  third party. Re-read `infrastructure/traffic-analytics.tf` and
  `docs/runbooks/traffic-analytics.md` before assuming the label still
  holds.

## 1.1 review (2026-08-07)

Re-checked this document's answer against the 1.1 feature set (#177–#182:
off-season landing, reminders, widgets, Siri/Shortcuts/Spotlight, My Day,
grounds map) before the 1.1 listing refresh. **No changes to the App
Privacy declaration are needed:**

- Reminders (#178) schedule **local** notifications only (`UNUserNotificationCenter`
  in `ios/ChqCalendar/Data/ReminderCenter.swift`) — no push service, no
  server-side scheduling, nothing transmitted.
- Widgets (#179) and the App Intents/Spotlight surfaces (#180) read the
  same on-disk cache the app already reads, shared via the
  `group.org.chqcal.app` App Group — no new network endpoint, no new data
  collection.
- The grounds map (#182) requests **no location permission** — confirmed
  no `CLLocationManager` or `NSLocation*UsageDescription` anywhere in
  `ios/`; walking directions open externally in Apple Maps via a
  `maps.apple.com` URL, not an in-app location API.
- None of #177/#181 (off-season landing, My Day) touch networking,
  storage, or permissions beyond what was already declared.

The Step 1 verification greps at the top of this document were re-run
against the full `ios/` tree (not just `ios/ChqCalendar`) as part of this
check and still returned no real hits.

## Cross-reference — keep in sync with `/privacy`

The public privacy policy at `https://www.chqcal.org/privacy`
(`frontend/src/app/privacy/page.tsx`) must describe the same facts as this
document, in particular:

- It must **not** claim the CDN measurement is "not used for profiling" —
  that framing is the exact error corrected here.
- It must describe the measurement honestly: IP + user-agent recorded,
  retained 90 days, a pseudonymous key derived from them, used to count
  unique and returning visitors in aggregate, never sold or shared, not
  linked to any account or identity.

As of this writing (2026-08-01), the live `/privacy` page's "How We Measure
Site Traffic" section already reflects this corrected framing. **If you
change the data-collection facts in one document, change the other in the
same commit** — a reviewer (or Apple) checking one against the other is
exactly the failure mode that caused this correction in the first place.
