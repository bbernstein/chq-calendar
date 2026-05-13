> **Status:** Shipped via PR #98 (`11b8587`) with follow-ups in PR #115
> (`ad51483`). Kept for architectural context — the self-service profile,
> email-change, and ingest-controls flows described here still govern
> current code.

# Publisher portal self-service — design

**Date**: 2026-05-05
**Status**: Design (awaiting implementation plan)
**Builds on**: Phases A–D of the publisher portal (`docs/plans/2026-05-03-publisher-portal-design.md`).

## Problem

After Phase D the publisher portal is a one-way street. A publisher can apply, sign in, and view their record, but cannot edit anything about themselves. Every change — fixing a typo in their feed URL, switching from iCal to JSON, moving to a new contact email, taking the feed offline temporarily — is a support request. We also have no defence against the same email being used to apply twice and ending up with two registry rows.

## Goals

Give an approved publisher direct, self-service control over their record:

- Edit name, organization, source URL, source type.
- Change contact email with double-opt-in (verify new + notify old).
- Manually trigger an out-of-cycle ingest of their own feed.
- Pause and resume their own ingest.
- Self-disable (permanent from the publisher's side; soft-deleted on the registry).

And close one outstanding correctness gap surfaced by the email-change flow:

- Apply form rejects emails that already belong to a registered publisher.

## Non-goals

- Editing publisher slug / ID (never user-mutable).
- Pending-applicant edits before approval — applicants who want to change their submission re-apply.
- Rejected-applicant in-place re-apply.
- Diff-view preview (`"3 events would be added, 2 removed"`) — the standalone preview-against-proposed-config is enough for v1.
- Audit history beyond `lastFetchedAt` — needs a new audit table; tracked separately.
- Download-my-events JSON export.
- Multi-publisher per email.
- Publisher-initiated re-enable after self-disable (admin action only).

## Decisions in scope

The brainstorming session settled on:

| Question | Decision |
|----------|----------|
| Who can edit? | Approved publishers only. Pending and rejected accounts cannot edit. |
| Validation strictness | Loose on name/organization; strict on URL + sourceType (must pass `resolveAndValidateUrl` + `publisherTestService.fetchAndValidate` before save); email change goes through double-opt-in. |
| Test/preview tool | Pre-fill from current registry values when authenticated. Editing URL/sourceType requires a successful preview before the Save button enables; backend re-validates server-side regardless. |
| Email change | Force re-login of the current session on verify (via `tokenVersion` bump). |
| Apply form uniqueness | Reject submissions whose email already belongs to any existing publisher row (any `applicationStatus`). Generic error message. |
| Extra portal operations | Manual fetch-now (A) + pause/resume (B) + self-disable (C) in scope. View-history (D) and JSON export (E) deferred. |

## Architecture

A new "manage" surface layered on top of the existing Phase A–D foundation. No new services or tables; everything reuses what's already in production.

### Frontend

- `/publish/status/` becomes the publisher's home page. Today it is read-only; in this round it gains:
  - Inline pencil-icon edits for **Name** and **Organization** on `PublisherCard`.
  - Combined "Edit source" panel that opens when **Source URL** or **Source type** is edited.
  - "Change email" action with confirmation banner.
  - New **Ingest controls** section (pause/resume, fetch-now).
  - **Danger zone** footer with Self-disable.
- New routes for the email-change confirmation/cancel landing pages, mirroring the `/publish/verify/` pattern:
  - `/publish/email-change/verify/` — new-address click target.
  - `/publish/email-change/cancel/` — old-address abuse escape hatch.

### Backend

New authenticated routes added to `publisherPortalHandler.ts`. All require `requirePublisherAuth` and pass through the existing `DynamoRateLimiter`.

| Route | Purpose |
|-------|---------|
| `PATCH /publisher/me` | Update name / organization / sourceUrl / sourceType (validation gate on URL/sourceType). |
| `POST /publisher/me/email-change` | Initiate email change. |
| `DELETE /publisher/me/email-change` | Cancel pending email change from the publisher's own session. |
| `GET /publish/email-change/verify?token=…` | New-address one-shot verification (browser-clickable; not JWT-gated). |
| `GET /publish/email-change/cancel?token=…` | Old-address one-shot cancel (browser-clickable; not JWT-gated). |
| `POST /publisher/me/fetch-now` | Trigger an out-of-cycle ingest of *just this publisher's* feed. |
| `POST /publisher/me/pause` | Set `enabled=false` with `selfPaused: true`. |
| `POST /publisher/me/resume` | Set `enabled=true`, clear `selfPaused`. |
| `POST /publisher/me/disable` | Soft self-disable (typed-confirmation gate; not reversible by the publisher). |

### DynamoDB

No new tables. Two new item shapes added to existing tables:

- **Pending email change** (in the existing magic-token table):

  ```
  pk: pending_email_change#<publisherId>
  publisherId
  oldEmail
  newEmail                 # lowercased, trimmed
  verifyToken              # 32-byte random hex; one-shot
  cancelToken              # 32-byte random hex; one-shot
  requestedAt: ISO8601
  expiresAt:  ISO8601      # 24h after requestedAt
  ttl:         epoch_seconds (matches expiresAt)
  ```

- **Email-change lock** (sentinel that blocks new email-change attempts after a `cancel-by-old-address`):

  ```
  pk: email_change_lock#<publisherId>
  publisherId
  lockedUntil: ISO8601     # 24h after the cancel
  ttl:         epoch_seconds (matches lockedUntil)
  ```

### Publisher registry record

Two new fields on each publisher row:

- `tokenVersion: number` (default `0`). Bumped on email-change verify and on self-disable. Issued JWTs include the version; the auth helper rejects mismatches with 401.
- `selfPausedAt?: ISO8601` and `selfDisabledAt?: ISO8601`. Distinguish self-actions from admin-actions for the admin dashboard. (The boolean `paused` field already exists; these timestamps annotate it.)

### Apply-form uniqueness

A new check in `publisherApplicationService.requestApply`: query the registry by email, reject collisions. Implementation depends on whether a `contactEmail` GSI already exists on the registry table:

- If yes → straight `Query`.
- If no → add the GSI in the same Terraform change. A `Scan` is not acceptable; this check fires on every apply submission.

The same uniqueness function is reused inside `POST /publisher/me/email-change` at submit and re-asserted inside the verify transaction (race guard).

## Edit flows on `/publish/status/`

### Name and organization

Inline pencil-icon edits on `PublisherCard`. Clicking the icon turns the value into a text input with Save/Cancel. Save calls `PATCH /publisher/me` with the changed field. Validation: 1–200 chars, trimmed; reject empty `name`, allow empty `organization`. No preview, no confirmation modal.

### Source URL and source type

Single combined edit panel — these two fields share a validation gate.

1. URL input + source-type radio, defaulted to current values.
2. **Preview** button calls `POST /publisher/test/` (reuses public test endpoint) with the proposed values; renders the same result UI as `/publish/test/`.
3. **Save changes** stays disabled until a successful preview matches the current form values. On click, calls `PATCH /publisher/me`. Backend re-runs `resolveAndValidateUrl` + `publisherTestService.fetchAndValidate` server-side; never trusts the client preview. On failure: render the same error UI as the test page; no save.
4. **Cancel** discards.

### Email change

Separate "Change email" affordance because the flow is async.

- Click → modal: "Enter new email address."
- Submit → `POST /publisher/me/email-change`. Modal closes; status page shows a yellow banner: *"Pending verification by `n***@example.com`. We've sent a confirmation link to that address. [Cancel change]"*.
- Cancel-from-own-session calls `DELETE /publisher/me/email-change` (distinct from the old-address one-shot abuse link). Banner persists until verification, expiry, or cancel.

### Ingest controls section

Below `LastFetchPanel`. Three controls:

- **Pause / Resume** toggle. Pause shows a confirmation modal that says *"Pausing stops new fetches of your feed. Your previously-published events stay live on the calendar until you Resume or Disable."* This matches the registry's existing `paused` semantics — paused publishers skip the fetch loop but their events are NOT retracted (only `enabled=false` retracts via PR #78).
- **Fetch now** button, disabled with countdown when rate-limited. Submits to `POST /publisher/me/fetch-now`.

### Danger zone footer

Red-bordered card with a single "Disable my publisher" button. Click opens a typed-confirmation modal: must echo the publisher slug exactly to enable Confirm. Submits to `POST /publisher/me/disable`.

## Email-change state machine

```
                                          ┌─────────────────────────┐
                                          │  no pending change      │
                                          └────────────┬────────────┘
                                                       │ POST /publisher/me/email-change
                                                       │  • check newEmail unique across registry
                                                       │  • check no email_change_lock for this publisher
                                                       │  • supersede any existing pending row (atomic Put)
                                                       │  • send 2 emails (verify-link to new, cancel-link to old)
                                                       ▼
                                          ┌─────────────────────────┐
                                          │  pending                │
                                          │  banner shown on status │
                                          └─┬────────┬──────────┬───┘
                          GET /verify?token │        │          │  DELETE /publisher/me/email-change
                          (new address)     │        │          │  (publisher cancels from own session)
                                            │        │          │
                          GET /cancel?token │        │          │
                          (old address)     │        │ TTL      │
                                            │        │          │
                                            ▼        ▼          ▼
                                    ┌──────────┐ ┌────────┐ ┌──────────┐
                                    │ verified │ │ locked │ │  cleared │
                                    │ + commit │ │ 24h    │ │  (no-op) │
                                    └──────────┘ └────────┘ └──────────┘
```

### On verify (new-address click)

1. Atomic transaction:
   - Re-check `newEmail` is still unique in the registry (race guard against another applicant snatching it during the 24h window).
   - Update registry row: `contactEmail = newEmail`, increment `tokenVersion`.
   - Delete pending row (`ConditionExpression` on `verifyToken` so a double-click 404s the loser).
2. Send confirmation emails to **both** old and new addresses ("your publisher email was changed").
3. HTTP redirect to `/publish/login/?email=<new>&reason=email-changed`. The login page reads `reason` and shows: *"Email changed successfully. Sign in with your new address."* The publisher's previous browser tab is still authenticated against the old `tokenVersion`; its next API call returns 401 and the existing `publisherAuthClient` redirect-to-login fires automatically.

### On cancel-by-old-address (one-shot link in the warning email)

1. Delete pending row.
2. Write `email_change_lock#<publisherId>` with `lockedUntil = now + 24h`.
3. Page response: *"Email change cancelled. We've locked email-change requests on this account for 24 hours."*
4. Send a notification to **both** old and new addresses so the legitimate publisher (if it was them) sees the cancel landed.

### On cancel-by-publisher (own logged-in session)

1. Delete pending row. No lock — they cancelled their own request.

### On expiry (24h TTL)

1. DDB removes the row. No email. Banner disappears next time the publisher loads `/publish/status/`.

### Edge cases enforced

| Case | Behaviour |
|------|-----------|
| New email belongs to another publisher (any status) | 409 at submit; generic message. |
| New email belongs to *this* publisher (no-op rename) | 400 at submit; "you're already using that email." |
| `email_change_lock` in effect | 423 at submit; "Email changes are temporarily locked on this account; try again after `<lockedUntil>`." |
| Stale verify-token (already used / expired / superseded) | Friendly error page; link to `/publish/login/`. |
| Stale cancel-token | Friendly error page; link to `/publish/login/`. |
| Two simultaneous verify clicks | DDB `ConditionExpression` on the delete makes one win; the other 404s. |
| Race: another publisher applies with the new email between submit and verify | Verify-side uniqueness check fails the transaction; the verifier sees a clear error and the pending row stays so they can cancel cleanly. (Not auto-cancelled — admin-visible signal.) |
| New-email apply request submitted *while* a pending change exists for that email | Apply form's uniqueness check has to consider both the registry table *and* active `pending_email_change` rows that target the email; otherwise we'd let two flows race for the same address. Implementation: after the registry check, also `Query` the magic-token table for a `pending_email_change` row whose `newEmail` matches; reject the apply if one exists. |
| Publisher self-disables while pending email change exists | Disable transaction also deletes the pending row. |

### JWT `tokenVersion` mechanism

- Publisher registry row gains `tokenVersion: number` (default `0`).
- Issued JWTs include `{ sub: publisherId, email, tokenVersion }`.
- `requirePublisherAuth` middleware compares JWT `tokenVersion` against the current registry value; mismatch → 401.
- Bumped on: email-change verify, self-disable. Not bumped on routine login or profile edits.

## Manual fetch-now / pause / resume / self-disable

All on `publisherPortalHandler.ts` under `/publisher/me/*`. All `requirePublisherAuth` + per-publisher rate-limited via `DynamoRateLimiter`.

### `POST /publisher/me/fetch-now`

Invokes the `chautauqua-calendar-publisher-ingest` Lambda asynchronously with payload `{ publisherId: <self> }`. The Lambda already accepts a single-publisher mode (PR #96 added it for the admin "run-ingest" button). Rate limit: 1 invocation per publisher per 5 minutes (sliding window in the existing rate-limit table). Response: `202 { acceptedAt }`. The status page polls and updates `lastFetchedAt` after the run completes.

### `POST /publisher/me/pause`

Sets `paused=true` and `selfPausedAt=now` on the registry row via a new `setPausedFlag` helper. The ingest loop already skips publishers with `enabled && paused` — events stay live, fetches stop. Idempotent.

### `POST /publisher/me/resume`

Sets `paused=false`, clears `selfPausedAt`. The next ingest run resumes fetching. Idempotent.

### `POST /publisher/me/disable`

Typed-confirmation gate: request body must include `confirmSlug` matching the publisher's slug exactly; mismatch → 400. On confirm:

- Set `enabled=false`, `selfDisabledAt = now`, increment `tokenVersion`.
- Delete any active `pending_email_change` row.
- Send a confirmation email to the contact address.
- Events are retracted on next ingest run via PR #78 logic.

The publisher record is **not deleted** — it stays in the registry with `enabled=false` so a future "re-enable" support request keeps the slug.

**Why disable is one-way from the publisher's side**: if self-disable were also self-reversible, an attacker who briefly compromises a session could pause-then-resume to mask their tracks, or just toggle the publisher on/off as harassment. Re-enable is an admin action, consistent with how Phase D treats other identity-changing events.

## Apply-form uniqueness check

In `publisherApplicationService.requestApply`, before creating or refreshing a pending application:

1. Query the registry by `contactEmail` (lowercased, trimmed). Any row → reject.
2. Query the magic-token table for any active `pending_email_change` row whose `newEmail` matches → reject.
3. If both pass, create the application with a `ConditionExpression` that re-asserts no registry row exists for the email at write time. Race-loser → reject with the same generic error.

**Generic error message**: *"We can't accept this email address. If you already have a publisher account, sign in at [/publish/login/]."* Does not leak whether the address is approved, pending, rejected, or attached to a pending change.

## Testing strategy

### Service-layer unit tests

Each new service method gets a dedicated test file using the existing in-memory DDB harness:

- `updatePublisherProfile` — happy path per field; URL/sourceType validation gate; rejection paths.
- `initiateEmailChange` — uniqueness check; lock check; supersedes prior pending; emits two emails.
- `verifyEmailChange` — happy path; race-loser uniqueness; double-click; expired token; superseded token; commits `tokenVersion` bump.
- `cancelEmailChangeByOldAddress` — happy path; writes lock row; double-click idempotent.
- `cancelEmailChangeByPublisher` — happy path; no lock written.
- `selfDisablePublisher` — happy path; bumps `tokenVersion`; deletes pending email-change; idempotent.
- `triggerSelfFetch` — invokes Lambda; rate-limit enforcement.
- `requestApply` uniqueness — registry collision; pending-change collision; race-loser path.

### Handler-layer tests

For each new route: 401 without JWT; 401 on `tokenVersion` mismatch; 429 after rate-limit; happy path 200/202; validation rejection 400/409/423.

### Frontend tests

Vitest + Testing Library on the new edit components:

- Name/org inline edit submits and updates in place.
- Source-edit panel: Save disabled until a successful preview matches current form values.
- Source-edit panel: server-side rejection re-renders the test-result error UI.
- Email-change banner appears post-submit; cancel button dismisses.
- Pause confirmation modal explicitly mentions retraction.
- Self-disable typed-confirmation modal: Confirm disabled until slug matches exactly.

### End-to-end CI test

Extend the publisher-ingest E2E test (per `publisher-ingest-e2e-ci-test-status.md` memory) with a new path:

apply → approve → log in → edit URL with preview → fetch-now → assert events ingested under new URL → change email → verify via mock SES outbound → assert old-session JWT 401s → re-login with new email succeeds.

Mock SES outbound is already wired in that test.

## Files affected

This is the design's best estimate. The implementation plan will refine.

### Backend

- `services/publisherProfileService.ts` — **new**. `updatePublisherProfile`, validation gate.
- `services/publisherEmailChangeService.ts` — **new**. Initiate, verify, cancel-by-old, cancel-by-self.
- `services/publisherSelfActionService.ts` — **new**. fetch-now, pause, resume, disable.
- `services/publisherApplicationService.ts` — uniqueness check + race guard.
- `services/publisherRegistryService.ts` — `tokenVersion` reads/writes; `selfPaused` / `selfDisabledAt` markers.
- `services/mailService.ts` — new templates: email-change-verify, email-change-cancel-warning, email-changed-confirmation, self-disabled-confirmation.
- `handlers/publisherPortalHandler.ts` — eight new routes plus the email-change verify/cancel pages.
- `middleware/requirePublisherAuth.ts` (or wherever JWT verification lives) — `tokenVersion` check.

### Frontend

- `app/publish/status/page.tsx` — inline edits, source-edit panel, ingest controls section, danger zone, email-change banner.
- `app/publish/email-change/verify/page.tsx` — **new**. Renders verify result.
- `app/publish/email-change/cancel/page.tsx` — **new**. Renders cancel result.
- `app/publish/login/page.tsx` — read `?reason=email-changed` query param and surface success banner.
- `lib/publisherStatusApi.ts` — patch / pause / resume / fetch-now / disable / email-change clients.
- `lib/publisherAuthClient.ts` — already redirects on 401; nothing to change but verify the path holds.

### Infrastructure

- `infrastructure/publisher-portal.tf` — possibly a new `contactEmail` GSI on the registry table; admin Lambda env vars for any new mail template references.

## Resolved during plan-writing (was open in design)

These questions were left open for the plan-writing pass and have now been resolved by reading the code:

1. **`contactEmail` GSI**: The publishers table has only an `id` hash key — no GSI. `publisherRegistryService.getByEmail` already scans with a self-comment ("if this grows past a few hundred rows, add `by-contactEmail` GSI"). The registry currently has dozens of rows, so the plan keeps Scan and does not add a GSI in this round. Revisit when row count crosses ~200.
2. **JWT mint site**: `signPublisherJwt` in `backend/src/services/publisherAuthService.ts`. Verification is `verifyPublisherJwt` in the same file, called inline (no central middleware). The plan adds `tokenVersion` to the claims and introduces a small `requirePublisherSession` helper that performs the JWT verify *and* the registry-row `tokenVersion` comparison; new routes use the helper, existing routes are migrated.
3. **Single-publisher ingest**: Does NOT exist today. The admin "run-ingest" button (PR #96) invokes the whole Lambda with payload `{ source: 'admin-ui', triggeredBy, triggeredAt }`. The plan adds a `singlePublisherId?: string` field to the payload and an early branch in `runIngest` that processes only the named publisher (passing through whatever bucket — active/paused/disabled — they currently sit in).
4. **`setApplicationStatus` for resume**: Built around the approve/reject lifecycle (mutates `reviewerEmail`, `rejectionReason`, etc.). Reusing it for pause/resume would clobber review state. The plan adds new dedicated helpers `setPausedFlag(id, paused, opts)` and `setSelfDisabled(id)` to `publisherRegistryService.ts`; `setApplicationStatus` keeps its review-only role.
