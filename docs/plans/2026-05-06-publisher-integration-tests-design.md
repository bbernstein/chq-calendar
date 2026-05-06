# Publisher self-service & ingest — backend integration tests (design)

**Date:** 2026-05-06
**Status:** Approved, ready for implementation plan
**Origin:** User request to integration-test publisher self-service plus the recent reconciler-clobber (PR #100) and self-disable-retracts (PR #78) regressions, ahead of relying on these flows in production.

## Problem

The backend has thorough per-handler unit tests, but only one true cross-handler integration test (`publisherIngestHandler.integration.test.ts`) and even that one mocks every collaborator. There is no test that wires `publisherPortalHandler` + `adminHandler` + `publisherIngestHandler` against shared state and walks a full publisher journey. Two recent bugs — admin approvals clobbered on re-ingest (PR #100) and self-disable not retracting events (PR #78) — would have been caught by such tests.

A previous attempt at integration tests using DynamoDB Local was removed because of "service container complexity" (see footer of `.github/workflows/build-and-test.yml`). The plan here uses an **in-process in-memory DynamoDB fake** instead, sidestepping that operational cost while preserving the same end-to-end coverage.

## Policy

- "Integration" means: real handler routing, real services, single shared in-memory DDB. The only mocks are true externals — SES mail, Lambda invoker, the CAPTCHA verifier, the JWT signer's clock-source.
- Tests are journey-shaped, not endpoint-shaped: each `it(...)` walks a publisher through several handler calls and asserts end state on the shared store.
- Test failures should pinpoint behavior, not implementation. Assertions read against the actor API (`harness.events.statesOf(publisherId)`), not raw DDB rows.
- The in-memory DDB fake fails loudly on any unsupported command shape — better a missing case break a test than silently produce wrong data.

## Scope

### In

End-to-end coverage of:

- Application lifecycle (apply → admin approve / reject → portal access)
- Self-service portal actions (profile update, email change with magic-link, pause, resume, fetch-now, self-disable)
- Admin actions (pause, disable, approve event, reject event, run-ingest button)
- Ingest behavior (auto-trust publish, review-trust pending, retraction on disable, sticky `published` across re-ingest)
- Feed edge cases (network error, schema-invalid feed, unchanged `lastModified`, threshold halt)
- Auth/abuse (CAPTCHA toggle, magic-token replay/expiry, per-IP rate-limit window)
- DNS-rebinding guard on fetch-now (PR #85 regression)

### Out

- Frontend code, service-worker (covered by separate spec)
- Real DynamoDB / docker-compose
- Real SES, real Lambda invocation
- Google OAuth admin sign-in (admin actions go through `PublisherAdminService` with a fake admin identity)
- Frontend portal pages (covered by separate spec — `frontend-portal-integration-tests`)

## Architecture

```
backend/src/__tests__/integration/
├── harness/
│   ├── inMemoryDocClient.ts     # Fake DynamoDBDocumentClient.send()
│   ├── fakes.ts                 # MailCapture, FakeFeedFetcher, FakeLambdaInvoker, ClockController, CaptchaToggle
│   ├── harness.ts               # createHarness({ now }) — wires real services, injects via _setXxxForTests
│   └── actors.ts                # publisher / admin / ingest action helpers
├── lifecycle.test.ts
├── selfService.test.ts
├── adminControls.test.ts
├── ingestEdgeCases.test.ts
└── authAndLimits.test.ts
```

### In-memory DDB fake

Implements the `.send(cmd)` shape of `DynamoDBDocumentClient`. Storage is `Map<tableName, Map<keyJson, item>>`. Supported commands: `Get`, `Put`, `Update`, `Delete`, `Query`, `Scan`, `BatchGet`, `BatchWrite`, `TransactWrite` (including `ConditionCheck` items). `ExpressionAttributeNames`/`Values` substitution and these condition operators: `attribute_exists`, `attribute_not_exists`, `=`, `<>`, `<`, `>`, `<=`, `>=`, `AND`, `OR`. On condition fail, throws an error whose `name` is `'ConditionalCheckFailedException'` so service code that catches by name keeps working.

GSI support: each table can declare GSIs at construction time; `Query` against an `IndexName` scans the map for items whose hash/sort match. Fine for test volumes (hundreds of items at most).

The fake **does not** implement: streams, TTL, transactions across tables (it does support cross-table within a single `TransactWrite`), pagination beyond `LastEvaluatedKey` echo, server-side filters that aren't `KeyConditionExpression`/`FilterExpression` literals.

### Wiring

`createHarness({ now })` returns:

```ts
{
  now: ClockController,                  // .advance(ms) | .set(date)
  feeds: FakeFeedFetcher,                // .set(publisherId, FetchResult)
  mail: MailCapture,                     // .lastTo(addr) | .all() | .clear()
  invoker: FakeLambdaInvoker,            // routes to runIngest() in-process
  captcha: CaptchaToggle,                // .pass() | .fail()
  events: { statesOf(pubId): Record<eventId,state>, count(pubId): number },
  publisher: { apply, verifyApplyMagicLink, login, status, updateProfile,
               requestEmailChange, confirmEmailChange,
               pause, resume, fetchNow, selfDisable },
  admin: { approveApplication, rejectApplication, listPublishers,
           pause, resume, disable, approveEvent, rejectEvent, runIngest },
  ingest: { run() }                      // direct call to publisherIngestHandler.runIngest
}
```

Each actor builds an `APIGatewayProxyEvent`, optionally signs a session JWT with the harness-owned secret, and invokes the handler. Errors are unwrapped from the JSON response and re-thrown as typed errors so `expect(...).rejects.toThrow(...)` works.

### Handler wiring approach

Real services are constructed against the fake doc client and injected through the existing `_setXxxForTests` hooks:

- `publisherPortalHandler._setStatusRegistryForTests`
- `publisherPortalHandler._setAppServiceForTests`
- `publisherPortalHandler._setEmailChangeServiceForTests`
- `publisherPortalHandler._setSelfDisableActionForTests` / `_setSelfDisableDepsForTests`
- `publisherPortalHandler._setRateLimiterForTests`
- `adminHandler._setPublisherAdminForTests`
- `adminHandler._setLambdaClientForTests`

Module-level mocks (one per file, declared at top):

- `../services/publisherAuthService.verifyPublisherJwt` — accepts a stub session created by the harness
- `../services/captchaService.verifyCaptcha` — wired to `CaptchaToggle`
- `../services/mailService.SesMailService` — wired to `MailCapture`
- `../services/publisherIngestInvoker.lambdaClient.send` — routed to in-process `runIngest`

`setup.ts` mocks `@aws-sdk/lib-dynamodb` globally; integration files start with `jest.unmock('@aws-sdk/lib-dynamodb')` so the SDK type exists but our services receive the *fake* client by constructor (the SDK is never actually called).

## Test plan

### lifecycle.test.ts

1. Auto-trust publisher: apply → verify magic-link → admin approve → ingest publishes events as `published`.
2. Review-trust publisher: apply → admin approve → ingest creates `pending` events → admin approves event → re-ingest with bumped `lastModified` keeps state `published`. **(PR #100 regression — sticky approvals.)**
3. Application rejection: applicant gets reject email; no publisher row created; portal login attempt 401s.
4. Application duplicate-email: second apply with same email returns `EmailAlreadyInUseError`.

### selfService.test.ts

5. Pause: portal pause → next ingest skips that publisher (no `applyDiff`, no sidecar publish) → resume → ingest publishes.
6. Profile update: name + contact change persists on registry; invalid input (empty name, malformed URL) returns 400 without writing.
7. Email change: request → magic-link confirm with new email → portal login with new email succeeds; re-using the magic link returns 400.
8. Email change cancellation by old-email link works; later confirm with the same token fails.
9. Self-disable: portal disable with correct typed slug → `enabled=false`; next ingest retracts events. **(PR #78 regression.)**
10. Self-disable typed-slug mismatch returns 400; publisher remains enabled; no events affected.
11. Fetch-now: portal call invokes ingest in-process via `FakeLambdaInvoker`; new feed events appear within the same test step.

### adminControls.test.ts

12. Admin disable → next ingest retracts events.
13. Admin pause → next ingest skips.
14. Admin reject event → re-ingest preserves `rejected` state (no clobber).
15. Admin approve event idempotent: approving an already-published event is a no-op.
16. Admin "Run ingest now" button (PR #96) routes through `_setLambdaClientForTests` and triggers a single ingest cycle.

### ingestEdgeCases.test.ts

17. Fetch network error: `recordFetchOutcome` records `network_error`; no diff applied; prior events preserved.
18. Schema-invalid feed: `recordFetchOutcome` records `validation_failed`; no diff.
19. Unchanged feed (`lastModified` same on every event): no `applyDiff`, no sidecar publish.
20. Threshold halt: feed shrinks from N events to <50% of N → `setThresholdHalt` called; events untouched until admin clears.
21. Disabled publisher in registry: ingest skips entirely.

### authAndLimits.test.ts

22. Apply with failing CAPTCHA returns 400; no application created.
23. Apply with passing CAPTCHA succeeds.
24. Magic token: replay rejected; expired (clock advanced past TTL) rejected; valid one-shot succeeds.
25. Per-IP rate limit on portal POST: 5 succeed, 6th in window returns 429; advance clock past window → succeeds again.
26. DNS-rebinding guard on fetch-now: `0.0.0.0`, `127.0.0.1`, `169.254.169.254` source URLs rejected with 400 (PR #85 regression).

## CI integration

Tests live under the existing Jest config and run as part of `npm run build --workspace=backend` (which runs `prebuild → test:ci`). No new Jest project. The CI workflow change is to broaden the trigger from `pull_request: [main]` only to `push:` on any branch, plus a `concurrency:` block to dedupe rapid re-pushes (the latter is covered by a separate spec — `ci-concurrency-dedupe`).

Required-check enforcement is a GitHub repo settings change (Settings → Branches → main → Require status checks). Documented in the implementation plan but not modifiable from a workflow file.

## Non-goals

- Performance / load testing
- Mutation testing
- Property-based fuzzing of feed parsing
- Coverage floor enforcement (separate spec — `ci-coverage-floor`)
- Frontend portal coverage (separate spec — `frontend-portal-integration-tests`)
- Production smoke tests (separate spec — `post-deploy-publisher-smoke-test`)

## Risks

- **In-memory DDB fake drift from real DDB.** Mitigation: keep the supported-command surface narrow and fail loudly on anything else; review the fake against real-DDB behavior whenever a service starts using a new command shape.
- **Module-mocked auth/captcha could mask real vulnerabilities.** Mitigation: per-module unit tests for `verifyPublisherJwt`, `verifyCaptcha` already exist and stay in place.
- **Test-only injection hooks add API surface.** Already accepted pattern in this repo; no new hooks needed for this spec.

## File counts (estimated)

- In-memory DDB fake: 250–350 lines
- Harness + actors + fakes: 300–400 lines
- Five test files: 800–1,200 lines combined
- Total: ~1,400–1,950 lines, single PR
