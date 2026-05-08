# PR #98 Deferred Follow-ups — Implementation Plan

> **Execution mode:** Inline (single PR for all 6 items per user direction). One commit per item.

**Goal:** Land all six deferred follow-ups from PR #98 (publisher self-service) as a single bundled cleanup PR.

**Architecture:** Each item is independent; commits are sequential by ascending complexity so an early-stage review failure doesn't block trivial fixes. No schema breaks; the only infra change is an additive GSI.

**Branch:** `feat/pr98-deferred-followups` (already created off `main` at `1b178f1`).

---

## Item ordering rationale

1. **Item 6** — `handleEmailChanged` → `handleStatusRefresh` rename. 30-second mechanical change, no behavior shift.
2. **Item 3** — Extract `isApproved` helper. Small, type-driven; consumed by Items 1, 2 paths nearby.
3. **Item 2** — Dedup `PublisherRegistryService` construction in `emailChangeService()` factory.
4. **Item 1** — Modal a11y (reusable `<Modal>` with Esc + focus trap), applied to DangerZone, PauseConfirm, ChangeEmail.
5. **Item 4** — `contactEmail` GSI on publishers table; switch `getByEmail` Scan→Query.
6. **Item 5** — Email-flow happy-path integration test exercising apply→approve→login→edit→email-change→re-login at the service layer using the existing in-memory DDB harness + mocked SES.

## Item 6 — Rename `handleEmailChanged`

**Files:**
- Modify: `frontend/src/app/publish/status/page.tsx` (3 occurrences: declaration line 190, 2 callsites lines 233, 258)

**Steps:**
- Replace `handleEmailChanged` with `handleStatusRefresh` (3 sites).
- Update the function-doc comment if it explicitly references "email" — generalize.
- Run frontend tests: `npm --workspace=frontend test`.
- Commit: `refactor(publisher-portal): rename handleEmailChanged → handleStatusRefresh`.

## Item 3 — `isApproved` helper

Today the rule "applicationStatus is undefined OR === 'approved'" is duplicated between `gateApprovedPublisher` (`publisherPortalHandler.ts:953`) and the frontend `editable` derivation in `publish/status/page.tsx:166-167`. The default-undefined-to-approved logic is the legacy-row contract documented in both places.

**Files:**
- Create: `backend/src/utils/publisherApproval.ts` exporting `isApprovedPublisher(rec: { applicationStatus?: ApplicationStatus }): boolean`.
- Create: `frontend/src/lib/publisherApproval.ts` mirroring the helper for the frontend (same logic, frontend-typed input).
- Modify: `backend/src/handlers/publisherPortalHandler.ts:953-954` use helper.
- Modify: `frontend/src/app/publish/status/page.tsx:166-167` use helper.
- Test: `backend/src/__tests__/publisherApproval.test.ts` covers undefined/approved/pending/rejected.

The two files (one backend, one frontend) deliberately avoid a shared module — there's no shared package between backend and frontend in this monorepo. Two ~5-line files with identical logic is cheaper than introducing a shared workspace.

**Steps:**
- Write the backend helper + unit tests; run backend tests.
- Write the frontend helper.
- Replace the inline checks in handler and page.
- Run `npm run validate && npm run build` from `frontend/`.
- Run backend tests.
- Commit: `refactor(publisher-portal): extract isApprovedPublisher helper`.

## Item 2 — Dedup registry construction in `emailChangeService()`

`publisherPortalHandler.ts:759-779` constructs a fresh `PublisherRegistryService` even though `statusRegistry()` already maintains one for the same Lambda. Cold-start cost is negligible (microseconds), but it's an avoidable extra allocation and it makes the dependency graph slightly noisier.

**Files:**
- Modify: `backend/src/handlers/publisherPortalHandler.ts:759-779` — `emailChangeService()` reuses `statusRegistry()` instead of constructing its own. Remove the comment at lines 752-755 about "Sharing wouldn't reduce cold-start work meaningfully" since we're now sharing.

**Steps:**
- Change `const registry = new PublisherRegistryService(...)` to `const registry = statusRegistry()`.
- Update the introducing comment (lines 750-755) to explain the singleton sharing.
- Run handler tests: `cd backend && npm test -- publisherPortalHandler`.
- Commit: `refactor(publisher-portal): share registry singleton across status + email-change services`.

## Item 1 — Modal a11y refactor

The three publisher-portal modals (DangerZone, PauseConfirm, ChangeEmail) hand-roll the same dialog scaffolding. None implement Esc-to-close or focus trap. Same gap exists on apply/SourceEdit, but those weren't in PR #98's scope.

**Files:**
- Create: `frontend/src/components/Modal.tsx` — reusable `<Modal onClose titleId closeOnEsc? className?>` (caller controls mount via conditional render — no `open` prop) with:
  - `role="dialog" aria-modal="true" aria-labelledby={titleId}` on the inner card (the focused element), with a plain backdrop overlay that has no role.
  - Esc key handler attached on mount, removed on unmount, calling `onClose`. Disable via `closeOnEsc={false}` for typed-confirmation gates (DangerZone) or `closeOnEsc={!busy}` to guard against in-flight dismissal (Pause / EmailChange).
  - Focus trap: on open, focus the first focusable child; on Tab/Shift-Tab at boundaries (or when focus has escaped the modal), wrap focus.
  - Restore focus to the previously focused element on close.
  - **Backdrop-click-to-close: not implemented** in this PR. Existing modals didn't do this; adding it is net-new UX worth a separate decision. Tracked as a follow-up.
- Create: `frontend/src/components/__tests__/Modal.test.tsx` — Esc closes, closeOnEsc=false suppresses, Tab cycles, focus restored.
- Modify: `frontend/src/app/publish/status/DangerZone.tsx` — wrap `DisableConfirmModal` body in `<Modal>` with `closeOnEsc={false}`.
- Modify: `frontend/src/app/publish/status/IngestControls.tsx` — wrap `PauseConfirmModal` with `closeOnEsc={!busy}`.
- Modify: `frontend/src/app/publish/status/EmailChangePanel.tsx` — wrap `ChangeEmailModal` with `closeOnEsc={!busy}`.
- Update tests: `DangerZone.test.tsx`, `IngestControls.test.tsx`, `EmailChangePanel.test.tsx` if they assert on the dropped wrapper structure.

**Steps:**
- Write `Modal.tsx` + tests (TDD: tests first).
- Run `npm test -- Modal` — should pass.
- Wire DangerZone, IngestControls, EmailChangePanel to use `<Modal>`.
- Run full frontend test suite; fix any tests asserting on old DOM shape.
- Run `npm run validate && npm run build`.
- Commit: `feat(publisher-portal): reusable Modal with Esc + focus trap`.

## Item 4 — `contactEmail` GSI

`PublisherRegistryService.getByEmail` (line 136) Scans the publishers table. Memory note says this degrades past ~200 publishers; not a today problem, but the deferred item is to add the GSI proactively so future scaling pressure doesn't surface during a hot incident.

**Files:**
- Modify: `infrastructure/publisher-ingest.tf` — add `global_secondary_index` block on the publishers DDB table with `name = "by-contactEmail"`, `hash_key = "contactEmail"`, `projection_type = "ALL"`. Add `attribute { name = "contactEmail"; type = "S" }`.
- Modify: `backend/src/services/publisherRegistryService.ts:136-151` — switch `getByEmail` to `QueryCommand` against the new index. Fallback path: if the SDK throws `ValidationException` with "specified index" error (index not yet present in the deployed table), log a warning and fall back to Scan once. This avoids a deploy-window race where Lambda code lands before terraform applies.
- Modify: tests for `publisherRegistryService.test.ts` covering Query path. The harness's in-memory DDB doesn't enforce GSI presence, so tests already pass; add an explicit Query-vs-Scan assertion.
- Update memory after deploy.

**Steps:**
- Add Terraform GSI block + new attribute. `cd infrastructure && terraform fmt && terraform validate`.
- Update `getByEmail` to Query with Scan fallback.
- Add unit test verifying Query is preferred and Scan fallback fires on ValidationException.
- Run backend test suite.
- Commit: `feat(publishers): contactEmail GSI + getByEmail Query path`.
- **Defer terraform apply to after merge** (matches project convention — apply comes from main branch).

## Item 5 — Email-flow happy-path integration test

The original deferred memo says "needs SES mocking infrastructure that doesn't exist in CI today." That's true for **end-to-end** tests against deployed AWS. For service-layer integration the existing harness (`backend/src/__tests__/integration/harness/harness.ts`) already provides in-memory DDB + a no-op mail mock pattern. The right test for this item is a service-level happy-path that wires:

- `PublisherApplicationService.requestApply` + `verifyApply` (apply)
- `PublisherAdminService.approve` (admin approve)
- `PublisherApplicationService.requestLogin` + `verifyLogin` (login)
- `PublisherProfileService.updateProfile` (edit name)
- `PublisherEmailChangeService.initiate` + `verifyByNewAddress` (email change)
- A second `requestLogin` against the new email to assert the new address authenticates and the old does not (forced re-login)

…against the in-memory harness, asserting on registry state at each step.

**Files:**
- Create: `backend/src/__tests__/integration/emailFlowE2E.test.ts`.

**Steps:**
- Read the harness; understand the SES/captcha mocks it already exposes.
- Write the test as a single `describe('publisher email-flow happy path', ...)` with sequential `it.each` or one big `it` (one big `it` is correct here — the steps share setup state).
- Run: `cd backend && npm test -- emailFlowE2E`.
- Commit: `test(publisher-portal): email-flow happy-path integration test`.

## Verification before PR

- `cd frontend && npm run validate && npm run build` — passes.
- `cd backend && npm test` — passes.
- `cd backend && npm run build` — passes.
- `cd infrastructure && terraform fmt && terraform validate` — passes.
- Memory updated: this plan's outcome is captured for the next session.

## PR

- Title: `feat(publisher-portal): PR #98 deferred follow-ups (modal a11y, contactEmail GSI, email-flow E2E, etc.)`
- Body: bullet per item, link memory file `publisher-self-service-pr-98-status.md`.

After PR is open: iterate per user CLAUDE.md PR loop — address review comments, request re-reviews, repeat until reviewers empty + checks green + mergeable_state=clean. Do not auto-merge; user merges.
