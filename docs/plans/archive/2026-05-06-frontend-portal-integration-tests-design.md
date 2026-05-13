# Frontend portal integration tests (design)

**Date:** 2026-05-06
**Status:** Approved, ready for implementation plan
**Origin:** The publisher portal frontend (Phases A–D, PRs #83–#85, #88, plus self-service PR #98) ships UI for `/publish/apply/`, `/publish/test/`, `/publisher-portal/`, `/admin/publishers/`. None of it has automated test coverage. Test pages are hand-checked today.

## Problem

The backend handlers backing the publisher portal are well-tested. The frontend pages that drive them have no tests at all, so a publisher-facing regression — broken form handler, missing field, mis-rendered status, mis-routed admin action — only surfaces when a user hits it. The CLAUDE.md note about the `'react'` import convention is the canonical example: that gotcha exists *because* there's no test that would have caught the form silently breaking.

## Policy

- Test the page state machine, not the visual styling.
- Use `fireEvent`/`userEvent` against rendered Preact components; no Playwright / browser automation in this spec.
- Mock `fetch` at the boundary; never make a real network call.
- Don't snapshot — assertions target user-observable behavior (text content, disabled state, redirect URL) so a CSS tweak doesn't bust tests.
- Verify the `'react'` import convention works end-to-end by exercising at least one form submission per page (regression for CLAUDE.md gotcha).

## Scope

### In

- `frontend/src/app/publish/apply/page.tsx` — apply form (CAPTCHA, validation, submit, success and error states)
- `frontend/src/app/publish/test/page.tsx` — feed-test form (URL paste, fetch, error display)
- `frontend/src/app/publisher-portal/page.tsx` — authenticated portal (status load, profile edit, email change request, pause/resume, fetch-now, self-disable typed-confirmation)
- `frontend/src/app/publisher-portal/login/page.tsx` — magic-link request + verify
- `frontend/src/app/publisher-portal/email-change/page.tsx` — magic-link confirm screens
- `frontend/src/app/admin/publishers/page.tsx` — admin list, detail expansion, run-ingest button, pause/disable actions, individual event approve/reject

### Out

- The main calendar page (`page.tsx` for `/`) — covered by separate spec if/when needed
- `/admin/feedback/`, `/admin/login/` — out of scope for the publisher work
- Service-worker behavior (PR #101) — needs its own approach
- Visual regression / screenshot diffing
- E2E across real backend (covered by `post-deploy-publisher-smoke-test` spec)

## Architecture

```
frontend/
├── vitest.config.ts                  # already exists per CLAUDE.md note
├── src/
│   ├── app/.../page.tsx              # under test
│   └── __tests__/integration/
│       ├── helpers/
│       │   ├── render.tsx            # wraps render() with Preact context providers
│       │   ├── fetchMock.ts          # typed fetch mock with route-based responses
│       │   └── auth.ts               # localStorage session helpers
│       ├── apply.test.tsx
│       ├── publishTest.test.tsx
│       ├── portal.test.tsx
│       ├── portalLogin.test.tsx
│       ├── portalEmailChange.test.tsx
│       └── adminPublishers.test.tsx
```

### Test runner

Vitest + `@testing-library/preact` + **jsdom**. `frontend/vitest.config.ts` already exists, already specifies `environment: 'jsdom'`, already declares the `react` → `preact/compat` aliases (which is the critical bit for the CLAUDE.md gotcha), and already points `setupFiles` at `./src/__tests__/setup.ts`. The implementation plan therefore adds tests *into* this config, not on top of a new one. We deliberately keep `jsdom` (not `happy-dom`) because the existing config already chose it — switching environments is a breaking change for any other Vitest tests that may land in parallel and provides no concrete benefit here.

### Fetch mock

A small `fetchMock` helper that registers `(method, urlPattern) → response` rules. Default response is `404` so unhandled routes fail loudly. Each test sets up only the routes it needs; the helper exposes `.calls(urlPattern)` for assertions on what was sent.

### Auth helper

`loginAs({ email, publisherId, jwt })` writes the session token to `localStorage` exactly the way `frontend/src/lib/auth.ts` does in production. Tests that exercise authenticated portals call this in `beforeEach`.

### Redirect / navigation seam

Several portal tests need to assert that a page navigates (e.g. unauthenticated → `/publisher-portal/login`, post-self-disable → terminal page). The portal pages perform navigation via `window.location.href = ...` or `route(...)` from preact-router. Tests stub the navigation seam in one place — `helpers/render.tsx` exposes `installNavigationStub()` that replaces the seam with a recorder, and `getNavigations()` returns the URLs that were navigated to. Each navigation test asserts on `getNavigations()` rather than on `window.location` directly, so the same pattern works whether the page uses `location.href` or a router.

### What we assert

For each page test:

- The expected fields render (by label / role).
- Filling and submitting the form sends the expected `fetch(url, { method, body })`.
- Success responses transition the UI to the success state (text, disabled buttons, redirect call).
- Error responses (400, 401, 429, 500) show the right error text and don't navigate away.
- Validation rejects bad input *without* sending a request.

## Test plan (one or two `it(...)` per bullet)

### apply.test.tsx

- Renders all required fields and CAPTCHA placeholder.
- CAPTCHA missing → submit blocked, no fetch.
- Invalid email → inline error, no fetch.
- Successful apply → POST `/publisher-apply-request` fires; "check your email" success state renders.
- Server returns `EmailAlreadyInUseError` → friendly error renders; user can edit and retry.
- Server returns 429 (rate limit) → backoff message renders.

### publishTest.test.tsx

- Pasting URL + clicking Test fires POST `/publisher-test`.
- Successful response renders parsed event count and warnings list.
- Validation errors render under each event with index + path.
- Network/parse error renders banner.

### portal.test.tsx

- Without session → redirects to `/publisher-portal/login`.
- With session → `GET /publisher-status` populates publisher row, lastFetchMessage, current state badges (paused / disabled / active).
- Profile edit: change name → PATCH `/publisher-profile` → success toast; row updates in place.
- Email-change request: submit new email → POST `/publisher-email-change-request` → success state explaining magic link sent.
- Pause toggle: click pause → POST `/publisher-pause` → row badge flips; click resume → POST `/publisher-resume`.
- Fetch-now: click → POST `/publisher-fetch-now`; success message replaces button label until refetch.
- Self-disable: typed-slug input must match displayed slug; mismatch keeps button disabled; correct slug + click fires POST `/publisher-disable`; on success page navigates to a "disabled" terminal state.
- Form submission (any single one) — verifies `'react'` import convention so onChange/onInput work. Regression for CLAUDE.md note.

### portalLogin.test.tsx

- Email entry → POST `/publisher-auth-request` → "check your email" state.
- 404 (unknown email) renders generic message (no email enumeration).
- Magic-link verify URL with token → POST `/publisher-auth-verify` → on success writes session and redirects to `/publisher-portal`.
- Magic-link verify with bad token → error state; no session written.

### portalEmailChange.test.tsx

- `/publisher-portal/email-change?token=...` → POST `/publisher-email-change-verify` → success page.
- Bad token → error page.
- Cancel-by-old route → POST `/publisher-email-change-cancel` → success page.

### adminPublishers.test.tsx

- Without admin session → redirects to admin login.
- With session → GET applications and publishers; renders both lists.
- Approve application → POST `/admin/publisher-applications/:id/approve` → row moves from applications to publishers list.
- Reject application → POST reject → row disappears with reject reason.
- Detail expansion shows lastFetchMessage, fetchStatus, recent events.
- Run-ingest button → POST `/admin/publisher-run-ingest` → loading state → refresh.
- Pause / disable actions on a publisher row → POST → row badge updates.
- Per-event approve / reject buttons → POST → state pill updates inline.

## CI integration

Tests run inside `frontend`'s build pipeline:

- Add `"test": "vitest run"` script in `frontend/package.json` (if not already present).
- Add `"test:ci": "vitest run --coverage"` for the CI step.
- Update `npm run build` (frontend) to run `npm run test:ci` first, mirroring backend's `prebuild → test:ci` pattern. Or add a dedicated CI step in `build-and-test.yml` for `npm run test:ci --workspace=frontend`.

## Non-goals

- Visual regression
- Cross-browser
- Real backend
- E2E with real Lambda

## Risks

- **Preact-vs-React behavioral drift in tests.** Mitigation: use `@testing-library/preact` (not `@testing-library/react`) and the same `vite.config.ts` aliases. Add a smoke test that verifies the `react` alias resolves to `preact/compat` at test time.
- **Tests coupled to copy strings break on UI tweaks.** Mitigation: assert on roles/labels and aria attributes; only assert text strings when the test is specifically about the message.

## File counts (estimated)

- Helpers: ~150 lines
- Six test files: 600–900 lines combined
- `vitest.config.ts` (if new): ~25 lines
- Total: ~775–1,075 lines
