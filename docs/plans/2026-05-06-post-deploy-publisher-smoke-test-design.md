# Post-deploy publisher smoke test (design)

**Date:** 2026-05-06
**Status:** Approved, ready for implementation plan
**Origin:** A `bbtest` test publisher already exists in production (per the cleanup-followups memory). Each prod deploy currently relies on humans noticing breakage. We want an automated end-to-end check of the publisher lifecycle right after every prod deploy.

## Problem

The integration tests verify behavior in-process against a fake DDB. They don't catch problems that only show up against the real stack: misconfigured IAM, missing env vars on a Lambda, an SES sandbox restriction, an API Gateway route that didn't deploy, a CloudFront cache rule that swallowed a response. Every recent infra hotfix in the git log (`#97 ConditionCheckItem`, `#99 magic-tokens Scan`, `#94 GSI migration`) is the kind of issue that would have been caught by a smoke test that walks the lifecycle through real APIs.

## Policy

- Run automatically on every prod deploy, immediately after the deploy step.
- Use a dedicated, idempotent test publisher (`bbtest`) — never affects real publisher data.
- Self-clean: every test run leaves the test publisher in the same starting state, regardless of where it failed.
- Fail loudly: a smoke-test failure marks the deploy job red. No silent passes.
- One round-trip max — under 5 minutes wall-clock so it doesn't dominate deploy time.

## Scope

### In

A single scripted journey that exercises the highest-risk surfaces:

1. Apply (with real CAPTCHA bypass via test-only header — see Risks)
2. Magic-link verify (mailbox poll via Gmail API on the bbtest mailbox, OR test-only handler that returns the token directly to authorized callers)
3. Admin approve (using a CI-issued service token, not Google OAuth)
4. Portal status check
5. Pause + ingest run + verify skip
6. Resume + ingest run + verify publish
7. Self-disable + ingest run + verify retraction
8. Re-enable + reset back to baseline state

Every step asserts the API response shape and the side-effect (DDB row, sidecar JSON, sent mail count).

### Out

- Frontend rendering (the page tests cover that)
- CAPTCHA itself (bypassed by test path)
- Real Google OAuth admin sign-in (a CI-only signed token does the admin role)
- Performance benchmarks
- Multi-publisher concurrency

## Architecture

```
scripts/
└── smoke/
    ├── publisher-lifecycle.ts        # main entry
    ├── lib/
    │   ├── apiClient.ts              # typed wrappers for /publisher-*, /admin/*
    │   ├── mailbox.ts                # poll for magic link (Gmail API or mailcatcher)
    │   ├── adminAuth.ts              # signs CI service token
    │   └── reset.ts                  # idempotent teardown for bbtest
    └── publisher-lifecycle.test.ts   # the journey, written as Jest test for parity with build-and-test reporting
```

### Where it runs

`.github/workflows/deploy-production.yml` already exists with post-deploy verification. Add a step after the existing deploy step:

```yaml
- name: Post-deploy publisher lifecycle smoke
  run: npm run smoke:publisher
  env:
    SMOKE_API_BASE: https://www.chqcal.org
    SMOKE_BBTEST_EMAIL: ${{ secrets.SMOKE_BBTEST_EMAIL }}
    SMOKE_ADMIN_SIGNING_KEY: ${{ secrets.SMOKE_ADMIN_SIGNING_KEY }}
    SMOKE_CAPTCHA_BYPASS_TOKEN: ${{ secrets.SMOKE_CAPTCHA_BYPASS_TOKEN }}
```

(No Gmail refresh token — we use the in-band `/admin/smoke-magic-token-by-email` endpoint instead of mailbox polling.)

`npm run smoke:publisher` calls `jest --config=jest.smoke.config.js scripts/smoke/publisher-lifecycle.test.ts` so test output appears alongside other Jest output in the deploy log.

### Test-only backend hooks needed

All three are NEW additions; none currently exist in the codebase. Implementation order and tasks are in the plan doc.

1. **CAPTCHA bypass.** New behavior in `verifyCaptcha`: when env `CAPTCHA_BYPASS_TOKEN` is set AND the request carries header `X-Smoke-Bypass` matching it, return early with success. Today's signature is `verifyCaptcha(token, action) → Promise<boolean>` — the change must either (a) add a `headers` parameter and thread it through every callsite, or (b) gate via a wrapper that consumes the header before calling `verifyCaptcha`. The plan picks (b) to avoid touching every callsite. Secret stored in CI and Lambda env.
2. **Admin service token.** New verifier branch in `adminHandler`'s auth resolution: after the Google OAuth check fails, fall through to an HS256 JWT verifier (env `ADMIN_SMOKE_SIGNING_KEY`) with `sub: 'smoke-bot'`. Accepted as admin **only** for the smoke route allowlist (approve application, run ingest, list publishers, disable, re-enable, smoke-reset, smoke-magic-token-by-email, event-count). Other routes 403 even with a valid smoke token.
3. **Magic-link in-band fetch.** Real SES still sends mail (so the production path is exercised), but the smoke script never reads mail. Instead, a new endpoint `POST /admin/smoke-magic-token-by-email` (admin-allowlisted) returns the latest unverified magic-token row for an email. ~50 lines.

### Idempotent reset

Before the journey runs, `reset.ts` calls a smoke-only admin endpoint `POST /admin/smoke-reset-bbtest` that:

- Deletes any application rows for the bbtest email.
- Deletes the bbtest publisher's events.
- Sets the bbtest publisher row to baseline (`enabled=true`, `state='active'`, `trustLevel='auto'`).
- Clears any in-flight magic-token and email-change rows for the bbtest email.

If the bbtest publisher doesn't exist, reset is a no-op. After the journey, reset runs again so the next run starts clean.

## Test plan (single Jest test, multiple assertions)

```ts
describe('post-deploy publisher lifecycle', () => {
  beforeAll(reset);
  afterAll(reset);

  it('walks bbtest through apply → approve → publish → disable → retract → reset', async () => {
    const { applicationId } = await api.publisher.apply({ email: bbtestEmail, ... });
    await api.publisher.verifyApplyMagicLink({ email: bbtestEmail });
    const { publisherId } = await api.admin.approveApplication(applicationId);

    expect(await api.admin.listPublishers()).toContainEqual(expect.objectContaining({ id: publisherId, enabled: true }));

    await api.admin.runIngest({ publisherId });
    const publishedCount = await api.admin.eventCount({ publisherId });
    expect(publishedCount).toBeGreaterThan(0);

    await api.publisher.pause(publisherId);
    await api.admin.runIngest({ publisherId });
    expect(await api.admin.eventCount({ publisherId })).toBe(publishedCount);  // unchanged

    await api.publisher.resume(publisherId);
    await api.admin.runIngest({ publisherId });
    expect(await api.admin.eventCount({ publisherId })).toBeGreaterThan(0);   // republished after resume

    await api.publisher.selfDisable(publisherId, { confirmSlug: 'bbtest' });
    await api.admin.runIngest({ publisherId });
    expect(await api.admin.eventCount({ publisherId })).toBe(0);  // retracted
  }, 5 * 60 * 1000);
});
```

## CI integration

Belongs only in `deploy-production.yml`, NOT in `build-and-test.yml`. Reasons:

- The journey calls real APIs and can't run on every PR push.
- Production traffic during the test run sees the real bbtest publisher's transitions; we accept that bbtest events appear/disappear from the live calendar briefly.
- A failed smoke is a *deploy* failure, not a *PR* failure.

If the smoke fails, the deploy job is marked red. Rollback is a separate decision (the deploy already succeeded; what failed is the verification). The plan adds a runbook entry on what to check when smoke goes red.

## Non-goals

- Synthetic load
- Cross-region failover
- Service-worker or browser-cache verification (different test type)

## Risks

- **CAPTCHA bypass token leaking.** Mitigation: bypass token is a high-entropy secret in CI/Lambda env only; rotates with infra; bypass header is logged as a tagged event so misuse is auditable. The bypass works only on the apply route.
- **Admin smoke signing key leaking.** Mitigation: HS256 key separate from Google OAuth path; smoke token is rejected on routes the smoke test does not need; usage tagged in CloudWatch with `sub: 'smoke-bot'`.
- **Real-mail flakiness.** Mitigation: prefer the test-only DDB lookup path over Gmail polling (less moving parts).
- **bbtest leaks into real calendar.** Acceptable: bbtest events are clearly labeled and live <5min during a deploy. The reset step removes them at end.
- **Smoke runs concurrently with itself.** Mitigation: `concurrency:` on the deploy workflow already serializes deploys, so two smokes can't run at once.

## File counts (estimated)

- Test-only backend endpoints (smoke-reset, magic-token-by-email-for-smoke): ~120 lines + IAM + Terraform if separate route.
- Smoke script + helpers: ~250 lines.
- Workflow YAML changes: ~15 lines.
- Total: ~400 lines plus secret provisioning.

## Open question for implementation phase

Whether to add a separate Lambda function URL for smoke endpoints or piggy-back on `adminHandler` with the dedicated verifier branch. Recommendation: piggy-back, gated by signing-key check; new Lambda is unwarranted infra.
