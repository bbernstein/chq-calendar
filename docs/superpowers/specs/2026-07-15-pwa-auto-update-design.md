# PWA Auto-Update — Design

**Date:** 2026-07-15
**Status:** Approved (design). Next: implementation plan.
**Topic:** Ensure installed home-screen ("PWA") users receive new frontend
releases automatically, and guarantee the same for every future release.

## Problem

Users who installed `https://www.chqcal.org` to their iPhone home screen never
receive new versions after a deploy. The app stays frozen on whatever version it
first cached.

### Root cause

The live app shell is served with a **year-long immutable** cache header:

```
GET https://www.chqcal.org/
cache-control: public, max-age=31536000, immutable
```

`immutable` + `max-age=31536000` tells every browser and every iOS home-screen
web clip that `index.html` never changes for a year, so the device never
re-requests it. New deploys land on S3 and CloudFront is invalidated, but the
**device's own cache never asks the origin**, so it keeps serving the old shell,
which references the old content-hashed JS/CSS bundles. `manifest.json` has the
same header and the same problem.

This is caused by an `aws s3 sync` two-pass bug in the deploy
(`.github/workflows/deploy-production.yml:414-426`, mirrored in
`scripts/deploy-frontend.sh`):

1. Pass 1 uploads **everything** — including `*.html` — with
   `max-age=31536000, immutable`.
2. Pass 2 tries to re-upload the HTML with a shorter TTL, but `aws s3 sync`
   skips files whose content is unchanged. The HTML was just uploaded seconds
   earlier with identical content, so pass 2 uploads **nothing** and the
   immutable header from pass 1 stays in place.

The intended second-pass header (`max-age=3600`) was also weaker than an app
shell warrants.

### Honest constraint on already-installed users

There is **no HTTP mechanism that instantly reaches a device which already
believes `index.html` is immutable for a year** — such a device will not contact
the origin until iOS evicts that cache entry on its own (iOS does this fairly
regularly for web-clip caches, but not on a schedule we control). Therefore:

- **Currently-trapped devices** recover the first time iOS revalidates their
  cached shell after this fix ships. From that point on they are on the
  self-updating path.
- **Every future release** updates automatically once the header is corrected.

No approach can change the reality for already-trapped devices; this is the same
for every option considered. The chosen design makes updates deterministic and
automatic from the corrected baseline onward.

## Chosen approach

**Header fix + client-side version check with silent auto-reload on reopen.**

- Fixing the cache headers is the necessary root-cause fix: every future launch
  revalidates the shell and picks up new bundles.
- A lightweight version check makes the update happen *while the app is
  open/reopened* — deterministic, with no service-worker complexity or its
  associated stale-cache failure modes.

Rejected alternatives:

- **Header fix only** — correct but doesn't refresh an already-open/reopened
  session; relies solely on the browser's revalidation timing.
- **Full service worker (vite-plugin-pwa/Workbox)** — enables true offline and
  deterministic updates, but adds real complexity and its own (harder to debug)
  stale-cache failure mode, plus iOS SW quirks. Overkill for a static site that
  does not need offline.

## Design

### Part 1 — Fix the cache headers (root cause)

Restructure the S3 upload in **both** `.github/workflows/deploy-production.yml`
(the real deploy path) and `scripts/deploy-frontend.sh` (kept consistent) so the
"revalidate-always" files are never uploaded with the immutable header first:

- **Pass 1 — immutable, content-hashed assets:** sync everything *except*
  `*.html`, `manifest.json`, and `version.json` with
  `public, max-age=31536000, immutable`. Vite content-hashes these filenames, so
  a one-year immutable TTL is correct. Continue to exclude `cache/*` and `*.map`
  as today.
- **Pass 2 — always-revalidate files:** upload `*.html`, `manifest.json`, and
  `version.json` with `cache-control: no-cache` using
  `aws s3 cp --metadata-directive REPLACE` (explicit `cp`, **not** a second
  `sync`) so the header is applied unconditionally and the sync-skip bug cannot
  recur. `no-cache` means the browser revalidates via ETag on every load; an
  unchanged file returns a near-free `304`.
- CloudFront full invalidation (`/*`) stays as-is.

### Part 2 — Version stamp

- At build time, bake the version into the bundle as `VITE_APP_VERSION` — the
  short git SHA, falling back to a build timestamp when a SHA is unavailable
  (e.g. local builds outside CI).
- Emit a tiny `version.json` at build time containing the **same** value:
  `{ "version": "<sha-or-timestamp>" }`. It is uploaded to S3 and served
  `no-cache` per Part 1.

Both the running app and the served `version.json` carry the identical value, so
a mismatch unambiguously means "a newer deploy exists."

### Part 3 — Client version check

New module `versionCheck.ts` (in `frontend/src/lib/`), wired into the main
calendar entry only (the installed PWA surface). Admin and publisher pages are
out of scope.

Behavior:

- On initial load, and on `visibilitychange` → document becomes visible (iOS
  fires this when the home-screen app is reopened), fetch `/version.json` with
  `cache: 'no-store'`.
- If `fetched.version !== VITE_APP_VERSION`, call `location.reload()`.
- **Loop guard:** before reloading, record the target version in
  `sessionStorage`; never reload twice for the same target value. This protects
  against a CloudFront propagation race where `version.json` updates a moment
  before the new bundle is fetchable.
- **Failure handling:** any fetch error (offline, non-OK status, malformed JSON)
  is swallowed — no reload; the app continues on its current version.

### Testing

- **Header logic (CI/shell):** validated by review of the commands plus a
  post-deploy live check. Assertions:
  - `curl -sI https://www.chqcal.org/ | grep -i cache-control` →
    contains `no-cache` (and NOT `immutable`).
  - Same assertion for `/manifest.json` and `/version.json`.
  - A hashed asset (e.g. `/assets/*.js`) still returns
    `max-age=31536000, immutable`.
- **`versionCheck.ts` (Vitest unit tests):** `fetch` and `location.reload`
  mocked.
  - Reloads when fetched version ≠ running version.
  - No-op when versions match.
  - No-op on fetch failure (rejection, non-OK, malformed JSON).
  - Loop guard: does not reload twice for the same target version.
  - Triggers a check on `visibilitychange` → visible.

## Non-goals

- No service worker / offline support.
- No mechanism to instantly reach devices already trapped on the year-long
  immutable copy — they recover automatically on the next iOS revalidation and
  are self-updating thereafter.
- No change to admin/publisher pages.

## Affected files (anticipated)

- `.github/workflows/deploy-production.yml` — restructure the frontend S3 upload.
- `scripts/deploy-frontend.sh` — mirror the same header fix.
- `frontend/vite.config.ts` — inject `VITE_APP_VERSION`, emit `version.json`.
- `frontend/src/lib/versionCheck.ts` — new module (+ test).
- `frontend/src/entries/main.tsx` — wire the check into the main entry.
