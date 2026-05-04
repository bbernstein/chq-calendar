# Plan — CAPTCHA on apply form + public publisher docs page

**Date:** 2026-05-04
**Origin:** User request after publisher portal Phases A–D shipped — "Add public docs for publishers. Also add captcha to apply form."
**Branch:** `feat/publisher-apply-captcha-and-public-docs`

## Goals

1. **CAPTCHA on `/api/publisher-apply/request`** — gate the apply submission with reCAPTCHA v3 to deter abuse, matching the existing pattern used by the feedback form.
2. **Public publisher docs page** — render the existing internal `docs/publisher/AUTHORING.md` content (or a derived version) at `/publish/docs/` so prospective publishers can read the format spec without leaving the site, and link it from `/publish/`.

Both ship in a single PR — they're independent UX-level additions with no shared code, but small enough to bundle.

## CAPTCHA on apply

### Existing pattern (feedback form)

- **Frontend** (`frontend/src/app/feedback/page.tsx`): loads `https://www.google.com/recaptcha/api.js?render=${VITE_RECAPTCHA_SITE_KEY}` on mount, calls `grecaptcha.execute(siteKey, { action: '...' })` on submit, sends `captchaToken` in the body.
- **Backend** (`backend/src/handlers/calendarHandler.ts`): `verifyCaptcha(token)` POSTs to `https://www.google.com/recaptcha/api/siteverify` with `RECAPTCHA_SECRET_KEY`. Fails closed in production (`ENVIRONMENT === 'prod'`); allows in dev when secret is unset.
- **Infra** (`infrastructure/main.tf:796`): `RECAPTCHA_SECRET_KEY` is wired into the calendar Lambda's env vars but **not** the admin Lambda. The admin Lambda hosts the publisher-portal routes (delegated to `publisherPortalHandler.ts`) and so needs the secret added.

### Changes

1. **`backend/src/services/captchaService.ts`** (new) — extract `verifyCaptcha` from `calendarHandler.ts` into a shared service so both Lambdas can use the same code. Behaviour is unchanged: same fail-closed-in-prod semantics, same logging.
2. **`backend/src/handlers/calendarHandler.ts`** — replace the local `verifyCaptcha` with `import { verifyCaptcha } from '../services/captchaService'`.
3. **`backend/src/handlers/publisherPortalHandler.ts`** — `handlePublisherApplyRequest` now requires `captchaToken` in the body. After rate-limit check and basic-fields validation, call `verifyCaptcha(token)`. Reject with `400 { error: 'CAPTCHA verification failed', field: 'captcha' }` on failure.
4. **`infrastructure/main.tf`** (admin Lambda env) — add `RECAPTCHA_SECRET_KEY = var.recaptcha_secret_key` to the admin Lambda's env block.
5. **`frontend/src/app/publish/apply/page.tsx`** — add the same reCAPTCHA loading + execute pattern as feedback. Send `captchaToken` in the request body. Disable submit button while `captchaReady` is false.
6. **Tests** — add a `publisherPortalHandler` test that asserts apply rejects when captcha verification fails. Use a stubbed `verifyCaptcha`.

### Anti-regression

- Existing apply tests need a stubbed `captchaToken` to keep passing. Use a jest `__mocks__` shim for the captcha module so we don't actually call Google.
- The CI E2E test in `infrastructure/ci-e2e-publisher.tf` exercises the publisher-ingest path, **not** the apply path — so no CI test changes are needed.

## Public publisher docs page

### Structure

- **Route:** `/publish/docs/`
- **Source of truth:** `docs/publisher/AUTHORING.md` (138 lines, complete reference). We don't duplicate the content — we render the markdown in the page itself, or transcribe it once into a Preact component.

### Decision: transcribe (don't fetch markdown)

Two viable approaches:

| Approach | Pros | Cons |
|----------|------|------|
| Fetch `AUTHORING.md` at runtime, render with markdown library | Single source of truth | Adds 30–50KB markdown lib + remark deps, runtime fetch latency, requires copying MD into the bundle path |
| Transcribe content into a Preact component | No runtime cost, full styling control, works offline | Two copies (MD for repo browsers, JSX for the public site); risk of drift |

The drift risk is small (this is reference doc, low edit frequency) and the bundle-cost win is meaningful for a static informational page. **Pick option 2** — transcribe, with a top-of-file comment in `AUTHORING.md` and the new page noting they should be kept in sync.

### Files to add

- `frontend/publish/docs/index.html` — HTML entry, mirrors `frontend/publish/apply/index.html`.
- `frontend/src/entries/publish-docs.tsx` — Vite entry, mirrors `publish-apply.tsx`.
- `frontend/src/app/publish/docs/page.tsx` — Preact component rendering the docs content.
- `frontend/vite.config.ts` — add `'publish-docs': resolve(__dirname, 'publish/docs/index.html')` to `rollupOptions.input`.

### Files to update

- `frontend/src/app/publish/page.tsx` — add a "Read the format docs" link that points at `/publish/docs/`.
- `docs/publisher/AUTHORING.md` — top-of-file note: "If you edit this file, also update `frontend/src/app/publish/docs/page.tsx`."
- `frontend/src/app/publish/apply/page.tsx` — surface a "See the format docs" link near the source-type field.

## Test plan

- [ ] `npm run validate` (frontend) and `npm test` (backend) pass.
- [ ] Local dev: `npm run dev`, hit `/publish/apply/`, confirm reCAPTCHA badge appears in dev (only when `VITE_RECAPTCHA_SITE_KEY` is set).
- [ ] `/publish/docs/` renders the docs content with proper styling (light + dark mode).
- [ ] After deploy: submit a real apply request and confirm it succeeds when the reCAPTCHA token is fresh.
- [ ] After deploy: confirm a request without a `captchaToken` is rejected with 400.

## Out of scope

- CAPTCHA on `/publisher-test` — that's an idempotent diagnostic endpoint already protected by a 10-req / 5-min rate limit; not currently abused.
- CAPTCHA on `/publisher-auth/request` (login) — login is rate-limited (10 req / hr), and adding CAPTCHA to login is a meaningful UX cost; defer until/unless abuse appears.
- Markdown rendering library — explicitly rejected above.
- Renaming AUTHORING.md to something more public-facing — file path is already linked from the schema, leave alone.
