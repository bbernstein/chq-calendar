# Publisher self-service & ingest — backend integration tests (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backend integration tests that wire `publisherPortalHandler` + `adminHandler` + `publisherIngestHandler` together against a shared in-memory DynamoDB fake, walking full publisher journeys end-to-end. Wire these tests into CI so they gate every push.

**Spec:** `docs/plans/2026-05-06-publisher-integration-tests-design.md`

**Architecture:** New `backend/src/__tests__/integration/` directory with a harness that constructs real services against a fake `DynamoDBDocumentClient` and injects them via the existing `_setXxxForTests` hooks on each handler. Tests are journey-shaped (`it('walks ...', async () => ...)`).

**Tech Stack:** TypeScript, Jest, Node 24+ (CI matrix runs 24 and 25), in-process fake DDB, no docker.

**Branch:** create `feat/publisher-integration-tests` off `main`.

---

## Task 1: Build the in-memory DynamoDB fake

**Files:**
- New: `backend/src/__tests__/integration/harness/inMemoryDocClient.ts`
- New: `backend/src/__tests__/integration/harness/__tests__/inMemoryDocClient.test.ts`

The fake must implement enough of `DynamoDBDocumentClient.send(cmd)` for all services in `backend/src/services/` to round-trip Get/Put/Update/Delete/Query/Scan/BatchGet/BatchWrite/TransactWrite. Conditional expressions cover `attribute_exists`, `attribute_not_exists`, `=`, `<>`, `<`, `>`, `<=`, `>=`, `AND`, `OR`. On condition failure, throw an error whose `name === 'ConditionalCheckFailedException'`.

- [ ] **Step 1: Survey actual command usage**

  Run from repo root and record the result in a comment at the top of `inMemoryDocClient.ts`:

  ```bash
  grep -rE '(Get|Put|Update|Delete|Query|Scan|BatchGet|BatchWrite|TransactWrite)Command' backend/src/services backend/src/handlers | sort -u
  ```

  Use the result to ensure every command type seen in production code has a fake implementation.

- [ ] **Step 2: Implement the fake**

  Create `inMemoryDocClient.ts` exporting:

  ```ts
  export interface TableSpec {
    name: string;
    hashKey: string;
    sortKey?: string;
    gsis?: { name: string; hashKey: string; sortKey?: string }[];
  }
  export class InMemoryDocClient {
    constructor(specs: TableSpec[]);
    send(cmd: any): Promise<any>;
    /** Test helpers: */
    dump(table: string): unknown[];
    seed(table: string, items: unknown[]): void;
    clear(): void;
  }
  ```

  Backing storage: `Map<table, Map<keyJson, item>>` where `keyJson` is `JSON.stringify({ [hashKey]: ..., [sortKey]: ... })`. GSIs scan all items, filter by hash, optionally sort by sort key.

  Condition-expression evaluator: tokenize on whitespace and operators, substitute `ExpressionAttributeNames` (`#name`) and `ExpressionAttributeValues` (`:val`), then walk an AST. Keep the AST minimal — just function-calls and binary operators in the supported set.

- [ ] **Step 3: Write a self-test that validates the fake**

  In `inMemoryDocClient.test.ts`:

  - Put + Get round-trip with hash-only key
  - Put + Get round-trip with hash+sort key
  - Put with `attribute_not_exists(pk)` succeeds on empty, fails on existing → throws `ConditionalCheckFailedException`
  - Update with `SET #x = :v` updates one attribute
  - Update with `ADD #x :n` increments a number
  - Query with `KeyConditionExpression: '#pk = :pk'` returns matching items
  - Query against a GSI returns matching items, sorted ascending by sort key
  - Scan with `FilterExpression` filters items
  - TransactWrite with three Puts atomically commits; if one Put has a failing condition, none commit
  - BatchWrite with both Puts and Deletes processes all
  - Unsupported command shape (e.g. `TransactGetItems` or `ExecuteStatement`/PartiQL — commands the fake explicitly won't implement) throws a clear error. (`ProjectionExpression` is a real DDB parameter and must NOT throw — it can be a no-op or applied to the projected result.)

  Run:

  ```bash
  cd backend && npx jest inMemoryDocClient
  ```

  All tests must pass before continuing.

- [ ] **Step 4: Commit**

  ```bash
  git add backend/src/__tests__/integration/harness/inMemoryDocClient.ts \
          backend/src/__tests__/integration/harness/__tests__/inMemoryDocClient.test.ts
  git commit -m "test(integration): in-memory DynamoDB fake for backend integration tests"
  ```

---

## Task 2: Build the harness — fakes, clock, mail capture

**Files:**
- New: `backend/src/__tests__/integration/harness/fakes.ts`
- New: `backend/src/__tests__/integration/harness/harness.ts`

- [ ] **Step 1: Implement the fakes module**

  In `fakes.ts`:

  ```ts
  export class ClockController {
    constructor(now: Date);
    get now(): Date;
    advance(ms: number): void;
    set(date: Date | string): void;
  }
  export class MailCapture {
    constructor();
    sendMail(params: SendMailParams): Promise<void>;
    all(): SentMail[];
    lastTo(email: string): SentMail | undefined;
    clear(): void;
  }
  export class FakeFeedFetcher {
    set(publisherId: string, result: FetchResult): void;
    /** matches publisherFeedFetcher signature */
    fetch(publisher: PublisherRecord): Promise<FetchResult>;
  }
  export class FakeLambdaInvoker {
    constructor(private readonly run: () => Promise<void>);
    /** matches lambdaClient.send shape */
    send(cmd: InvokeCommand): Promise<{ StatusCode: 202 }>;
  }
  export class CaptchaToggle {
    pass(): void;
    fail(): void;
    /** module-mock target — matches verifyCaptcha(token, action) → Promise<boolean> */
    verify(token: string, action?: string): Promise<boolean>;
  }
  ```

- [ ] **Step 2: Implement `createHarness({ now })`**

  In `harness.ts`, build the wiring. Constructs the fake DDB with the table specs that match production (publishers, publisher-events, applications, magic-tokens, rate-limit). Constructs real services against it. Mints a per-harness JWT secret; provides a `signSession({ publisherId })` helper.

  Calls each `_setXxxForTests` injection point. Stores the call set so `harness.dispose()` resets them all to `null`.

  Module-mocks (declared once in each test file, since `jest.mock` is hoisted):

  ```ts
  jest.mock('../../services/publisherAuthService');
  jest.mock('../../services/captchaService');
  jest.mock('../../services/mailService');
  jest.mock('../../services/publisherIngestInvoker');
  jest.unmock('@aws-sdk/lib-dynamodb');  // override setup.ts
  ```

  In `harness.ts`, wire the mocked module exports to the fakes (`MailCapture.sendMail`, `CaptchaToggle.verify`, etc.) so handler calls flow through them.

- [ ] **Step 3: Smoke-test the harness**

  Add `harness.smoke.test.ts`:

  ```ts
  it('creates a harness, signs a session, applies, advances time', async () => {
    const h = await createHarness({ now: '2026-06-01T00:00:00Z' });
    const { applicationId } = await h.publisher.apply({
      email: 'pub@example.com', name: 'X', sourceUrl: 'https://x', sourceType: 'json',
    });
    expect(applicationId).toMatch(/^app-/);
    h.now.advance(60_000);
    h.dispose();
  });
  ```

  Run:

  ```bash
  cd backend && npx jest harness.smoke
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add backend/src/__tests__/integration/harness/
  git commit -m "test(integration): harness with fakes, clock, mail capture"
  ```

---

## Task 3: Actor API

**Files:**
- New: `backend/src/__tests__/integration/harness/actors.ts`
- Modify: `backend/src/__tests__/integration/harness/harness.ts` (export actor instances)

- [ ] **Step 1: Implement actors**

  In `actors.ts`, build typed wrappers around `APIGatewayProxyEvent`. Each wrapper:

  - Builds the event (path, method, headers, body).
  - Calls a statically-imported handler (e.g. `handlePublisherStatus(event)`).
    **Important:** use static `import { handlePublisherX } from '../../handlers/publisherPortalHandler'` at the top of the file — NOT a dynamic `import(...)` expression inside the function. Dynamic imports re-evaluate the module on every call, bypass Jest's module registry, and break the `jest.mock()` setup wired in `harness.ts`.
  - Parses the response body. On non-2xx, throws `new HandlerError(statusCode, body)`.

  Three actor objects: `publisher`, `admin`, `ingest`. Methods listed in the design doc, Architecture → Wiring section.

- [ ] **Step 2: Verify each actor with a one-line test**

  In `actors.smoke.test.ts`, hit each method once with valid inputs and assert it doesn't throw. This is plumbing verification, not behavior verification.

  Run:

  ```bash
  cd backend && npx jest actors.smoke
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add backend/src/__tests__/integration/harness/actors.ts \
          backend/src/__tests__/integration/harness/actors.smoke.test.ts
  git commit -m "test(integration): actor API for publisher/admin/ingest journeys"
  ```

---

## Task 4: Lifecycle tests

**Files:**
- New: `backend/src/__tests__/integration/lifecycle.test.ts`

- [ ] **Step 1: Write the lifecycle journeys**

  Implement the four `it(...)` blocks listed in the design doc, Test plan → lifecycle.test.ts. Each test reads top-to-bottom as a single user journey; assertions are interleaved with actions.

  The PR #100 regression test (`it('preserves admin-approved state across re-ingest with bumped lastModified')`) must:
  - Apply with `trustLevel: 'review'`
  - Approve the application
  - Set a feed with one event, run ingest → state is `pending`
  - Admin approves the event → state is `published`
  - Set the same feed with bumped `lastModified` on the event, run ingest
  - Assert state is still `published`

- [ ] **Step 2: Run**

  ```bash
  cd backend && npx jest integration/lifecycle
  ```

  All four must pass.

- [ ] **Step 3: Commit**

  ```bash
  git add backend/src/__tests__/integration/lifecycle.test.ts
  git commit -m "test(integration): publisher lifecycle journeys (apply, approve, sticky published)"
  ```

---

## Task 5: Self-service tests

**Files:**
- New: `backend/src/__tests__/integration/selfService.test.ts`

- [ ] **Step 1: Write the self-service journeys**

  Implement the seven `it(...)` blocks in the design doc, Test plan → selfService.test.ts. The PR #78 regression test (`self-disable retracts events on next ingest`) must:
  - Approve a publisher with events already published
  - Self-disable via the portal with the correct typed slug
  - Run ingest
  - Assert the event store has 0 events for that publisher

- [ ] **Step 2: Run and commit**

  ```bash
  cd backend && npx jest integration/selfService
  git add backend/src/__tests__/integration/selfService.test.ts
  git commit -m "test(integration): self-service portal journeys (pause, profile, email, self-disable)"
  ```

---

## Task 6: Admin-controls tests

**Files:**
- New: `backend/src/__tests__/integration/adminControls.test.ts`

- [ ] **Step 1: Write the admin-controls journeys**

  Five `it(...)` blocks per the design doc. The "admin reject event preserved across re-ingest" test mirrors the sticky-published test: reject the event, bump `lastModified`, run ingest, assert state is still `rejected`.

- [ ] **Step 2: Run and commit**

  ```bash
  cd backend && npx jest integration/adminControls
  git add backend/src/__tests__/integration/adminControls.test.ts
  git commit -m "test(integration): admin controls (pause, disable, approve/reject, run-ingest)"
  ```

---

## Task 7: Ingest edge-case tests

**Files:**
- New: `backend/src/__tests__/integration/ingestEdgeCases.test.ts`

- [ ] **Step 1: Write the edge-case journeys**

  Five `it(...)` blocks per the design doc. Threshold halt: configure the fake feed to return N events, run ingest once to seed, then return <50% of N, run again, assert `setThresholdHalt` was called.

- [ ] **Step 2: Run and commit**

  ```bash
  cd backend && npx jest integration/ingestEdgeCases
  git add backend/src/__tests__/integration/ingestEdgeCases.test.ts
  git commit -m "test(integration): ingest edge cases (network error, unchanged, threshold halt)"
  ```

---

## Task 8: Auth & limits tests

**Files:**
- New: `backend/src/__tests__/integration/authAndLimits.test.ts`

- [ ] **Step 1: Write the auth-and-limits journeys**

  Five `it(...)` blocks per the design doc. Magic-token expiry: set `now`, request a magic link (which writes a token row), advance the clock past TTL, attempt to verify, assert rejection.

  The DNS-rebinding guard test uses URLs `http://0.0.0.0/`, `http://127.0.0.1/`, `http://169.254.169.254/` and asserts `handlePublisherFetchNow` returns 400.

- [ ] **Step 2: Run and commit**

  ```bash
  cd backend && npx jest integration/authAndLimits
  git add backend/src/__tests__/integration/authAndLimits.test.ts
  git commit -m "test(integration): auth and limits (CAPTCHA, magic-token, rate-limit, DNS guard)"
  ```

---

## Task 9: Verify the whole integration suite passes

- [ ] **Step 1: Run the full suite**

  ```bash
  cd backend && npx jest integration/ --coverage=false
  ```

  Expected: all integration tests green, runtime under 10 seconds.

- [ ] **Step 2: Run the full backend suite to confirm no regressions**

  ```bash
  cd backend && npm run test:ci
  ```

  Expected: all unit + integration tests green. Confirm coverage report still uploads.

- [ ] **Step 3: Build to confirm the deployment path works**

  ```bash
  cd backend && npm run build
  ```

---

## Task 10: Wire into CI — `push` trigger

**Files:**
- Modify: `.github/workflows/build-and-test.yml`

- [ ] **Step 1: Update the workflow trigger**

  Change the top of `build-and-test.yml` from:

  ```yaml
  on:
    pull_request:
      branches: [main]
    workflow_dispatch:
  ```

  to:

  ```yaml
  on:
    push:
    pull_request:
      branches: [main]
    workflow_dispatch:
  ```

  Note: this will cause same-repo PRs to run the workflow twice per push. The follow-on `ci-concurrency-dedupe` plan suppresses one of them. If that plan is being landed in the same PR, apply both changes together; otherwise accept the temporary duplication.

- [ ] **Step 2: Update the trailing comment**

  Replace the comment at the bottom that says "Integration tests removed due to DynamoDB service container complexity" with:

  ```yaml
  # Integration tests run as part of test-backend (Jest test:ci picks up
  # backend/src/__tests__/integration/). They use an in-process in-memory
  # DynamoDB fake, not docker — see
  # docs/plans/2026-05-06-publisher-integration-tests-design.md.
  ```

- [ ] **Step 3: Push the branch and confirm CI runs**

  ```bash
  git add .github/workflows/build-and-test.yml
  git commit -m "ci: trigger build-and-test on every branch push"
  git push -u origin feat/publisher-integration-tests
  ```

  Watch the run in GitHub Actions. Confirm the integration tests appear in the Jest output.

---

## Task 11: Document the manual repo-settings step

**Files:**
- Modify: `docs/plans/2026-05-06-publisher-integration-tests-plan.md` (this file — append a "Post-merge" section)

- [ ] **Step 1: Tell the user what to flip in GitHub UI**

  After this PR merges, the user must update branch protection on `main`:

  - Settings → Branches → Branch protection rules → `main` → Edit
  - Under "Require status checks to pass before merging", add: `test-backend (24)`, `test-backend (25)`, `test-frontend (24)`, `test-frontend (25)`.
  - Save.

  This cannot be done from the workflow file. Note this in the PR description so it's not forgotten.

---

## Task 12: Open the PR

- [ ] **Step 1: Push and open**

  ```bash
  git push -u origin feat/publisher-integration-tests
  gh pr create --title "test(integration): publisher self-service & ingest backend integration tests" --body "$(cat <<'EOF'
## Summary
- New `backend/src/__tests__/integration/` suite covers publisher lifecycle, self-service portal, admin controls, ingest edge cases, and auth/limits — all journey-shaped, all running against an in-memory DDB fake.
- Pins the PR #100 (sticky `published`) and PR #78 (self-disable retracts) regressions so they can't recur.
- CI: `build-and-test.yml` now triggers on every branch push so this gates merges.

## Manual follow-up after merge
Add `test-backend (24)`, `test-backend (25)`, `test-frontend (24)`, `test-frontend (25)` to required status checks under main's branch protection.

## Test plan
- [ ] `npm run test:ci --workspace=backend` passes locally
- [ ] CI green on this PR
- [ ] CI red if I deliberately revert the PR #100 fix (regression catches it)
EOF
  )"
  ```

- [ ] **Step 2: Wait for CI to pass and request review**

---

## Post-merge

After this PR merges, the repo owner must update branch protection on `main`:

- Settings → Branches → Branch protection rules → `main` → Edit
- Under "Require status checks to pass before merging", add: `test-backend (24)`, `test-backend (25)`, `test-frontend (24)`, `test-frontend (25)`.
- Save.

This cannot be done from a workflow file — it requires repo-settings access in the GitHub UI.

The CI `push:` trigger broadening (Task 10) is achieved automatically by PR #103 (`chore/ci-concurrency-dedupe`), which adds `push: { branches: ['**'] }` plus `concurrency:`. No workflow file changes are made in this PR.
