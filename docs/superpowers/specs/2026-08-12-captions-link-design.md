# Captions quick link — design

**Status:** Approved, not yet implemented
**Date:** 2026-08-12

## Problem

Chautauqua Institution runs live CART captioning for talks at
`captions.chq.org`, for attendees who are deaf or hard of hearing. Nothing in
CHQ Calendar points at it. A user sitting in the Amphitheater who wants
captions has to already know the hostname.

## Solution

Add `captions.chq.org` as a seventh entry in the shared quick-links list, which
already drives both the web header and the iOS toolbar **More** menu.

## What the URL actually is

`https://captions.chq.org` is a 301 redirect, not a page we control. On
2026-08-12 it resolved to `https://2020archive.1capapp.com/event/chautauqua/`,
a 1CapApp CART session titled *"57919 chautauqua: the rev. frank a. thomas ||
9:00-10:00 am"*, and rendered "Session has been stopped".

CHQ appears to re-point the hostname at whichever session is currently being
captioned. Two consequences shape the design:

1. The link is useful *during* a captioned talk and lands on a stopped-session
   screen the rest of the time, including all off-season.
2. We cannot know from our side whether a session is live. Only CHQ's DNS and
   1CapApp know that.

## Decisions

### Plain, unconditional link

Treated exactly like the other six. No season gating, no time-of-day gating, no
health check on the redirect target.

Rejected: conditional display. It would require a second source of truth about
"is a session live" that we cannot actually populate — CHQ controls the
redirect, we don't. And a hidden accessibility affordance is worse than a
visible one that occasionally lands on a stopped session. Bus Tracker is
equally useless in February and is shown unconditionally.

Consequence accepted: off-session, the user sees CHQ's own "session stopped"
page. That is CHQ's surface, not ours, and it is self-explanatory.

### Label: `Captions`

The header buttons are terse (`Guide`, `Feedback`, `Programs`, `Questions`,
`Bus Tracker`, `CHQ Fund`) and the mobile dropdown is 160px wide, so two short
words is the practical ceiling.

`Captions` is shortest, unambiguous, and matches the hostname — a user who sees
`captions.chq.org` in the address bar recognizes where they came from.

Rejected: `Live Captions` (wider, and "Live" overpromises on a page that is
frequently a stopped session); `CART Captions` (term of art — precise for
people who already know it, opaque for everyone else).

### Position: between `Questions` and `Bus Tracker`

Final order, shared by web and iOS:

```
Guide · Feedback · Programs · Questions · Captions · Bus Tracker · CHQ Fund
```

Programs and Questions are both things you use *in the room during a talk*.
Captions belongs with them rather than appended next to the donate link.

The order is shared, so this also reorders the iOS **More** menu. That is
intended.

### URL written with a trailing slash

`https://captions.chq.org/`. `programs.chq.org/`, `questions.chq.org/` and
`giving.chq.org/` all carry it; `busandtramtracker.chq.org` does not. The slash
matches the majority and avoids one redirect hop, since the host 301s
regardless.

## Changes

### 1. `shared/links.json`

Insert after the `questions` entry:

```json
{ "id": "captions", "title": "Captions", "url": "https://captions.chq.org/" }
```

No `webPath`. That field exists only to keep same-site links on localhost
during development; this destination is external.

### 2. `ios/ChqCalendar/Features/About/AboutInfo.swift`

Mirror the entry in `AboutInfo.quickLinks`, in the same position:

```swift
Link(id: "captions", title: "Captions", url: URL(string: "https://captions.chq.org/")!),
```

`AboutInfoTests.quickLinksMatchSharedLinksJson` compares the two lists by id,
title, and URL **as ordered arrays**. A mismatch in any of the three, including
order, fails the iOS suite rather than shipping a divergence between platforms.

### 3. `frontend/src/lib/__tests__/quickLinks.test.ts`

Add one test naming the link explicitly, mirroring the existing
`includes the Chautauqua Fund link` case:

```ts
it('includes the captions link', () => {
  const captions = quickLinks.find((l) => l.id === 'captions');
  expect(captions?.title).toBe('Captions');
  expect(captions?.url).toBe('https://captions.chq.org/');
});
```

This is the only new test required. The existing generic tests (id shape,
absolute https URL, unique ids, webPath shape) and both data-driven header
render tests (`it.each(quickLinks)`, desktop and mobile) pick the new entry up
automatically. The explicit test exists to catch a *silent deletion*, which the
data-driven tests by construction cannot: remove the entry and they simply run
one fewer case, all green.

## No other consumers

`shared/links.json` is read by `frontend/src/lib/quickLinks.ts` and mirrored in
`AboutInfo.swift`. Nothing else in the repo names these links — in particular
the `/about` marketing and guide pages do not enumerate them, so they need no
update.

## Screenshot guard

`.github/workflows/app-store-assets.yml` fires on any change under
`ios/ChqCalendar/Features/**`, and `AboutInfo.swift` is in scope.

No shot in `ios/Scripts/screenshot-plan.json` opens the toolbar **More** menu.
The ten shots cover the season list, filters, search, detail, articles,
add-to-calendar, My Day, map, reminders, and the widget. The manifest therefore
will not change even after a full regeneration run.

Use the documented opt-out rather than burning a simulator pass to prove a
no-op:

```
[skip-screenshots: no covered shot renders the More menu]
```

CLAUDE.md explicitly blesses this case.

## App Store listing

No `listing-copy.md` or `listing-fields.json` claim is invalidated — neither
enumerates the quick links. Add a release-note bullet under "Release notes for
the next version" in `docs/app-store/RELEASE_CHECKLIST.md`, since this is a
user-visible addition that should reach `whatsNew` at the next submission.

## Verification

- `cd frontend && npm run build` — runs validate (type-check + lint) and the
  frontend test suite
- iOS suite — machine-checked on the PR by the CI job added in #205/#207, so
  the `quickLinksMatchSharedLinksJson` pin is enforced rather than relying on a
  local run

## Out of scope

- The uncommitted `MARKETING_VERSION = 1.1.2` bump sitting in
  `project.pbxproj`. It belongs in its own commit and must not ride along on
  this branch.
- Any change to how quick links are rendered, ordered at runtime, or
  configured. This is a data addition on an existing mechanism.
