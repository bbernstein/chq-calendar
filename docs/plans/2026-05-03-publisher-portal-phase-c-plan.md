# Publisher Portal — Phase C implementation plan

**Date:** 2026-05-03
**Branch:** `feat/publisher-portal-phase-c`
**Depends on:** Phase A (`/publish/test/`) + Phase B (apply + magic-link auth) — both shipped via PR #83.
**Design doc:** `docs/plans/2026-05-03-publisher-portal-design.md` (section "Phase C").

## Goal

Close the publisher self-service loop:

1. **Admin** can see pending applications and approve / reject them from the
   existing `/admin/publishers/` page.
2. **Publisher** can sign in to `/publish/status/` (via the existing
   magic-link auth) and see their application status, current publisher
   record, and recent fetch outcomes.
3. **Publisher** receives an email when their application is approved or
   rejected, so they don't have to poll.

## Out of scope (deferred to Phase D)

- Per-publisher feed history beyond the single "last fetch" already on the
  record (would need a new audit table).
- Publisher-side "edit my source URL" action — for v1 they email the admin.
- DNS-rebinding mitigation in `urlGuard`.
- Per-IP rate-limit moved off in-memory storage.
- CAPTCHA on apply.
- "Re-send magic link" UX polish (the existing apply page covers this if a
  publisher knows their email; we won't add a dedicated re-send button yet).

## Constraints

- Follow project CLAUDE.md: never commit to main, run `npm run validate &&
  npm run build` before each commit, comprehensive commit messages.
- Frontend uses Preact (`'preact/hooks'` imports), Vite multi-page setup —
  every new page needs an `index.html` + entry in `src/entries/` + entry
  registered in `vite.config.ts`.
- Backend tests live next to the service / handler, follow the existing
  Jest pattern (mocked AWS SDK clients via `aws-sdk-client-mock`).
- Logs MUST redact email addresses (reuse the redaction helper used in
  `adminHandler.ts`).
- Admin endpoints sit on the existing `admin_handler` Lambda behind the
  Google-OAuth-issued JWT (`useAdminAuth` on the frontend).
- Publisher status endpoint sits on the SAME admin_handler Lambda (we plumb
  it through `publisherPortalHandler.ts` like the Phase B endpoints) but
  authenticates with the publisher JWT, not the admin JWT.
- All four "to add" Terraform resources from Phase B are already live; no
  new infra in Phase C unless we discover a gap.

## Task breakdown

- [ ] C0 — This plan doc.
- [ ] C1 — Backend admin endpoints for pending applications.
- [ ] C2 — Backend approval / rejection emails (extend `mailService`).
- [ ] C3 — Backend publisher-status endpoint (`GET /api/publisher-status`).
- [ ] C4 — Frontend admin page extensions (pending list + approve/reject UI).
- [ ] C5 — Frontend `/publish/login/` page (request magic-link by email).
- [ ] C6 — Frontend `/publish/status/` page (own status + recent fetch).
- [ ] C7 — `/publish/verify/` success redirect: login → `/publish/status/`,
       apply → `/publish/` (existing).
- [ ] C8 — Build verification + tests pass + open PR.

---

### C1 — Backend admin endpoints for pending applications

**Files:**

- `backend/src/services/publisherAdminService.ts` — new methods:
  - `listPendingApplications(): Promise<PublisherRecord[]>` → delegates to
    `registry.listPending()`.
  - `approveApplication(id, reviewerEmail): Promise<PublisherRecord>` →
    sets `applicationStatus = 'approved'`, `enabled = true`, persists
    `reviewedAt + reviewerEmail`, **clears any previous `rejectionReason`**,
    returns the updated row. Sends approval email (C2 dependency).
  - `rejectApplication(id, reviewerEmail, reason?): Promise<PublisherRecord>`
    → sets `applicationStatus = 'rejected'`, `enabled = false` (defensive),
    persists `reviewedAt + reviewerEmail + rejectionReason`. Sends rejection
    email (C2 dependency).
  - **Both methods refuse to act unless** the existing row's
    `applicationStatus === 'pending'`. Throw a typed error caught by the
    handler so it can return HTTP 409 instead of 500.
- `backend/src/handlers/adminHandler.ts` — new routes:
  - `GET /publisher-applications/pending` → returns `{ applications: [...] }`.
  - `POST /publisher-applications/:id/approve` → 200 with updated record.
  - `POST /publisher-applications/:id/reject` → 200 with updated record.
    Body may include `{ reason?: string }` (truncated to 500 chars).
  - All three guarded by the existing admin JWT middleware.
- `backend/src/services/publisherAdminService.test.ts` — tests for the new
  methods (success, refuse-when-not-pending, registry failure paths).
- `backend/src/handlers/adminHandler.test.ts` (or the matching test file) —
  routing tests for the three new paths.

**Edge cases to cover:**

- Approving a publisher whose `id` was admin-created and never had an
  `applicationStatus` field at all → 409 (not "pending"). The frontend will
  not surface those rows in the pending section, so this should not happen
  in normal use; we still want the backend to refuse.
- Rejecting twice → second call 409.
- Reason longer than 500 chars → truncated, no error.

### C2 — Approval / rejection emails

**Files:**

- `backend/src/services/mailService.ts` — add two methods:
  - `sendApprovalEmail({ to, publisherName, statusPageUrl })`.
  - `sendRejectionEmail({ to, publisherName, reason?, applyAgainUrl })`.
- Plain-text bodies (the existing `mailService` already sends text-only for
  magic-link, so we keep parity). Subjects:
  - "Your Chautauqua Calendar publisher application is approved"
  - "Update on your Chautauqua Calendar publisher application"
- The existing `siteBaseUrl` constructor argument feeds the URLs.
- Tests in `mailService.test.ts` — verify SESv2 client is called with the
  correct `Destination`, `Subject`, and body content.

**Failure handling:** if the email send throws, the approval/rejection
state change must still persist (the user can re-trigger by clicking
approve again — but our pending check would block them). Alternative: log
the email failure but return 200; admin can re-send manually. Pick the
**log-and-200** path; surface the email failure in CloudWatch only.

### C3 — Publisher status endpoint

**Files:**

- `backend/src/handlers/publisherPortalHandler.ts` — new export
  `handlePublisherStatus(event, _body)`:
  - Extracts `Authorization: Bearer <jwt>` from headers.
  - Calls `verifyPublisherJwt` from `publisherAuthService`.
  - On invalid / missing token → 401 `{ error: 'Authentication required' }`.
  - On valid token: looks up the publisher by `claims.sub`. If the row no
    longer exists → 404. If found → returns:
    ```
    {
      publisher: { id, name, contactEmail, sourceUrl, sourceType,
                   applicationStatus, enabled, createdAt,
                   reviewedAt?, rejectionReason?,
                   lastFetchedAt?, lastFetchStatus?, lastFetchMessage? }
    }
    ```
  - The fetch outcome fields are already on the row — no extra work.
  - **NEVER** include the `pendingThresholdHalt` blob; that's an internal
    operations signal, not for publishers.
- `backend/src/handlers/adminHandler.ts` — route `GET
  /api/publisher-status` to the new handler (the route is in the public
  `/api/...` namespace, mirroring the other Phase A/B publisher routes).
  This lives **outside** the admin-JWT branch — the publisher JWT check
  happens inside the handler.
- Tests: `publisherPortalHandler.test.ts` adds cases for missing token,
  bad token, expired token, deleted publisher, happy path.

### C4 — Frontend admin page extensions

**Files:**

- `frontend/src/lib/adminPublisherApi.ts` — add:
  - `listPendingApplications(): Promise<PublisherRecord[]>`.
  - `approveApplication(id): Promise<PublisherRecord>`.
  - `rejectApplication(id, reason?): Promise<PublisherRecord>`.
  - Extend `PublisherRecord` type with `applicationStatus?: 'pending' |
    'approved' | 'rejected'`, `reviewedAt?: string`, `reviewerEmail?:
    string`, `rejectionReason?: string`. (The existing rows without these
    fields stay backwards compatible — `applicationStatus === undefined`
    is treated as approved/admin-created in the UI.)
- `frontend/src/app/admin/publishers/page.tsx` — render a **"Pending
  Applications"** section ABOVE the existing publisher table, only when
  there are pending rows. Each pending row shows id, name, email,
  source URL, sourceType, createdAt, plus two buttons:
  - **Approve** — POST to `approveApplication(id)`, on success refetch
    both the pending list and the publisher list.
  - **Reject** — opens an inline textarea + Confirm/Cancel; on Confirm,
    POST to `rejectApplication(id, reason)`. Reason is optional but
    encouraged (placeholder text guides the admin).
- After each action, optimistic UI: while in flight, disable the buttons
  for that row. Errors render inline in the row.
- The existing publisher table excludes pending rows (filter
  `applicationStatus !== 'pending'`).
- A small "View source" button per pending row opens the URL in a new
  tab (target="_blank" rel="noreferrer noopener").
- A "Test feed" link per pending row opens
  `/publish/test/?url=<encoded>&sourceType=<type>` (the test page already
  reads URL query params? — verify; if not, this becomes a Phase D follow-up).

**Verification (UI):**

- Approve a pending row → it disappears from the pending section, appears
  in the main publisher table with `enabled = true`.
- Reject with reason → disappears from pending, no longer in main table
  (since enabled is false; user can flip "show disabled" if we add it —
  for v1 the disabled rows are visible but greyed; that already works).

### C5 — Frontend `/publish/login/` page

**Files:**

- `frontend/publish/login/index.html`
- `frontend/src/entries/publish-login.tsx`
- `frontend/src/app/publish/login/page.tsx`
- `frontend/vite.config.ts` — register the new entry.

The page is a single email input + submit button. On submit, POST to
`/api/publisher-auth/request` and show an "If your email is on file, you
will receive a sign-in link" message regardless of outcome (anti-enumeration,
the backend already enforces this). Disable the button for 60 seconds
after submit to discourage spamming the SES quota.

If the user is **already authenticated** (`isPublisherAuthenticated()` →
true) when they land here, redirect to `/publish/status/`.

Add a "Sign in" link to `/publish/` that points here.

### C6 — Frontend `/publish/status/` page

**Files:**

- `frontend/publish/status/index.html`
- `frontend/src/entries/publish-status.tsx`
- `frontend/src/app/publish/status/page.tsx`
- `frontend/src/lib/publisherStatusApi.ts` — `getPublisherStatus()` that
  reads JWT from `publisherAuthClient`, calls `GET /api/publisher-status`,
  and on 401 clears the session and redirects to `/publish/login/`.
- `frontend/vite.config.ts` — register the new entry.

The page renders three states:

1. **Pending review** — friendly message, what happens next, contact email
   for questions, "Sign out" button.
2. **Approved** — publisher card showing name/id/source URL/sourceType/
   trust level/enabled flag, plus "Last fetch" panel (status, timestamp,
   message). "Sign out" button.
3. **Rejected** — rejection message + reason (if any), "Apply again" link
   to `/publish/apply/`, "Sign out" button.

If no JWT or expired → redirect to `/publish/login/` (no flash of content).

### C7 — `/publish/verify/` redirect tweak

In the existing `Success` component, when `purpose === 'login'`, the CTA
button text changes to "Go to your account" and links to `/publish/status/`
instead of `/publish/`. The apply path keeps its existing copy and
`/publish/` link.

(Could also auto-redirect after 1.5s, but explicit click is fine.)

### C8 — Verification + PR

- `cd frontend && npm run validate && npm run build` — clean.
- `cd backend && npm test` — all green (the Phase B baseline was 338/338;
  C1-C3 will add ~25-40 more tests).
- Smoke test in dev: apply → admin approves → status page shows approved.
- Open PR with summary, test plan, and pointer to design + plan docs.

## Risks

| Risk | Mitigation |
|------|------------|
| Approval-email failure leaves admin uncertain about state | Log to CloudWatch; status change still persists; admin sees the publisher row in approved state and can re-send via console for now (Phase D adds a re-send button). |
| Publisher JWT verification on `/api/publisher-status` slows that endpoint (Secrets Manager fetch) | `publisherSecretCache` already memoizes the JWT secret — the second call onward is hot. |
| Admin clicks Approve twice in rapid succession | Backend 409 on second click; frontend disables button while in flight. |
| Pending row has data that fails the existing `PublisherRecord` schema | The list endpoint returns the raw row; the UI defensively `??`-guards optional fields. |
| Test page doesn't accept URL query params | If true, the "Test feed" link in C4 becomes a tooltip-only "Copy URL" + manual paste; defer the proper deep-link to Phase D. |

## Estimate

| Task | Effort |
|------|--------|
| C0 plan | 30 min |
| C1 admin endpoints + tests | 90 min |
| C2 emails + tests | 45 min |
| C3 status endpoint + tests | 60 min |
| C4 admin frontend | 90 min |
| C5 login page | 45 min |
| C6 status page | 90 min |
| C7 verify tweak | 15 min |
| C8 smoke + PR | 30 min |
| **Total** | **~8 hours** |
