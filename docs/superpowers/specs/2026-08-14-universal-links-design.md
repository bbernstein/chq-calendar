# Universal Links for chqcal.org — design

**Status:** Approved design, not yet implemented.
**Issue:** Phase 2 of #223 (Phase 1 shipped as PR #224, merged `1c2fd40`).
**Date:** 2026-08-14

## What Phase 2 actually delivers

Issue #223 describes Phase 2 as: "the primary button becomes a normal
`https://www.chqcal.org/<deep path>` link that iOS routes to the app-or-web
automatically."

**That does not work, and no amount of correct configuration makes it work.**
iOS deliberately ignores a universal link when the user taps it from a page on
the same domain — it opens the link in Safari instead, on the reasoning that
someone already on your website who taps a link to your website wants to stay
there. Our promo banner lives on `www.chqcal.org`, so a same-domain CTA can
never route to the app.

The two mechanisms therefore cover different surfaces, and neither supersedes
the other:

| Surface | Mechanism | Behavior |
|---|---|---|
| Links tapped **off-site** (Messages, Mail, Slack, search results) | Universal Links | Open the app if installed; the website otherwise |
| The **on-site** promo, in iOS Safari | Smart App Banner meta tag | Safari detects install state itself: "OPEN" or "VIEW" |
| The on-site promo, everywhere else (Chrome/Firefox iOS, in-app webviews) | The custom banner from PR #224 | Links to the App Store |

The `/open/<deep path>` namespace sketched in the issue is **dropped**. It
existed solely to give the on-site button a URL to point at; with that button
replaced by Safari's own banner, it has no remaining purpose and would be a
static page nobody links to.

## Decisions

| Question | Decision |
|---|---|
| Which paths the app claims | All public paths, excluding `/admin/*`, `/publish/*`, `/.well-known/*` |
| Claimed URL the app can't render | Open it in an in-app `SFSafariViewController` |
| Smart App Banner vs the custom banner | Ship the meta tag; suppress the custom banner in iOS Safari only |
| Release | 1.1.3, **after** the in-review 1.1.2 is approved and released |

## Architecture

### Infrastructure

**The file.** `frontend/public/.well-known/apple-app-site-association` — no
extension, served as JSON:

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["RX6EGLMU69.org.chqcal.app"],
        "components": [
          { "/": "/admin/*", "exclude": true },
          { "/": "/publish/*", "exclude": true },
          { "/": "/.well-known/*", "exclude": true },
          { "/": "*" }
        ]
      }
    ]
  }
}
```

`components` is evaluated first-match-wins, so the three excludes must precede
the catch-all. The portal exclusions are not cosmetic: the app cannot render
the publisher or admin portals, so a claimed portal link would strand its user
in an app with no way to show the page they asked for.

**Deployment.** `.github/workflows/deploy-production.yml` needs two changes:

1. Add `--exclude ".well-known/*"` to the pass-1 `s3 sync`. Without it the
   extensionless file is uploaded as `binary/octet-stream` with a year-long
   `immutable` cache — the wrong content type and a cache header we could not
   walk back for twelve months.
2. Add an explicit upload alongside the other pass-2 files:
   `--content-type "application/json" --cache-control "public, max-age=3600"`.

**Unverified assumption, test before building on it:** that `vite build`
copies a dot-directory out of `public/`. If it does not, the file needs a
build step or a different source location.

**The apex redirect.** `infrastructure/cloudfront-redirect-function.js` 301s
every request for `chqcal.org` to `www.chqcal.org`, and it runs on the default
(S3) cache behavior — so it would 301 the AASA request too. Apple requires the
file to be reachable **without redirects**, which means that as things stand
the apex domain cannot be associated at all, and bare `chqcal.org` links — the
form people type and share — would never open the app.

The fix is one condition in that function: return `request` unchanged when
`request.uri` starts with `/.well-known/`. Requires `terraform apply`.

### iOS

**Entitlement.** `ios/ChqCalendar.entitlements` gains:

```xml
<key>com.apple.developer.associated-domains</key>
<array>
  <string>applinks:chqcal.org</string>
  <string>applinks:www.chqcal.org</string>
</array>
```

Both hosts, because iOS matches the association against the domain of the URL
actually tapped — the apex link is a different domain from `www`, not a
redirect to it.

**The mapper.** A new pure type in `ios/ChqCalendarShared/` — no UIKit import,
so it unit-tests like `DeepLink` does:

```swift
enum WebLinkRoute: Equatable, Sendable {
    case openApp                 // the site root: the Events tab already mirrors it
    case inAppBrowser(URL)       // claimed, but nothing native corresponds
    case ignore                  // not one of our hosts
}
```

Rules, in order:

1. Host is not `chqcal.org` or `www.chqcal.org` → `.ignore`
2. Path is `/` or `/index.html`, with or without a query → `.openApp`
3. Anything else → `.inAppBrowser(url)`

Rule 3 is the defensive default rather than `.ignore` on purpose. Apple's CDN
caches the AASA, so a stale copy can deliver a path we have since excluded;
showing the user the page they tapped is the right behavior for a URL we did
not expect, and it costs nothing when the excludes are working.

**Wiring.** `RootTabView` gains
`.onContinueUserActivity(NSUserActivityTypeBrowsingWeb)` next to the existing
`CSSearchableItemActionType` handler. `.openApp` sets no pending deep link —
the app simply comes to the foreground on its default tab. `.inAppBrowser`
drives a `@State` URL that presents an `SFSafariViewController` sheet through
a small `UIViewControllerRepresentable` wrapper (SwiftUI has no native
equivalent).

The `chqcal://` scheme is **untouched**. Widgets, notification taps, App
Intents, Siri, and Spotlight keep using it; this adds a second entry point to
the same `AppModel.pendingDeepLink` pipeline rather than replacing the first.

### Web

**Meta tag**, on the promotional surface only — the calendar (`index.html`)
and the three `/about/*` guide pages. Not `/privacy` or `/support`: they are
utility pages someone reaches with a specific question, where an app pitch is
noise. Not admin or publish, which are working tools for a different audience
entirely:

```html
<meta name="apple-itunes-app" content="app-id=6797027562">
```

No `app-argument`. The app's default tab already corresponds to the website's
calendar, so there is no context worth passing, and an argument we don't need
is one more thing to keep correct.

**Suppression.** `iosPromo.ts` gains `isIosSafari(device)`: the UA carries a
`Safari/` token and none of `CriOS|FxiOS|EdgiOS|OPiOS`. In-app webviews are
characteristically missing the `Safari/` token, which is what makes this
crude test useful. `shouldShowPromoBanner` returns `false` when it is true —
Apple's banner covers Safari, and covers it better, since it can say "OPEN".

`isAppPromoAvailable` is deliberately **not** gated on this: the header entry
stays everywhere. Apple's banner disappears permanently once dismissed, and
the header link is the changed-my-mind path.

When the heuristic is wrong the failure is a duplicate banner or a missing
one. It cannot produce a broken link, which is why a heuristic is acceptable
here at all.

## Data flow

```
Tap https://www.chqcal.org/... in Messages
  └─ iOS checks its cached AASA for the tapped domain
     ├─ path excluded (/admin, /publish) ──────────────→ Safari
     └─ path claimed
        ├─ app installed → NSUserActivityTypeBrowsingWeb → WebLinkRoute
        │   ├─ .openApp        → foreground, Events tab
        │   ├─ .inAppBrowser   → SFSafariViewController sheet
        │   └─ .ignore         → nothing
        └─ app not installed ─────────────────────────→ Safari

Visit www.chqcal.org in iOS Safari
  └─ Safari reads <meta name="apple-itunes-app">
     ├─ installed     → banner says OPEN → launches the app
     └─ not installed → banner says VIEW → App Store
     (our custom banner suppressed; header link still present)
```

## Sequencing

**This reverses the "hold everything until iOS is ready" answer given during
brainstorming, because a fact discovered afterwards makes that ordering
costly.** On-device verification of a universal link requires the AASA to be
live in production — Apple's CDN fetches it from the real domain, and even
Associated Domains developer mode, which bypasses the CDN, still fetches from
the domain itself. Holding the file back means the first real test of the
association happens after 1.1.3 is already in review, and a mistake there
costs another review cycle. That is precisely the cost the 1.1.2 decision was
meant to avoid.

**Stage 1 — web + infra (mergeable immediately).** AASA file, deploy changes,
CloudFront function exemption, meta tag, banner suppression. Nothing here
depends on an app release: the AASA is inert until an app claims it, and the
Smart App Banner works against the *currently live* 1.1. Verifiable in
production the moment it deploys.

**Stage 2 — iOS (merges after 1.1.2 is approved and released).** Entitlement,
mapper, in-app browser, the 1.1.3 version bump, and the `whatsNew` line.

`MARKETING_VERSION` stays at **1.1.2** on `main` for the whole of stage 1, so
that a rejection of the in-review 1.1.2 can still be reworked and resubmitted
as a 1.1.2 build. The bump to 1.1.3 is the last commit of stage 2.

TestFlight uploads are permitted while a version is in review, so a 1.1.3
TestFlight build can be used for on-device verification during 1.1.2's review
— only a new *submission* has to wait.

## Testing

**Automated:**

- Vitest UA fixture table for `isIosSafari`: iOS Safari, Chrome iOS (`CriOS`),
  Firefox iOS (`FxiOS`), Edge iOS, an in-app webview UA with no `Safari/`
  token, and desktop Safari.
- Vitest assertion that the meta tag is present in the built calendar and
  `/about/*` HTML, and absent from `/privacy`, `/support`, admin, and publish.
- A test that parses the AASA file and asserts the appID equals
  `RX6EGLMU69.org.chqcal.app` — a typo there fails silently in production,
  which is the worst possible failure mode for this file.
- Swift Testing route table for `WebLinkRoute`: both hosts, root with and
  without a query, `/about/iphone`, `/admin/publishers`, a foreign host.
- Post-deploy smoke check (extend `scripts/smoke/`): both hosts serve the file
  as `application/json`, HTTP 200, **no redirect**.

**On-device, and only on-device** (the simulator cannot do universal links,
and CI cannot either) — this becomes part of the pre-submit checklist:

1. Install a 1.1.3 TestFlight build.
2. Tap a `https://chqcal.org` link from Messages → app opens.
3. Tap a `https://www.chqcal.org/about/iphone` link → app opens, guide page
   appears in the in-app browser.
4. Tap a `https://www.chqcal.org/publish/status` link → stays in Safari.
5. Delete the app, tap the same links → all open the website, no errors.
6. In Safari on `www.chqcal.org`, confirm Safari's banner reads "OPEN" with
   the app installed and "VIEW" without it, and that the custom banner does
   not also appear.

## Risks

- **Apple's AASA CDN caches aggressively** (~24h). A wrong file is not
  instantly fixable. This is the argument for stage 1 landing early.
- **"Open in Safari" is sticky.** If a user long-presses a link and chooses to
  open it in Safari, iOS remembers that per-domain and stops routing to the
  app. Nothing can override it; it is not a bug report.
- **The Safari heuristic is a heuristic.** Bounded failure, as argued above.
- **Claiming `*` means guide pages open the app** and show a web view. That is
  the accepted trade of the "claim all public paths" decision.

## Non-goals

- Deferred deep linking (install → land on the exact event).
- Per-event web routes. The site has none; adding them is SEO Phase 2, still
  deferred pending outreach to Chautauqua Institution.
- Android/Play Store equivalents. There is no Android app.
- Analytics on link opens.

## Open items carried from PR #224

- **`target="_blank"` on the App Store links.** Copilot asked for consistency
  with other external links; declined on the grounds that these render only on
  iOS, where the store app takes over and `_blank` orphans a tab. Still the
  user's call to reverse.
- **1.1.3 release notes** must cover the expanded Siri surface, the captions
  link, the My Day changes, *and* now universal links — everything merged
  since 1.1 is still unreleased.
- **Screenshot guard.** This work touches `ios/**`, and the
  `SFSafariViewController` sheet is not in `screenshot-plan.json`, so the PR
  opts out with a stated reason rather than regenerating.
- **The on-device Siri checklist** from #193/#197 remains outstanding and
  attaches to whichever release ships next.
