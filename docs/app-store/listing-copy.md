# App Store listing copy

`docs/app-store/listing-fields.json` is the single source of truth for every
App Store Connect text field for CHQ Calendar. It is machine-readable and
covered by an enforced test
(`frontend/src/__tests__/appStoreListing.test.ts`) that checks Apple's
character limits, required-field presence, keyword formatting, and that the
description opens with the canonical disclaimer.

This document explains the JSON and the reasoning behind it — it does not
restate field values. If a value here ever drifted out of sync with the JSON,
a reader would have no way to know which one was correct, so field text lives
in exactly one place: `listing-fields.json`. When you need the current app
name, subtitle, keywords, description, etc., read the JSON directly (or open
App Store Connect, which should always match it).

## Where each field goes in App Store Connect

| JSON key | App Store Connect location |
|---|---|
| `appName` | App Store tab › General App Information › Name |
| `subtitle` | App Store tab › iOS App › Subtitle |
| `promotionalText` | App Store tab › iOS App › Promotional Text |
| `keywords` | App Store tab › iOS App › Keywords |
| `description` | App Store tab › iOS App › Description |
| `whatsNew` | App Store tab › iOS App › What's New in This Version |
| `reviewNotes` | App Review Information › Notes |
| `disclaimer` | Not entered directly anywhere — canonical text duplicated into the app's About screen and into `description`'s opening paragraph; other tasks in this initiative sync it into the TSX/Swift source |
| `copyright` | App Store tab › General App Information › Copyright |
| `primaryCategory` | App Information › Category (primary) |
| `secondaryCategory` | App Information › Category (secondary) |
| `ageRating` | App Information › Age Rating questionnaire result |
| `marketingUrl` | App Store tab › iOS App › Marketing URL |
| `supportUrl` | App Information › Support URL |
| `privacyPolicyUrl` | App Information › Privacy Policy URL |

## Rationale

**Why the subtitle leads with "Unofficial."** The subtitle is the
highest-visibility place in the listing to establish the app's Guideline
5.2.1 position (no affiliation with, endorsement by, or sponsorship from
Chautauqua Institution) — it appears directly under the app name in search
results and on the product page, so a prospective user sees the
independence disclosure before they even open the listing. Putting
"Unofficial" first, rather than burying it later in the subtitle or waiting
for the description, makes the position unmissable and gives App Review the
same signal at a glance.

**Why `chq`, `calendar`, `chautauqua`, `unofficial`, and `guide` are absent
from `keywords`.** Apple's search indexing already includes the app name and
subtitle text automatically, so repeating those words in the Keywords field
wastes budget out of a hard 100-character limit. The enforced test asserts
this directly (`does not repeat app name or subtitle words in keywords`) so
the omission can't regress silently as either field is edited.

**Why Promotional Text carries the season-specific messaging.** Of every
field in `listing-fields.json`, Promotional Text is the only one Apple lets
you change on a live app version without submitting a new build for review —
every other field (description, keywords, subtitle, screenshots, etc.)
requires a new version and a review cycle to update. That makes it the right
place for anything time-sensitive, such as noting that the current season is
underway, without having to ship a new build just to refresh a sentence.

**Why `marketingUrl` points at `/about` rather than the calendar.** The
marketing URL is the one link in the listing a prospective user follows
*before* deciding to install. Pointing it at the calendar dropped them into a
filtered event list with no explanation of what the app is or what it can do.
`/about` explains the app across both platforms and routes them to the
platform-specific guide, which is also where the features that are invisible
on first launch — reminders, widgets, My Day, the grounds map, Siri and
Spotlight — are actually documented.

## Screenshots and description changes require a new version

Once a version has been released, its screenshots and description are
locked. Changing either one means creating a new version in App Store
Connect and submitting it for App Review — there is no way to hot-edit those
fields on an already-released version the way you can with Promotional Text.
Plan copy and screenshot changes accordingly, and budget review time before
any date you need the change to be live.

## Upload procedure

For the actual build-and-submit steps (archiving, uploading via Xcode/
Transporter, filling in App Store Connect, and submitting for review), see
`RELEASE_CHECKLIST.md`.
