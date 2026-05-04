# Publisher Portal — Phase D implementation plan

**Date:** 2026-05-03
**Branch:** `feat/publisher-portal-phase-d`
**Depends on:** Phase A+B+C (PR #83 + PR #84, both merged).
**Design doc:** `docs/plans/2026-05-03-publisher-portal-design.md` (section "Phase D").

## Goal

Polish + hardening pass on top of the working publisher portal. The
self-service loop already works end-to-end as of PR #84; Phase D removes
the most prominent "good enough for v1" shortcuts and cleans up review
notes carried over from Phases B and C.

## In scope (this PR)

1. **DNS-rebinding mitigation in `urlGuard`** — resolve the hostname
   before the fetch, validate every resolved IP against the existing
   private/loopback/CGNAT block-list, then fetch the literal IP with a
   `Host:` header set to the original hostname. Closes the gap noted in
   the Phase A `urlGuard.ts` top-of-file comment.
2. **DynamoDB-backed sliding-window rate limiter.** New table
   `chautauqua-calendar-publisher-rate-limit` (TTL on `expiresAt`).
   Replaces the in-memory `_state` Maps in `publisherPortalHandler.ts`
   for both the test endpoint (10/5min) and the apply/login endpoints
   (10/hour). Local dev keeps the in-memory fallback so the test suite
   doesn't need a live DDB.
3. **"Re-send magic link" UX** on `/publish/login/`. After the "sent"
   state, expose a "Didn't get it? Send another" button that re-submits
   (still respecting the 60-second client-side cooldown).
4. **Carry-over polish from Phase C review:**
   - Remove dead `_resetPublisherAdminForTests` (superseded by
     `_setPublisherAdminForTests(null)`).
   - In `PendingApplications.tsx`, distinguish "approve succeeded but
     refetch failed" from "approve failed" so the admin doesn't see a
     misleading error message after a successful action.
5. **Terraform** for the new rate-limit table + IAM grants + env var.

## Explicitly deferred

- **Docs page** ("What is the publisher format?") — separate PR; needs a
  content pass that's not just code.
- **CAPTCHA on apply** — design says "only if abuse appears." No abuse
  observed yet.
- **SES email templates** for approval/rejection — current inline
  bodies are fine; templates only matter once we want richer formatting.
- **Multi-publisher per email** — design treats this as "Phase D or
  later"; deferring to "later".
- **Audit history beyond `lastFetchedAt`** — needs a new audit table;
  out of scope for a polish PR.

## Constraints

- Follow project CLAUDE.md: never commit to main, run validate +
  tests + build before each commit.
- Frontend: Preact (`'preact/hooks'`); Vite multi-page setup.
- Backend tests live in `backend/src/__tests__/`, jest + ts-jest, mock
  AWS via `aws-sdk-client-mock`.
- All new tables follow `${var.app_name}-*` naming (PR #77 convention).
- Logs MUST redact email addresses + JWTs.

## Task breakdown

- [ ] D0 — This plan doc.
- [ ] D1 — DNS-rebinding mitigation in `urlGuard` + `publisherFeedFetcher`.
- [ ] D2 — DynamoDB-backed sliding-window rate limiter service + wiring.
- [ ] D3 — Frontend re-send magic link UX on `/publish/login/`.
- [ ] D4 — Carry-over polish (dead export removal + onChange-error fix).
- [ ] D5 — Terraform for rate-limit table + IAM + env var on admin handler.
- [ ] D6 — Build verification + tests pass + open PR.

---

### D1 — DNS-rebinding mitigation

**Files:**

- `backend/src/services/urlGuard.ts` — keep `validateUrlIsPublic` as-is
  (string-only pre-flight). Add `resolveAndValidateUrl(url, opts?)`:
  1. Run the existing string check.
  2. `dns.lookup(host, { all: true })` to get every resolved address.
  3. For each address, run the same `isBlockedIPv4` / `isBlockedIPv6`
     guards. If ANY resolves to a blocked range, reject — defends
     against split-horizon DNS that returns one public + one private
     address.
  4. Return `{ ok: true, resolvedHost, originalHostname, port, protocol,
     pathQuery }` so callers can fetch by the resolved IP.
- `backend/src/services/publisherFeedFetcher.ts` — accept a
  `resolveUrl` injection so tests can stub. In production, call
  `resolveAndValidateUrl` and fetch `https?://<resolvedIP>:<port><pathQuery>`
  with `Host: <originalHostname>` header. For HTTPS this requires
  `rejectUnauthorized = true` (the cert still validates against the
  Host header thanks to SNI; we need to set the SNI servername on the
  agent — Node's undici fetch supports `dispatcher` with a custom TLS
  config). If the SNI dance is too heavy for this PR, fall back to a
  simpler design: resolve, validate, then fetch the original URL — the
  rebinding window is tiny but non-zero. Pick the simpler design and
  document the residual risk.
- `backend/src/services/publisherTestService.ts` — pass through the new
  `resolveUrl` injection so the test endpoint also benefits.
- Tests (`urlGuard.test.ts`): mock `dns.lookup` and verify the new
  function rejects on private/loopback resolutions and accepts on
  public-IP resolutions, including multi-A.

**Decision (post-investigation, recorded in code comment):** ship the
"resolve + validate, then re-fetch the original URL" version. The TLS
+ Host-header dance for fetching the literal IP is materially more
code, undici doesn't expose `servername` cleanly through `fetch`'s
public API, and the residual rebind window between our DNS lookup and
Node's HTTP-client lookup is small. Document the tradeoff.

### D2 — DynamoDB-backed rate limiter

**Files:**

- `backend/src/services/rateLimitService.ts` (new) — exports
  `RateLimitService` with `checkAndConsume({ key, windowMs, max })
  → { ok: true } | { ok: false, retryAfterSeconds }`. Uses a single
  DDB item per key; the value is a list of recent millisecond
  timestamps inside the window. Eviction happens on read. TTL field
  `expiresAt = now + windowMs/1000`. The race between read-modify-write
  is acceptable at this volume; if we observe contention, switch to
  conditional updates with a version field.
- `backend/src/handlers/publisherPortalHandler.ts` — replace the two
  in-memory rate-limit functions with calls into `rateLimitService`.
  Construct a singleton at module level that reads the table name from
  `PUBLISHER_RATE_LIMIT_TABLE_NAME` env var. If the env var is absent
  (tests, local dev without docker DDB), fall back to the in-memory
  implementation that exists today so the test suite doesn't break.
  Keep the existing `_resetPublisherTestRateLimitForTests` /
  `_resetPublisherAuthRateLimitForTests` exports as resets that work
  for both backends.
- Tests:
  - `rateLimitService.test.ts` — happy path, eviction inside window,
    rejection at limit, retryAfterSeconds calculation, TTL field set.
  - Existing handler tests keep passing on the in-memory fallback (no
    env var set).

### D3 — Re-send magic link UX

**Files:**

- `frontend/src/app/publish/login/page.tsx` — extend the `'sent'` state
  rendering: add a "Didn't get it? Send another" button below the
  confirmation. Disabled while `inCooldown`. On click, set status back
  to `'idle'` so the form re-shows with the same email pre-filled, OR
  trigger a direct re-submit if email is still in state.

### D4 — Carry-over polish

**Files:**

- `backend/src/handlers/adminHandler.ts` — delete
  `_resetPublisherAdminForTests`; keep `_setPublisherAdminForTests`.
- `frontend/src/app/admin/publishers/PendingApplications.tsx` —
  refactor `handleApprove` / `handleReject` so the API call and the
  `onChange()` refetch are in separate try/catch blocks. Approve/reject
  failure shows the row's inline error AND keeps the row in the pending
  list. `onChange` failure falls back to a soft toast/log; the row is
  removed from the local list optimistically since the action did
  succeed.

### D5 — Terraform

**Files:**

- `infrastructure/publisher-portal.tf` — new resource
  `aws_dynamodb_table.publisher_rate_limit` with PK `id` (string), TTL
  on `expiresAt`, on-demand billing. Naming:
  `${var.app_name}-publisher-rate-limit`.
- IAM: extend `lambda_role`'s policy to grant
  `dynamodb:GetItem,PutItem,UpdateItem,DeleteItem` on the new table ARN.
- `infrastructure/main.tf` — add `PUBLISHER_RATE_LIMIT_TABLE_NAME` to
  the admin Lambda's env vars (set to the new table name).

### D6 — Verify + PR

- `cd backend && npm test` — all green.
- `cd frontend && npm run validate && npm run build` — clean.
- Open PR with summary + test plan + Phase D plan link.
- Iterate per CLAUDE.md PR workflow until merge-ready.

## Risks

| Risk | Mitigation |
|------|------------|
| DNS lookup fails for legitimate publisher feed (intermittent DNS issue) | `network_error` already covers this; the fetch path returns the same error code. |
| Rate-limit table writes cost too much | DDB on-demand pricing is per-request; <100B per record; TTL evicts after the window. |
| In-memory fallback diverges from DDB behavior | Both implementations satisfy the same `RateLimitService` interface; tests run against the in-memory one and the integration test exercises the DDB one. |
| HTTPS fetch by literal IP breaks SNI validation | We chose NOT to fetch by resolved IP — see D1 decision note. |
| Re-send button lets a hostile actor exhaust SES quota faster | Rate limiter (now DDB-backed, per-IP) still gates the underlying request; the button is just a UX nudge. |

## Estimate

| Task | Effort |
|------|--------|
| D0 plan | 30 min |
| D1 DNS resolution + tests | 60 min |
| D2 rate limiter + tests + wiring | 90 min |
| D3 re-send UX | 20 min |
| D4 polish | 30 min |
| D5 terraform | 30 min |
| D6 verify + PR | 30 min |
| **Total** | **~5 hours** |
