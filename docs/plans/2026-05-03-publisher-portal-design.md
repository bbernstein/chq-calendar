> **Status:** Shipped via PRs #83 (`b8c1bc4`), #84 (`205403a`), and #85
> (`161e19b`). Kept for architectural context — the portal's data model,
> verification flow, and admin/review state machine described here still
> govern current code.

# Publisher self-service portal — design doc

**Date:** 2026-05-03
**Status:** Shipped (see banner above)
**Branch:** `feat/admin-index-and-publisher-portal`

## Problem

Today the publisher onboarding flow is human-mediated and CLI-based:

1. Prospective publisher emails the admin asking to be added.
2. Admin manually inserts a row into the `chautauqua-calendar-publishers` table
   via the `/admin/publishers/` page.
3. Publisher writes their JSON or HTML feed against the
   `@chq-calendar/publisher-format` spec.
4. Publisher tests their feed by either (a) waiting for the hourly ingest run
   and checking the public sidecar, or (b) the admin running the CLI tools in
   `tools/publisher-format/` for them.
5. Bugs in the feed (missing fields, bad dates, schema mismatches) surface as
   `parse_error` / `validation_error` rows in the admin publishers list, and
   the admin has to relay the message back to the publisher.

This is a poor experience for publishers, doesn't scale beyond a handful of
relationships, and puts the admin in the loop for every feed format mistake.

## Goal

A self-service portal where prospective publishers can:

1. **Apply** to be a publisher without admin handholding.
2. **Test** any URL against the publisher-format spec — get back parsing errors,
   missing/incorrect required fields, warnings, and a normalized event list.
3. **Preview** how their events will look on the calendar (rendered like a real
   user would see them) before going live.
4. **Track** application status (pending / approved / rejected) and, once
   approved, see their own publisher row's fetch history.

## Non-goals (initial scope)

- No publisher-controlled editing of individual events post-ingest.
- No file upload — publishers must host their feed at a public URL (the model
  the ingest pipeline already uses).
- No analytics for publishers (event view counts, click-throughs).
- No multi-user permissions per publisher account.

## Open design questions and recommended directions

### Q1. Authentication model for publishers

**Options:**

- **A. Same Google OAuth as admins, role flag.** Reuse the existing OAuth
  callback + JWT issuance. Add a `role: 'admin' | 'publisher'` claim. Publishers
  see only their own data; admins see everything.
- **B. Email magic-link.** Send a one-time link to the contact email. Lighter
  weight, no Google account required.
- **C. Anonymous "test only" mode + gated apply.** The test/preview tool is
  open to anyone — no auth needed to validate a URL. To actually *apply*, the
  user submits an email that gets a verification link.

**Recommended: C, with the apply step using B (email magic-link).** Test/preview
is the highest-traffic feature and the lowest-risk — making it open means a
publisher can iterate on their feed without creating an account first.
Application requires email verification so we know the contact email is real.
We avoid Google OAuth dependency for non-admins (publishers may be a
non-technical events coordinator at a venue, not someone with a Google account
they'd want to link to a public-facing site).

**Implication:** new backend handler for magic-link issue + verify, new
DynamoDB table for short-lived application tokens.

### Q2. Where do applications live?

**Options:**

- **A. Same `chautauqua-calendar-publishers` table, `enabled=false` + new
  `applicationStatus` field.** Reuse existing schema and admin UI; an
  application is just a publisher row that hasn't been approved.
- **B. Separate `chautauqua-calendar-publisher-applications` table.** Cleaner
  schema, but duplicates fields and requires a copy-on-approve step.

**Recommended: A.** The fields almost entirely overlap (id, name, contactEmail,
sourceUrl, sourceType). Add `applicationStatus: 'pending' | 'approved' | 'rejected'`
and `applicationSubmittedAt`. The existing ingest loop already filters
`enabled === true`, so pending applications are ignored automatically — no
risk of accidentally fetching an unapproved feed. The admin publishers page
gets a "Pending applications" section at the top.

### Q3. URL test tool — where does the fetch happen?

**Options:**

- **A. Browser `fetch()`.** Zero backend code. Fails on CORS for almost every
  real publisher site (they don't set `Access-Control-Allow-Origin`).
- **B. Lambda proxy.** New endpoint `POST /api/publisher-test` that accepts
  `{ url, sourceType, publisherId? }`, fetches the URL server-side, runs the
  same parser/validator the ingest pipeline uses, returns the
  `ValidationReport` + parsed `FeedDocument`.

**Recommended: B.** CORS makes A non-viable in practice. The Lambda already
exists for ingest — we extract `fetchAndParseFeed` (already a pure function)
and expose it through a new public endpoint. To prevent abuse:

- Rate-limit per IP (10 requests / 5 minutes via simple DynamoDB counter or
  API Gateway usage plan).
- Validate `sourceType` is `'json'` or `'html'`.
- 30-second timeout (already enforced in `publisherFeedFetcher.ts:19`).
- Cap response body size at 5 MB.
- Don't follow redirects to `localhost`/`127.0.0.1`/private IPs (SSRF guard).
  Implement an allowlist via a URL-validation helper before calling `fetch()`.

### Q4. Preview fidelity

**Options:**

- **A. Reuse the real `EventCard` component from the main calendar.** Most
  honest preview. Couples the portal to the main calendar's component tree.
- **B. Simplified preview component.** Dedicated to the portal; rendered
  side-by-side with raw JSON.

**Recommended: A, with caveats.** The main calendar's event card lives in
`frontend/src/app/components/` (we'll need to import it). Preview events go
through the same enrichment path (`venuesById` lookup) as ingest. The portal
shows:

- A list of every parsed event rendered with the calendar's `EventCard`.
- A side panel with: validation status (ok / errors / warnings), counts,
  parsed vs raw JSON toggle.
- An expandable "How this looks on chqcal.org" section using the real card.

If the calendar's event-card module isn't trivially importable (e.g., it
pulls global context), we fall back to a portal-local card that mimics the
visual style — **decision deferred to implementation**.

### Q5. Validation depth

**Recommended scope for v1:**

- Required-field check (already in `validateFeed` from `publisher-format`).
- Date format & sanity (no events in the past more than 30 days, no events
  more than 2 years in the future).
- `publisher.id` matches the registered publisher (or a placeholder during
  pre-registration testing).
- Dedup-key collisions with *other* publishers (warning, not error — only
  the admin sees this signal).
- Total event count in a reasonable range (warn if >500, error if >5000).

Out of scope for v1: image-URL liveness checks, venue-ID validation against
the canonical reference list (warn only, don't fail).

### Q6. Application review flow

The admin already has a `/admin/publishers/` page. Add:

- A "Pending applications" filter / section at the top.
- Approve / Reject buttons per application row.
  - **Approve:** flips `applicationStatus` → `'approved'`, sets `enabled = true`.
    Publisher receives an email (reuse SES if already configured, otherwise
    surface in-app status only for v1).
  - **Reject:** sets `applicationStatus` → `'rejected'`, optional admin note.
    Publisher sees the rejection in their portal.

## Architecture overview

### New routes (frontend)

- `/publish/` — landing page; pitches the program, links to test tool and apply.
- `/publish/test/` — URL validator + preview tool. **Open to anyone.**
- `/publish/apply/` — application form. Requires email verification.
- `/publish/status/` — application status + (post-approval) own-publisher view.
  Requires magic-link auth.
- `/publish/verify/` — magic-link landing page (consumes the token from
  the email link).

### New backend endpoints

| Method | Path                                    | Auth        | Purpose                          |
|--------|-----------------------------------------|-------------|----------------------------------|
| POST   | `/api/publisher-test`                   | none + rate-limit | Fetch + validate a feed URL |
| POST   | `/api/publisher-apply/request`          | none        | Submit application + send magic-link |
| POST   | `/api/publisher-apply/verify`           | token       | Verify token, persist application as `pending` row |
| GET    | `/api/publisher-status`                 | publisher JWT | Get caller's publisher record + recent fetch history |
| POST   | `/api/publisher-auth/request`           | none        | Re-send magic-link to existing application/publisher |
| POST   | `/api/publisher-auth/verify`            | token       | Exchange magic-link token for publisher JWT |

### New backend services

- `publisherApplicationService.ts` — application lifecycle (request, verify,
  approve, reject).
- `publisherAuthService.ts` — magic-link issuance/verification, JWT for
  publishers (different signing key or distinct claim from admin JWT).
- `publisherTestService.ts` — wraps `fetchAndParseFeed` with the SSRF guard
  and rate limiter.
- `mailService.ts` (if not present) — SES wrapper; magic-link emails.

### New DynamoDB tables

- `chautauqua-calendar-publisher-magic-tokens`
  - PK: `token` (UUID, hashed)
  - Attrs: `email`, `purpose: 'apply' | 'login'`, `publisherId?`, `expiresAt`
  - TTL: 15 minutes.

(Applications themselves live in the existing `publishers` table per Q2.)

### Modified backend services

- `publisherFeedFetcher.ts` — extract a `validateUrl(url)` helper that the
  test endpoint reuses to block private IPs / localhost.
- `adminHandler.ts` — extend `/publishers` PATCH to handle
  `applicationStatus` transitions. Add `/publisher-applications/pending` GET.

### Infrastructure

- `infrastructure/publisher-portal.tf` — new file:
  - DynamoDB table for magic tokens.
  - Lambda env-var additions (SES sender address, JWT publisher key, magic
    token table name).
  - IAM: SES `ses:SendEmail` permission, DynamoDB `Get/Put/Delete` on the new
    table.
  - API Gateway routes (or Lambda Function URL routing additions).

## Phased implementation plan

We deliver this in **four** ship-able phases. Each is independently mergeable.

### Phase A — Backend test endpoint + frontend test page (open, no auth)

**This is the maximum-value, minimum-coupling slice.** No new auth, no DB
changes, no application flow. A prospective publisher can paste a URL and
see what would happen if they were registered — that is 80% of the practical
value of the portal.

**Files:**

- Backend:
  - `backend/src/services/publisherTestService.ts` (new) — wraps
    `fetchAndParseFeed`, adds SSRF guard + rate-limit.
  - `backend/src/services/urlGuard.ts` (new) — block localhost / private
    IP ranges, enforce http/https scheme, length cap.
  - `backend/src/handlers/publisherPortalHandler.ts` (new) — Lambda handler
    for `/api/publisher-test`. Plumbed through the existing API Gateway
    Lambda router (likely a new entry in `adminHandler.ts`'s sibling, or a
    dedicated handler).
  - `backend/src/services/publisherFeedFetcher.ts` — extract
    `validateUrlIsPublic()` helper.
- Frontend:
  - `frontend/publish/index.html` + `frontend/publish/test/index.html`.
  - `frontend/src/entries/publish.tsx`, `frontend/src/entries/publish-test.tsx`.
  - `frontend/src/app/publish/page.tsx`, `frontend/src/app/publish/test/page.tsx`.
  - `frontend/src/lib/publisherTestApi.ts` (client for the new endpoint).
  - `frontend/vite.config.ts` — register the two new entries.
- Infra:
  - Add API Gateway route (or Lambda route registration) — minimal Terraform.

**Verification:** paste a known-good URL → events render, no errors. Paste a
URL with a missing `name` field → see the validator's error highlighted.
Paste `http://localhost/` → SSRF guard rejects.

### Phase B — Application flow (magic-link auth + apply form)

**Files:**

- Backend:
  - `backend/src/services/publisherAuthService.ts`
  - `backend/src/services/mailService.ts`
  - `backend/src/services/publisherApplicationService.ts`
  - `backend/src/handlers/publisherPortalHandler.ts` — add
    `/api/publisher-apply/request`, `/api/publisher-apply/verify`,
    `/api/publisher-auth/request`, `/api/publisher-auth/verify`.
  - `backend/src/services/publisherRegistryService.ts` — add
    `applicationStatus` field handling, `listPending()` for applications.
- Frontend:
  - `frontend/publish/apply/index.html`, `frontend/publish/verify/index.html`
  - `frontend/src/app/publish/apply/page.tsx`,
    `frontend/src/app/publish/verify/page.tsx`.
  - `frontend/src/lib/publisherAuthClient.ts` — magic-link state +
    publisher JWT in localStorage (separate key from admin to avoid collision).
- Infra:
  - DynamoDB table for magic tokens.
  - SES sender setup (assumes a verified sender; if not yet present, manual
    verification step required).
  - Env vars: `PUBLISHER_JWT_SECRET`, `PUBLISHER_MAGIC_TOKEN_TABLE`,
    `SES_FROM_ADDRESS`.

**Verification:** apply with a real email → receive magic link → verify →
application appears in DynamoDB with `applicationStatus = 'pending'`.

### Phase C — Status page + admin approve/reject UI

**Files:**

- Frontend:
  - `frontend/publish/status/index.html`, `src/entries/publish-status.tsx`,
    `src/app/publish/status/page.tsx`.
  - `frontend/src/app/admin/publishers/page.tsx` — add "Pending applications"
    section, approve/reject controls.
- Backend:
  - `backend/src/handlers/adminHandler.ts` — extend `/publishers` PATCH for
    `applicationStatus` transitions; add explicit
    `/publisher-applications/pending` GET (admin view).

**Verification:** admin clicks "Approve" → publisher sees status change →
their feed gets ingested on the next scheduled run.

### Phase D — Polish, rate-limiting hardening, docs

- Add rate-limit table for `/api/publisher-test` (per-IP, sliding window).
- Add a "What is the publisher format?" docs page that links to the
  `@chq-calendar/publisher-format` spec.
- Add a "Re-send magic link" path on the status page.
- Optional: SES email templates for approval/rejection notifications.
- Optional: CAPTCHA on the apply form (only if abuse appears).

## Cross-cutting concerns

- **Naming:** all new tables follow `${var.app_name}-*` per the convention
  established in PR #77.
- **Logging:** redact email addresses and JWTs before `console.log`. Reuse
  the redaction pattern from `adminHandler.ts`.
- **Tests:** unit tests for `urlGuard`, `publisherTestService`, the magic-link
  service, and the application service. Integration test (in the deploy
  workflow) that exercises the apply → approve → ingest path against the
  CI test publisher row, mirroring the publisher-ingest E2E test pattern.
- **Frontend Preact convention:** new files import hooks from `'preact/hooks'`
  (per CLAUDE.md), not `'react'`.

## Risks

| Risk | Mitigation |
|------|------------|
| SES not configured / sender unverified | Manual verification step in Phase B prereqs; document in plan. |
| SSRF via the test endpoint | `urlGuard` blocks private IPs + localhost; integration test confirms. |
| Magic-link tokens leak in logs | Hash the token before storing; never log raw tokens. |
| Rate-limit storage cost | DynamoDB on-demand with a 1-hour TTL; per-IP record < 100 bytes. |
| Preview component coupling | If `EventCard` is hard to import, fall back to a portal-local card mimicking the style. Decision in Phase A. |
| Spam applications | Email verification + manual admin review gate; CAPTCHA in Phase D if needed. |

## Estimate

| Phase | Effort |
|-------|--------|
| A. Test endpoint + frontend page | 1–2 days |
| B. Magic-link + apply flow | 2–3 days |
| C. Status page + admin UI | 1 day |
| D. Polish | 1 day |
| **Total** | **5–7 days** |

## Decisions still open (call out before each phase begins)

- **Q4 (preview fidelity):** confirm EventCard reusability when starting Phase A.
- **SES vs alternative mailer:** confirm SES sender domain available before
  Phase B.
- **Publisher JWT storage key in localStorage:** propose `chq_publisher_token`
  and `chq_publisher_user` to avoid collision with admin keys; confirm in
  Phase B.
- **Multi-publisher per email:** v1 assumes one publisher per contact email.
  If a venue manages multiple feeds, deferred to Phase D or later.
