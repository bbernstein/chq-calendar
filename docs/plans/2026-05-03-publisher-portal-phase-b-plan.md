# Publisher Portal — Phase B implementation plan

**Status:** in progress (started 2026-05-03)
**Branch:** `feat/admin-index-and-publisher-portal`
**Design doc:** `docs/plans/2026-05-03-publisher-portal-design.md`

Phase B = email magic-link auth + apply flow. Phase A (URL test tool) and
the prereq infra (Secrets Manager + magic-token DDB table + IAM) are
already shipped in this branch.

## Goals

1. Prospective publishers can submit an application from `/publish/apply/`
   without a Google account. Email verification gates entry.
2. Approved publishers can sign in to `/publish/status/` (Phase C) via the
   same magic-link mechanism.
3. The application data lands in the existing `publishers` DynamoDB table
   with `applicationStatus = 'pending'` for an admin to approve in Phase C.
4. JWTs issued to publishers are signed with a key SEPARATE from the admin
   JWT — a publisher-token leak must not enable admin impersonation.

## Non-goals

- Phase C admin approval UI (different commit, same branch later).
- Phase D polish: DNS-rebinding mitigation, per-IP rate-limit moved to
  DynamoDB, CAPTCHA. Acceptable risks for now (documented, low-traffic).

## Architecture decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Magic-link tokens are 32-byte base64url strings; only SHA-256 hash stored in DDB. | A table-leak does not enable account takeover; raw tokens never persisted. |
| 2 | Token row stashes the full apply-form payload for `purpose='apply'`. | Avoids a second "pending applications" table; payload is short-lived (15 min TTL). |
| 3 | One magic-token table holds both `apply` and `login` purposes. | Same shape, same lifecycle; discriminator on the row keeps lookup trivial. |
| 4 | `applicationStatus` is OPTIONAL on `PublisherRecord`. Missing OR `'approved'` = approved. | Backwards-compat: existing rows have no field and remain enabled. |
| 5 | JWT: HS256, 7-day expiry, `role: 'publisher'` claim, secret cached per Lambda warm container. | Matches admin pattern; cheap to verify; rotation is rare. |
| 6 | Magic-link URL: `https://www.chqcal.org/publish/verify/?token=<raw>&purpose=<apply\|login>`. | Verify page consumes token via API, then localStorage's `chq_publisher_jwt`. |
| 7 | Rate-limit `/apply/request` and `/auth/request` per-IP at 10/hour, in-memory (same pattern as `/publisher-test`). | Phase D moves to DynamoDB; in-memory is sufficient at current traffic. |
| 8 | `/auth/request` ALWAYS returns 200 regardless of whether the email matches a known publisher. | Email enumeration prevention; the email body is the side-channel that confirms or fails. |
| 9 | SES via `@aws-sdk/client-sesv2`, SendEmail v2 with HTML+text body. | v2 is the current API; supports configuration sets if we add bounce tracking later. |

## File map

### Backend (new)

- `services/publisherSecretCache.ts` — `getPublisherJwtSecret()`, lazy load + cache.
- `services/magicTokenService.ts` — `issueToken()`, `consumeToken()`. SHA-256 hashing, DDB persistence with TTL.
- `services/mailService.ts` — `sendApplyMagicLink()`, `sendLoginMagicLink()`. SESv2 wrapper.
- `services/publisherAuthService.ts` — `signPublisherJwt()`, `verifyPublisherJwt()`.
- `services/publisherApplicationService.ts` — orchestrates the four flows: apply request/verify, login request/verify.

### Backend (modified)

- `types/publisher.ts` — extend `PublisherRecord` with `applicationStatus`, `appliedAt`, `reviewedAt`, `reviewerEmail`, `rejectionReason`. Add `ApplyFormPayload` type.
- `services/publisherRegistryService.ts` — `getByEmail()`, `listPending()`, `setApplicationStatus()`.
- `handlers/publisherPortalHandler.ts` — add 4 routes: `handlePublisherApplyRequest`, `handlePublisherApplyVerify`, `handlePublisherAuthRequest`, `handlePublisherAuthVerify`.
- `handlers/adminHandler.ts` — route the new paths through `publisherPortalHandler`.

### Frontend (new)

- `frontend/publish/apply/index.html`
- `frontend/publish/verify/index.html`
- `frontend/src/entries/publish-apply.tsx`
- `frontend/src/entries/publish-verify.tsx`
- `frontend/src/app/publish/apply/page.tsx`
- `frontend/src/app/publish/verify/page.tsx`
- `frontend/src/lib/publisherAuthClient.ts` — localStorage helpers (`chq_publisher_jwt`).

### Frontend (modified)

- `frontend/src/app/publish/page.tsx` — enable "Apply" CTA (was "Coming soon").
- `frontend/vite.config.ts` — add `publish-apply`, `publish-verify` rollup inputs.

### Infra (modified)

- `infrastructure/main.tf` — add env vars to `aws_lambda_function.admin_handler`:
  - `PUBLISHER_JWT_SECRET_ARN`
  - `PUBLISHER_MAGIC_TOKEN_TABLE_NAME`
  - `SES_FROM_ADDRESS`
  - `SITE_BASE_URL` (so the magic-link URL is environment-aware).

### Tests (new)

- `__tests__/magicTokenService.test.ts`
- `__tests__/mailService.test.ts` (mocks SESv2 client)
- `__tests__/publisherAuthService.test.ts`
- `__tests__/publisherApplicationService.test.ts`
- `__tests__/publisherPortalHandler.apply.test.ts`

## Task breakdown

Each task is one commit. All commits to `feat/admin-index-and-publisher-portal`.

- [x] B0 — Plan doc (this file)
- [x] B1 — Types + registry extension + tests (5 new tests)
- [x] B2 — `publisherSecretCache` + `magicTokenService` + tests (9 new tests)
- [x] B3 — `mailService` + tests (5 new tests)
- [x] B4 — `publisherAuthService` (JWT) + tests (7 new tests)
- [x] B5 — `publisherApplicationService` + tests (15 new tests)
- [x] B6 — `publisherPortalHandler` routes + adminHandler routing + handler tests (11 new tests)
- [x] B7 — `main.tf` admin_handler env-var wiring + esbuild externals + deploy workflow deps
- [x] B8 — Frontend `/publish/apply/` page + entry + HTML
- [x] B9 — Frontend `/publish/verify/` page + entry + HTML + `publisherAuthClient`
- [x] B10 — Enable Apply CTA on `/publish/`
- [x] B11 — Build verification + tests pass (338/338 backend, frontend validate + build clean)
- [ ] B12 — Open PR (only after Phase B complete in branch) — pending

## Verification

- Backend: `cd backend && npm run test:ci && npm run build:prod`
- Frontend: `cd frontend && npm run validate && npm run build`
- Manual smoke: dev server `npm run dev` → visit `/publish/apply/`, fill form,
  receive email, click link, observe verify page → JWT in localStorage.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| AWS Secrets Manager call latency on cold start | Cache the value in a module-level variable. Cold start adds ~50ms; warm calls are free. |
| Magic-link URL leaks via referer header | `<meta name="referrer" content="no-referrer">` on the verify page. |
| Apply spam | Rate-limit per-IP (10/hr); manual admin approval required before publisher's feed gets ingested. |
| `applicationStatus` field added to existing rows | Optional field; readers must treat missing OR `'approved'` as approved. Tests must cover both. |
| Email lands in spam (publisher never sees magic link) | Use SES with verified DKIM-signed domain (already done in step 1). Phase D: add SPF + DMARC if needed. |
