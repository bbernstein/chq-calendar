# iOS App Store Submission — Design

**Status:** Approved design, ready for implementation planning
**Date:** 2026-08-01
**Scope:** Prepare the `ios/` CHQ Calendar app for a clean App Store 1.0
submission, and establish a standing rule that keeps the store listing in
sync with the app's UI.

---

## 1. Background

The native SwiftUI app (`ios/ChqCalendar.xcodeproj`) shipped to main via
PRs #147 and #148 and is live in TestFlight under bundle id
`org.chqcal.app` (team RX6EGLMU69). It has 123 unit tests, targets iOS
17.0, and supports iPhone and iPad. It is not yet submitted to the App
Store.

The trigger for this work was an observation that the app icon does not
render on the App Store Connect page even though it renders correctly in
the simulator and on a connected iPhone.

### 1.1 Icon investigation — findings

The uploaded archive
(`~/Library/Developer/Xcode/Archives/2026-08-01/ChqCalendar 8-1-26, 11.12 AM.xcarchive`)
was inspected directly. **The binary is correct.** Specifically:

| Check | Result |
| --- | --- |
| Source `AppIcon.png` dimensions | 1024 × 1024 |
| Alpha channel | None (`hasAlpha: no`, `Opaque: true`) — this is the #1 cause of missing ASC icons and is *not* the problem here |
| Marketing icon present in `Assets.car` | Yes — `AssetType: Icon Image`, 1024 × 1024, for both `phone` and `pad` idioms |
| Compiled colorspace | `srgb` |
| `CFBundleIconName` | `AppIcon` |
| `CFBundleIcons` / `CFBundleIcons~ipad` | Present, with generated `AppIcon60x60@2x.png` and `AppIcon76x76@2x~ipad.png` |
| SDK / Xcode | `iphoneos26.5`, DTXcode 2660 |

Because the binary is compliant, this design does **not** treat the icon as
a bug to be fixed. It treats it as a condition to be verified, with one
genuine (minor) deviation corrected.

The two realistic explanations for the observed symptom:

1. **Most likely — no build is attached to an App Store version.** App
   Store Connect derives the app-record icon (App Information page, app
   tile) from a build attached to a *version*, not from a TestFlight
   upload. A TestFlight-only upload leaves that slot as a grey
   placeholder.
2. **Extraction lag.** ASC extracts the icon during build processing and
   can trail the "ready to test" state by hours.

The one real deviation found: the source PNG has **no embedded ICC
profile** (`sips -g profile` returns `<nil>`). Xcode assumed sRGB when
compiling, so the shipped rendition is correct, but Apple's guidance is to
embed sRGB explicitly. Corrected in this work as cheap insurance.

**Explicitly out of scope:** Icon Composer / `.icon` Liquid Glass icon
adoption. The app builds against the iOS 26.5 SDK and a flat PNG renders
correctly on device. Adopting Liquid Glass icons is a design project, not
a submission blocker, and is deferred.

### 1.2 Positioning decision

CHQ Calendar is an unofficial third-party client built on Chautauqua
Institution's publicly posted event data. App Review applies Guideline
5.2.1 (intellectual property) to apps that surface another organization's
content and branding.

**Decision:** ship as an explicitly-unofficial app rather than waiting on
Institution outreach (`docs/outreach/2026-07-18-chq-outreach-note.md` is
still an unsent draft) or de-branding the app. Concretely:

- Keep the name `CHQ Calendar`.
- Add a visible "not affiliated with Chautauqua Institution" disclaimer in
  three places: an in-app About screen, `chqcal.org`, and the opening
  lines of the App Store description.
- Write App Review Notes that pre-empt the 5.2.1 question directly.

This ships without depending on a reply from the Institution. Sending the
outreach note remains worthwhile but is not a blocker and is not part of
this work.

---

## 2. Goals and non-goals

### Goals

1. Remove the mechanical blockers to a clean submission (export
   compliance, build number, icon colour profile).
2. Publish the two web pages App Store Connect requires as hard fields
   (Privacy Policy URL, Support URL).
3. Add the in-app unaffiliated disclaimer.
4. Produce the complete listing artifact set: screenshots, one preview
   video, and every piece of required text.
5. Establish a repeatable, checked-in pipeline so these artifacts are
   regenerated rather than hand-made.
6. Establish and enforce a standing rule that UI changes refresh the
   listing.

### Non-goals

- Submitting the app. Every step is prepared and documented; the actual
  App Store Connect submission is a manual action for the account holder.
- Icon Composer / Liquid Glass icon redesign.
- iOS CI (build/test on macOS runners) — still deliberately deferred.
- A second preview video for iPad.
- Sending the Chautauqua Institution outreach note.

---

## 3. Workstream A — build and compliance changes

All in `ios/`.

### 3.1 Embed sRGB in the app icon

Re-encode `ios/ChqCalendar/Assets.xcassets/AppIcon.appiconset/AppIcon.png`
with an explicit sRGB IEC61966-2.1 profile. Pixel data must be unchanged;
alpha must remain absent.

**Verification:** rebuild, extract `Assets.car` from the built `.app`, and
confirm via `assetutil --info` that the `Icon Image` rendition still
reports `"Colorspace": "srgb"` and `"Opaque": true` at 1024 × 1024 for
both `phone` and `pad` idioms.

### 3.2 Export compliance

Add `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO` to the app target's
build settings. The app uses only HTTPS via `URLSession`, which is exempt.
This removes the manual compliance prompt on every TestFlight upload.

### 3.3 Build number

Bump `CURRENT_PROJECT_VERSION` from `1` to `2`. `MARKETING_VERSION` stays
at `1.0`.

### 3.4 Application category

`INFOPLIST_KEY_LSApplicationCategoryType` currently reads
`public.app-category.lifestyle`. Change to
`public.app-category.travel` to match the App Store Connect category
selected in §6.

### 3.5 About screen

Add `ios/ChqCalendar/Features/About/AboutView.swift`, reachable from the
calendar toolbar. Contents:

- The unaffiliated disclaimer (exact text in §6.7).
- App version and build number, read from the bundle.
- Links to `chqcal.org/privacy`, `chqcal.org/support`, and `chq.org`.

The view's data — the link set and the formatted version string — lives in
a separate plain-Swift type so it is unit-testable without a view host,
matching the project's existing convention of testing logic rather than
views.

**Constraint:** new files land under `ios/ChqCalendar/` and join the
target automatically via the synchronized folder group. Do not edit
`project.pbxproj` for file additions.

---

## 4. Workstream B — required web pages

All in `frontend/`, following the existing multi-page-app pattern (a
directory with `index.html` plus an entry in `vite.config.ts`
`rollupOptions.input`, and an entry file under `src/entries/`).

### 4.1 `/privacy`

A real privacy policy covering both the web app and the iOS app. Must
state accurately what §6.8 declares to Apple: no accounts, no analytics
SDKs in the app itself, no advertising identifiers, no tracking in Apple's
sense; preferences and cached event data stay on the device; calendar
access is write-only and only for events the user explicitly adds.

On server-side measurement, the page must be **honest rather than
flattering**: the CDN records each request's IP address and user-agent,
retains them 90 days, and derives a pseudonymous visitor key from them to
count unique and returning visitors in aggregate. The page must NOT claim
this is "not used for profiling" — see §6.8 for why that framing was wrong.
It should say plainly what is measured, that it is aggregate, that it is
never sold or shared, and that it is not linked to any identity.

### 4.2 `/support`

A support page satisfying the required Support URL: what the app is, how
to report a problem (linking to the existing feedback flow), and the
unaffiliated disclaimer.

### 4.3 Site footer

Add the unaffiliated disclaimer line to the existing footer in
`frontend/src/app/page.tsx`, with links to `/privacy` and `/support`.

Both new pages get vitest coverage consistent with the repo's existing
frontend tests, and are subject to the coverage floor in
`.coverage-floor.json`.

---

## 5. Workstream C — screenshot and preview pipeline

Checked into `ios/Scripts/` so it is re-runnable for every release rather
than a one-off.

### 5.1 Components

| File | Responsibility |
| --- | --- |
| `screenshot-plan.json` | Single source of truth: for each shot, the launch state, caption, and target devices. Copy changes edit this file, not the scripts. |
| `capture-screenshots.sh` | Boots the target simulator, applies `simctl status_bar override` (9:41, full cellular/wifi bars, 100% battery), launches the app with the DEBUG hooks for each state, captures raw PNGs at native resolution. |
| `compose-screenshots.py` | Pillow compositor producing the captioned layout (§5.3). Also emits the manifest and the downscaled review copies. |
| `record-preview.sh` | `simctl recordVideo`, then `ffmpeg` to trim to ≤30s, H.264, 30fps, with a silent AAC audio track. |

The app already exposes DEBUG-only launch arguments — `-uitest-show-filters`,
`-uitest-select-linked-event`, `-uitest-show-add-to-calendar` — which the
capture script uses to reach states deterministically. Additional hooks are
added only if a planned shot cannot be reached with the existing set.

Required tooling is present on the build machine: `ffmpeg`, Python with
Pillow, and the needed simulators.

### 5.2 Target devices and dimensions

| Set | Simulator | Dimensions | Required by Apple |
| --- | --- | --- | --- |
| iPhone 6.9" | iPhone 17 Pro Max | 1320 × 2868 | Yes |
| iPad 13" | iPad Pro 13-inch (M5) | 2064 × 2752 | Yes, because the app ships iPad support |
| App preview (iPhone 6.9") | iPhone 17 Pro Max | 1320 × 2868, 15–30s | Optional |

No 6.5" legacy iPhone set. No iPad preview.

### 5.3 Visual treatment

Each screenshot is the raw capture inset on the brand's pale-indigo
`#EEF2FF` field (matching the app icon background), with a short headline
above it.

### 5.4 Shot list

Six shots, the same narrative on both device classes:

| # | State | Caption |
| --- | --- | --- |
| 1 | Season list with week strip visible | The whole season, one scroll. |
| 2 | Filter sheet — categories and locations | Narrow it to what you actually want. |
| 3 | Search results | Search by name, venue, or presenter. |
| 4 | Event detail — time, venue, presenter, cost, description | Every detail, in one place. |
| 5 | Event detail showing *Chautauquan Daily* article links | See what the Daily wrote about it. |
| 6 | Add-to-calendar sheet | Send it straight to your calendar. |

Screenshots are captured against **live 2026 season data**. The season is
currently running, so the shots show real events, which is both more
honest and what Apple expects.

### 5.5 Preview video

One ~20 second iPhone preview covering the core loop: browse the season →
filter by week and category → search → open an event → add it to the
calendar.

Apple prefers device-captured footage. Simulator recordings are routinely
accepted and are what this pipeline produces. If a preview is ever
rejected on that basis, the fallback — a QuickTime capture from the
connected iPhone — is documented in the release checklist rather than
built as a second pipeline up front.

### 5.6 What is committed

| Artifact | Committed? | Rationale |
| --- | --- | --- |
| Scripts and `screenshot-plan.json` | Yes | Source of truth |
| `docs/app-store/screenshots.manifest.json` | Yes | Per shot: filename, device, caption, dimensions, sha256, capture date. Written by the compositor; this is what CI watches (§7.2). |
| Downscaled review copies (~400px wide) in `docs/app-store/screenshots/review/` | Yes | A sha256 in a diff tells a reviewer nothing; a thumbnail lets them see whether the shot is right. ~50KB each. |
| Full-resolution PNGs | No — gitignored | Regenerable; ~8MB re-committed on every UI change would bloat the repo. |
| Preview `.mp4` | No — gitignored | Same reason, larger. |

---

## 6. Workstream D — listing copy

Produced as `docs/app-store/listing-copy.md`, with every constrained field
pre-counted against Apple's limits. A character-count validation runs over
the file so limits are checked mechanically rather than by hand.

### 6.1 Fixed fields

| Field | Value |
| --- | --- |
| App Name (≤30) | `CHQ Calendar` (12) |
| Subtitle (≤30) | `Unofficial Chautauqua guide` (27) |
| Primary category | Travel |
| Secondary category | Entertainment |
| Age rating | 4+ |
| Marketing URL | `https://www.chqcal.org` |
| Support URL | `https://www.chqcal.org/support` |
| Privacy Policy URL | `https://www.chqcal.org/privacy` |
| Copyright | `© 2026 Bernard Bernstein` |

The subtitle deliberately spends its first word on "Unofficial": it is the
highest-visibility place to establish the 5.2.1 position, and it appears
in search results.

**On the author's name.** The project's standing rule keeps personal names
out of the repository. The author has granted an explicit exception for
attribution contexts — copyright notices, author credit, and registered
owner fields — so the real name is used in those places rather than a
placeholder. The exception is narrow: it covers crediting the author or
registered owner, not personal contact details, and not incidental
appearances of the name elsewhere in the codebase. The App Store copyright
string must match the Apple Developer account holder name exactly; the
release checklist carries that as a verification step.

### 6.2 Keywords (≤100 characters, comma-separated, no spaces)

```
amphitheater,lecture,recital,opera,symphony,season,events,schedule,summer,institution,program,arts
```

98 characters. Terms already present in the app name and subtitle — `chq`,
`calendar`, `chautauqua`, `unofficial`, `guide` — are deliberately omitted,
since Apple already indexes those fields.

### 6.3 Promotional text (≤170 characters)

Changeable at any time without review. Draft:

> The 2026 season is underway. Browse every lecture, concert, and service
> on the grounds, filter by week or venue, and send what you pick to your
> calendar.

153 characters. This field carries season-specific messaging over time.

### 6.4 Description (≤4000 characters)

Structure:

1. **Opening disclaimer** — the unaffiliated statement, first, before any
   marketing copy.
2. **What it's for** — planning a day or a week on the grounds.
3. **Feature list**, drawn from what the app actually does: season browse
   with week strip; filter by category and location; search by name,
   venue, or presenter; full event detail (time, venue and address,
   presenter, cost, description, category chips, hero image); related
   *Chautauquan Daily* article links; favorites; share; add to Apple
   Calendar; open the event on chq.org; offline access to previously
   loaded events; iPhone and iPad layouts.
4. **Closing** — data source and its public origin, and a pointer to
   chq.org as the authoritative source.

### 6.5 What's New (1.0)

For a first release Apple's convention is a brief statement of what the
app is rather than a changelog, since there is no prior version to diff
against. Subsequent releases carry real release notes.

### 6.6 App Review Notes

Not user-facing. Must state plainly:

- The app is unofficial and unaffiliated with Chautauqua Institution, and
  says so in the app, on the website, and in the description.
- It presents publicly posted event information and links back to chq.org
  for every event.
- No account or login is required; there is nothing gated to test.
- The app's data comes from `chqcal.org`, operated by the developer.

### 6.7 Disclaimer text

One canonical sentence, reused verbatim in the App Store description, the
in-app About screen, `/privacy`, `/support`, and the site footer. Defined
once in `listing-copy.md` so the five copies cannot drift. Draft:

> CHQ Calendar is an independent app and is not affiliated with,
> endorsed by, or sponsored by Chautauqua Institution. Event information
> is drawn from publicly posted listings; chq.org remains the
> authoritative source.

Two sentences rather than one, because the second does real work: it
names the data as public and defers to chq.org, which is the substance of
the Guideline 5.2.1 answer. The wording is deliberately close to the
Institution-facing language already drafted in
`docs/outreach/2026-07-18-chq-outreach-note.md`, so the public posture and
the private outreach say the same thing.

### 6.8 Privacy nutrition label

Produced as `docs/app-store/privacy-nutrition-label.md` with the exact
questionnaire answers.

**Headline answer: Usage Data → Product Interaction, "Not Linked to You",
"Not Used for Tracking".** Everything else is "Data Not Collected".

> **Corrected 2026-08-01, mid-implementation.** This section originally
> read "Data Not Collected" outright, on the reasoning that the CloudFront
> access logs were operational only. A review of the Task 2 privacy page
> checked that claim against the infrastructure and found it false. The
> original wording is preserved here as a correction rather than silently
> overwritten, because the same false claim was copied into the Task 2
> brief and shipped to the privacy page before it was caught.

**What is true of the app itself.** Verified against the source: no
analytics or tracking SDKs, no accounts, no advertising identifiers,
`URLSession` built on an `.ephemeral` configuration, preferences in
`UserDefaults`, event data in an on-device disk cache, and `EKEventStore`
used only to write events the user explicitly adds. The app transmits
nothing beyond plain HTTPS GETs.

**What the server side does.** The CloudFront distribution serving the
app's JSON (Phase A analytics, PR #145, live since 2026-07-19) is not
merely operational logging:

- `infrastructure/traffic-analytics.tf:296` derives
  `cf_visitor_key = lower(to_hex(md5(to_utf8(c_ip || '|' || cs_user_agent))))`
  — a pseudonymous per-visitor identifier.
- Named Athena queries 05–08 and 12 compute unique visitors per
  day/week/season, **new vs. returning** (a visitor seen on ≥2 days), and a
  breakdown by network/carrier ASN.
- Raw client IPs and user-agents are retained 90 days.
- `ios/ChqCalendar/Data/CalendarAPI.swift:86` sets `baseURL` to
  `https://www.chqcal.org`, so the app's own requests are in this pipeline.

Deriving a visitor key and computing returning-visitor counts is
behavioural measurement. Calling it "not profiling" was wrong.

**Why the answer is nonetheless narrow.** Apple's definition of *Tracking*
— linking with third-party data for advertising or sharing with a data
broker — is not met: there is no ad tech, no third-party sharing, no
cross-app or cross-site linkage, and no accounts to link to. The visitor
key is not tied to any real-world identity. So the declaration is Usage
Data, **Not Linked to You**, **Not Used for Tracking**. The store label
becomes "Data Not Linked to You" rather than "No Data Collected".

Over-declaring carries no rejection risk; under-declaring does. That
asymmetry is the reason for the answer.

**Consequences to keep in sync.** The `/privacy` page (§4.1) must describe
aggregate traffic measurement honestly and must not repeat the "not used
for profiling" claim. If the deferred first-party visitor-ID work ever
ships, or if any account system lands, this answer must be revisited —
a durable user ID would move the label to "Data Linked to You".

---

## 7. Workstream E — standing rule and enforcement

### 7.1 The rule

A new "App Store listing upkeep (iOS)" section in the project
`CLAUDE.md`:

- Any PR touching `ios/ChqCalendar/Features/**`, `ios/ChqCalendar/App/**`,
  or `ios/ChqCalendar/Assets.xcassets/**` in a way a user can see must
  regenerate the affected screenshots via `ios/Scripts/`, and must re-read
  `docs/app-store/listing-copy.md` for claims the change invalidates. A
  description that promises a removed feature is a worse defect than a
  stale screenshot.
- Regenerated assets **land in the repo at merge time; they upload at the
  next version submission.** This is a constraint of the platform, not a
  choice: metadata changes to an already-released version require creating
  a new version and submitting it for review. The only field changeable
  without review is Promotional Text.
- `docs/app-store/RELEASE_CHECKLIST.md` owns the upload procedure.

### 7.2 CI guard

New `.github/workflows/app-store-assets.yml`, `ubuntu-latest`, following
the repo's one-concern-per-workflow convention (closest analog:
`validate-publisher-examples.yml`). No Xcode required — it is pure
git-diff analysis.

On `pull_request`: if any watched path changed, then
`docs/app-store/screenshots.manifest.json` must also have changed in the
same PR, or the job fails.

**Escape hatch:** `[skip-screenshots: <reason>]` in the PR body, with a
non-empty reason required. Refactors that genuinely do not move pixels use
it freely; the point is that opting out is a deliberate, recorded act
rather than silence.

### 7.3 PR template

Add `.github/pull_request_template.md` (none exists today) with a matching
checkbox, so the CI guard is not the first time anyone hears about the
rule.

### 7.4 Release checklist

`docs/app-store/RELEASE_CHECKLIST.md`, covering: regenerate assets, bump
build number, archive and upload, create the version in App Store Connect,
attach the build, **confirm the icon renders on the App Store tab**,
upload screenshots and preview, paste copy, answer the questionnaires,
submit.

It also carries the icon escalation procedure: if the icon is still
missing 24 hours after a build with the sRGB profile has finished
processing *and* has been attached to a version, open an App Store Connect
support ticket citing the `assetutil` output as evidence the binary is
compliant.

---

## 8. Testing

| Area | Approach |
| --- | --- |
| `AboutView` data | Swift Testing coverage of the plain-Swift type behind the view (link set, formatted version string), matching the project's convention of testing logic rather than views. |
| Frontend `/privacy`, `/support` | vitest, consistent with existing page tests; subject to `.coverage-floor.json`. |
| Screenshot pipeline | Smoke check asserting every generated file exists at exactly the required pixel dimensions. Off-by-one sizes are the failure mode Apple actually rejects on. |
| Copy | Character-count validation of every constrained field against Apple's limits. |
| Icon | `assetutil` assertion on the rebuilt `Assets.car` (§3.1). |
| CI guard | Verified by construction on the implementing PR — that PR touches watched paths, so the job must fail without a manifest update and pass with one. |

Existing verification still applies: `xcodebuild test` for the iOS app,
and the repo's frontend and backend build/validate steps.

---

## 9. Deliverables

```
docs/app-store/
├── RELEASE_CHECKLIST.md
├── listing-copy.md
├── privacy-nutrition-label.md
├── screenshots.manifest.json
└── screenshots/review/            # downscaled review copies

ios/Scripts/
├── screenshot-plan.json
├── capture-screenshots.sh
├── compose-screenshots.py
└── record-preview.sh

ios/ChqCalendar/Features/About/AboutView.swift
frontend/privacy/, frontend/support/
.github/workflows/app-store-assets.yml
.github/pull_request_template.md
CLAUDE.md                          # new listing-upkeep section
.gitignore                         # full-res screenshots, preview .mp4
```

Plus, generated to disk but not committed: full-resolution screenshots for
both device sets, and the iPhone preview video.

---

## 10. Risks

| Risk | Handling |
| --- | --- |
| Guideline 5.2.1 rejection over Chautauqua branding | Disclaimer in four places plus explicit Review Notes. If rejected anyway, the fallback is the outreach note in `docs/outreach/` and a reply from the Institution to cite. |
| ASC icon still missing after all corrections | Escalation procedure with `assetutil` evidence documented in the release checklist. |
| Preview rejected for being simulator-captured | Documented fallback to a device QuickTime capture. |
| CI guard produces false positives on non-visual refactors | Explicit escape hatch with a required reason. |
| Screenshots go stale between seasons | The standing rule covers UI changes; the release checklist covers each submission. Data-driven staleness (e.g. a new season year) is caught at release time. |
