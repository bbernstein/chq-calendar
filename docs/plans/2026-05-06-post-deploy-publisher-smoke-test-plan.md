# Post-deploy publisher smoke test (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an automated end-to-end smoke test that runs after every prod deploy, walking the `bbtest` publisher through apply → approve → publish → pause → self-disable → retract → reset against the real production stack.

**Spec:** `docs/plans/2026-05-06-post-deploy-publisher-smoke-test-design.md`

**Architecture:** Three pieces — (1) test-only backend hooks for CAPTCHA bypass, smoke-admin signing, and idempotent reset; (2) a Jest-shaped smoke script under `scripts/smoke/`; (3) a step in `deploy-production.yml` that runs the smoke after deploy.

**Tech Stack:** TypeScript, Jest (smoke runner), AWS SDK only where unavoidable (Gmail API not used — the design uses a test-only token-by-email lookup instead).

**Branch:** create `feat/post-deploy-publisher-smoke` off `main`.

**Prerequisite (recommended):** the publisher-integration-tests plan landed first, so the `_setXxxForTests` injection patterns and journey shape are already familiar.

---

## Task 1: Decide on the bbtest publisher's stable identity

- [ ] **Step 1: Confirm bbtest exists and capture its current state**

  Per the user's memory note about bbtest cleanup pending, verify what currently exists:

  ```bash
  aws dynamodb scan --table-name chautauqua-calendar-publishers \
    --filter-expression 'contains(contactEmail, :v)' \
    --expression-attribute-values '{":v":{"S":"bbtest"}}'
  ```

  Record:
  - The bbtest publisher ID (if any)
  - Its slug
  - Its current `enabled` / `state` / `trustLevel`

  If multiple bbtest rows exist, decide which is canonical and delete the others now.

- [ ] **Step 2: Pick a stable email for the smoke**

  Use a domain you control (e.g. `bbtest@chqcal.org` or a Gmail subaddress like `bbtest+smoke@gmail.com`). Record the choice in this plan as `SMOKE_BBTEST_EMAIL` for downstream tasks.

---

## Task 2: Add CAPTCHA bypass

**Files:**
- Modify: `backend/src/services/captchaService.ts`
- Modify: `backend/src/__tests__/captchaService.test.ts`

- [ ] **Step 1: Add the bypass branch**

  At the top of `verifyCaptcha`, before any HTTP call:

  ```ts
  const bypassToken = process.env.CAPTCHA_BYPASS_TOKEN;
  if (bypassToken && bypassHeader && bypassHeader === bypassToken) {
    console.info('[captcha] bypass accepted', { source: 'smoke', requestId });
    return { ok: true, score: 1 };
  }
  ```

  The function signature already takes a `headers` map (or add one if missing); read `X-Smoke-Bypass`. If `CAPTCHA_BYPASS_TOKEN` is unset (production-without-smoke or local dev), the bypass is permanently disabled regardless of header.

- [ ] **Step 2: Tests**

  Add to `captchaService.test.ts`:
  - Bypass accepted when env + header match
  - Bypass rejected when env unset (header ignored)
  - Bypass rejected when header doesn't match env
  - Bypass log line emitted on accept (assert via spy on `console.info`)

- [ ] **Step 3: Commit**

  ```bash
  git add backend/src/services/captchaService.ts backend/src/__tests__/captchaService.test.ts
  git commit -m "feat(captcha): test-only bypass via X-Smoke-Bypass header"
  ```

---

## Task 3: Add smoke-admin signing-key auth

**Files:**
- Modify: `backend/src/handlers/adminHandler.ts`
- New: `backend/src/services/smokeAdminAuth.ts`
- New: `backend/src/__tests__/smokeAdminAuth.test.ts`

- [ ] **Step 1: Define the smoke admin verifier**

  In `smokeAdminAuth.ts`:

  ```ts
  export function verifySmokeAdminToken(authHeader: string | undefined): { sub: string } | null;
  ```

  Reads env `ADMIN_SMOKE_SIGNING_KEY`. Verifies HS256 JWT with claims `{ sub: 'smoke-bot', iss: 'smoke', exp: <future> }`. Returns `null` on missing env, missing header, bad signature, or expired token.

- [ ] **Step 2: Wire into adminHandler.ts**

  In the auth-resolution flow, after the Google OAuth check fails, fall through to `verifySmokeAdminToken`. Allow only on this route allowlist:

  ```ts
  const SMOKE_ADMIN_ROUTE_ALLOWLIST = new Set([
    'POST /admin/publisher-applications/{id}/approve',
    'POST /admin/publisher-run-ingest',
    'GET  /admin/publishers',
    'POST /admin/publishers/{id}/disable',
    'POST /admin/publishers/{id}/enable',
    'POST /admin/smoke-reset-bbtest',
    'POST /admin/smoke-magic-token-by-email',
    'POST /admin/publishers/{id}/events/count',
  ]);
  ```

  Other routes return 403 even with a valid smoke token. Tag CloudWatch logs with `adminSubject: 'smoke-bot'` whenever this branch fires.

- [ ] **Step 3: Tests**

  In `smokeAdminAuth.test.ts`:
  - Valid token + allowlisted route → admin context returned
  - Valid token + non-allowlisted route → null
  - Invalid signature → null
  - Expired → null
  - Missing env → null even with valid-looking token

- [ ] **Step 4: Commit**

  ```bash
  git add backend/src/services/smokeAdminAuth.ts \
          backend/src/__tests__/smokeAdminAuth.test.ts \
          backend/src/handlers/adminHandler.ts
  git commit -m "feat(admin): smoke-bot signing-key auth for post-deploy tests"
  ```

---

## Task 4: Add smoke-only endpoints

**Files:**
- Modify: `backend/src/handlers/adminHandler.ts`
- New: `backend/src/services/smokeReset.ts`
- New: `backend/src/__tests__/smokeReset.test.ts`
- Modify: `infrastructure/<the file that defines admin Lambda env vars>`

- [ ] **Step 1: `POST /admin/smoke-reset-bbtest`**

  In `smokeReset.ts`, export `resetBbtest({ registry, eventStore, applications, magicTokens, bbtestEmail })`:

  - Delete all application rows for `bbtestEmail`.
  - Delete all magic-token rows for `bbtestEmail`.
  - For any publisher with `contactEmail === bbtestEmail`:
    - Delete all events for that publisher (call `eventStore.deleteAllForPublisher`).
    - Set `enabled=true`, `state='active'`, `trustLevel='auto'`.

  Idempotent: if no bbtest rows exist, the function is a no-op and returns `{ rowsAffected: 0 }`.

- [ ] **Step 2: `POST /admin/smoke-magic-token-by-email`**

  Body: `{ email }`. Looks up the most recent unverified magic token for that email and returns the token string. Used by the smoke script to skip the SES round-trip. Smoke-admin allowlisted only.

- [ ] **Step 3: `POST /admin/publishers/{id}/events/count`**

  Returns `{ count: number }` for that publisher's events. Smoke-admin allowlisted; admins get this through `GET /admin/publishers` already.

- [ ] **Step 4: Add `ADMIN_SMOKE_SIGNING_KEY` and `CAPTCHA_BYPASS_TOKEN` to admin Lambda env**

  In Terraform (`infrastructure/`), add both vars to the admin Lambda's `environment.variables` block, sourcing from a new `aws_ssm_parameter` or `aws_secretsmanager_secret` for each. Apply.

- [ ] **Step 5: Tests + commit**

  Tests in `smokeReset.test.ts` cover empty-state idempotency, populated-state cleanup, and partial cleanup (e.g. when only a magic-token row exists).

  ```bash
  git add backend/src/services/smokeReset.ts \
          backend/src/__tests__/smokeReset.test.ts \
          backend/src/handlers/adminHandler.ts \
          infrastructure/
  git commit -m "feat(admin): smoke-only endpoints (reset, token-by-email, event-count)"
  ```

---

## Task 5: Smoke script

**Files:**
- New: `scripts/smoke/lib/apiClient.ts`
- New: `scripts/smoke/lib/adminAuth.ts`
- New: `scripts/smoke/lib/reset.ts`
- New: `scripts/smoke/publisher-lifecycle.test.ts`
- New: `scripts/smoke/jest.smoke.config.js`
- Modify: `package.json` (root) — add `"smoke:publisher"` script

- [ ] **Step 1: API client**

  Thin typed wrappers around `fetch(SMOKE_API_BASE + path)` for every endpoint the smoke uses. Each method takes typed params, parses JSON, throws `SmokeApiError(status, body)` on non-2xx.

- [ ] **Step 2: Admin token signer**

  ```ts
  export function signSmokeAdminToken(opts: { ttlSec?: number }): string;
  ```

  Uses `jsonwebtoken` to HS256-sign with `process.env.SMOKE_ADMIN_SIGNING_KEY`. Default TTL 5 minutes.

- [ ] **Step 3: Reset helper**

  Calls `POST /admin/smoke-reset-bbtest`. Logs the result.

- [ ] **Step 4: The journey test**

  In `publisher-lifecycle.test.ts`, write a single `it(...)` matching the design doc's Test Plan code block. Use a 5-minute timeout.

- [ ] **Step 5: Jest config**

  In `jest.smoke.config.js`:

  ```js
  module.exports = {
    rootDir: __dirname,
    testMatch: ['<rootDir>/*.test.ts'],
    transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../../backend/tsconfig.json' }] },
    testTimeout: 5 * 60 * 1000,
  };
  ```

- [ ] **Step 6: Root script**

  In root `package.json`:

  ```json
  "scripts": {
    "smoke:publisher": "jest --config=scripts/smoke/jest.smoke.config.js"
  }
  ```

- [ ] **Step 7: Local dry-run against staging or a personal stack (optional but recommended)**

  If the user has a personal stack: `SMOKE_API_BASE=https://staging.chqcal.org npm run smoke:publisher`. Confirm green; confirm reset cleans up.

- [ ] **Step 8: Commit**

  ```bash
  git add scripts/smoke/ package.json
  git commit -m "test(smoke): publisher-lifecycle smoke script"
  ```

---

## Task 6: Wire into deploy-production.yml

**Files:**
- Modify: `.github/workflows/deploy-production.yml`

- [ ] **Step 1: Add post-deploy smoke step**

  After the existing deploy step, add:

  ```yaml
  - name: Post-deploy publisher lifecycle smoke
    run: npm run smoke:publisher
    env:
      SMOKE_API_BASE: https://www.chqcal.org
      SMOKE_BBTEST_EMAIL: ${{ secrets.SMOKE_BBTEST_EMAIL }}
      SMOKE_ADMIN_SIGNING_KEY: ${{ secrets.SMOKE_ADMIN_SIGNING_KEY }}
      SMOKE_CAPTCHA_BYPASS_TOKEN: ${{ secrets.SMOKE_CAPTCHA_BYPASS_TOKEN }}
  ```

- [ ] **Step 2: Provision the GitHub secrets**

  In the GitHub repo settings, add secrets:
  - `SMOKE_BBTEST_EMAIL` — the bbtest email picked in Task 1
  - `SMOKE_ADMIN_SIGNING_KEY` — the same value provisioned to the Lambda env
  - `SMOKE_CAPTCHA_BYPASS_TOKEN` — the same value provisioned to the Lambda env

  These can't be set from a workflow file; the user does it in the UI.

- [ ] **Step 3: Commit + open PR**

  ```bash
  git add .github/workflows/deploy-production.yml
  git commit -m "ci(deploy): run publisher-lifecycle smoke after prod deploy"
  git push -u origin feat/post-deploy-publisher-smoke
  gh pr create --title "test(smoke): post-deploy publisher lifecycle smoke" --body "$(cat <<'EOF'
## Summary
- New `scripts/smoke/publisher-lifecycle.test.ts` walks bbtest through apply → approve → publish → pause → self-disable → retract → reset against the real prod stack after every deploy.
- Test-only backend hooks: CAPTCHA bypass header, smoke-admin signing-key auth, smoke reset endpoint.

## Manual follow-up after merge
- Provision Lambda env: `CAPTCHA_BYPASS_TOKEN`, `ADMIN_SMOKE_SIGNING_KEY`.
- Provision GitHub secrets: `SMOKE_BBTEST_EMAIL`, `SMOKE_ADMIN_SIGNING_KEY`, `SMOKE_CAPTCHA_BYPASS_TOKEN`.
- Trigger a deploy and verify the smoke step runs and passes.

## Risk
- Bypass tokens are high-entropy secrets; rotate via Terraform if leaked.
- Smoke-admin token is allowlisted to a small set of routes (see `smokeAdminAuth.ts`).

## Test plan
- [ ] All new unit tests green
- [ ] Local dry-run of `scripts/smoke/publisher-lifecycle.test.ts` against staging passes
- [ ] First post-merge deploy runs the smoke and reports green
EOF
  )"
  ```

---

## Task 7: Runbook entry

**Files:**
- New (or modify): `docs/runbooks/publisher-smoke-failed.md`

- [ ] **Step 1: Write the runbook**

  Cover:
  - What the smoke does
  - How to interpret each step's failure
  - How to reset bbtest manually (`POST /admin/smoke-reset-bbtest`)
  - How to disable the smoke step temporarily if it's flaking
  - Rotation steps for the bypass token and signing key

- [ ] **Step 2: Commit**

  ```bash
  git add docs/runbooks/publisher-smoke-failed.md
  git commit -m "docs(runbooks): publisher smoke-failure recovery"
  ```
