// Post-deploy publisher-lifecycle smoke. Runs against the real production
// stack (https://www.chqcal.org) after every prod deploy via
// .github/workflows/deploy-production.yml.
//
// Required env vars (set in deploy-production.yml from GitHub repo secrets):
//   SMOKE_API_BASE             — base URL, e.g. https://www.chqcal.org
//   SMOKE_BBTEST_EMAIL         — the dedicated test email (chosen in plan task 1)
//   SMOKE_ADMIN_SIGNING_KEY    — same value provisioned to the admin Lambda
//   SMOKE_CAPTCHA_BYPASS_TOKEN — same value provisioned to the admin Lambda
//
// The journey:
//   beforeAll  : reset bbtest to baseline (idempotent — leftover state from
//                a killed previous run is cleaned)
//   afterAll   : reset bbtest again (so live calendar isn't left with the
//                bbtest test events)
//
//   The single `it(...)` block walks bbtest through:
//     apply → consume-by-email (smoke shortcut for verifyApply)
//        → admin-approve → run-ingest → assert events published
//        → publisher-pause → run-ingest → assert event count unchanged
//        → publisher-resume → run-ingest → assert events still published
//        → publisher-self-disable → run-ingest → assert event count is 0
//
// Wall-clock ceiling: 5 minutes. Real ingest fires async on the admin
// Lambda; the smoke uses a short polling loop after each run-ingest call.

import { SmokeApiClient } from './lib/apiClient';
import { resetBbtestEmail } from './lib/reset';

const SMOKE_API_BASE = process.env.SMOKE_API_BASE ?? 'https://www.chqcal.org';
const SMOKE_BBTEST_EMAIL = process.env.SMOKE_BBTEST_EMAIL ?? '';
const SMOKE_CAPTCHA_BYPASS_TOKEN = process.env.SMOKE_CAPTCHA_BYPASS_TOKEN ?? '';

// Skip the journey at config time when env vars are missing — running
// `npm run smoke:publisher` locally without the secrets should print a
// clear "skipped" line instead of erroring at the first fetch. CI will
// always have the env, so a skipped run there indicates a config bug.
const skipReason =
  !SMOKE_BBTEST_EMAIL ? 'SMOKE_BBTEST_EMAIL not set' :
  !SMOKE_CAPTCHA_BYPASS_TOKEN ? 'SMOKE_CAPTCHA_BYPASS_TOKEN not set' :
  !process.env.SMOKE_ADMIN_SIGNING_KEY ? 'SMOKE_ADMIN_SIGNING_KEY not set' :
  null;

const describeMaybe = skipReason ? describe.skip : describe;

const api = new SmokeApiClient({
  baseUrl: SMOKE_API_BASE,
  captchaBypassToken: SMOKE_CAPTCHA_BYPASS_TOKEN,
});

// Poll-until helper. The admin run-ingest endpoint is async-invoke, so we
// poll the event count for up to `timeoutMs` waiting for the predicate to
// become true. Failure prints the last observed count to make the
// CloudWatch <-> smoke correlation easier.
async function waitForEventCount(
  publisherId: string,
  predicate: (count: number) => boolean,
  opts: { timeoutMs: number; intervalMs?: number; description: string },
): Promise<number> {
  const interval = opts.intervalMs ?? 5_000;
  const deadline = Date.now() + opts.timeoutMs;
  let lastCount = -1;
  while (Date.now() < deadline) {
    lastCount = (await api.admin.eventCount(publisherId)).count;
    if (predicate(lastCount)) return lastCount;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(
    `[smoke] timed out waiting for event count predicate (${opts.description}) after ${opts.timeoutMs}ms; last observed count=${lastCount}`,
  );
}

if (skipReason) {
  // eslint-disable-next-line no-console
  console.warn(`[smoke] skipping publisher-lifecycle: ${skipReason}`);
}

describeMaybe('post-deploy publisher lifecycle', () => {
  beforeAll(async () => {
    await resetBbtestEmail(api, SMOKE_BBTEST_EMAIL);
  }, 60_000);
  afterAll(async () => {
    await resetBbtestEmail(api, SMOKE_BBTEST_EMAIL);
  }, 60_000);

  it('walks bbtest through apply → approve → publish → pause → resume → self-disable', async () => {
    // 1. Apply (with CAPTCHA bypass header).
    const apply = await api.publisher.applyRequest({
      email: SMOKE_BBTEST_EMAIL,
      name: 'bbtest smoke',
      sourceUrl: 'https://example.com/bbtest.json',
      sourceType: 'json',
      organization: 'CI smoke run',
      notes: `smoke run @ ${new Date().toISOString()}`,
    });
    expect(apply).toMatchObject({ ok: true });

    // 2. Consume the apply token by email (smoke shortcut: replays the
    //    /publisher-apply/verify side-effects without needing the raw token,
    //    since raw tokens are SES-only and not recoverable from DDB).
    const consumed = await api.admin.consumeApplyByEmail(SMOKE_BBTEST_EMAIL);
    expect(consumed.publisherId).toMatch(/^pub-/);
    const publisherId = consumed.publisherId;
    const publisherJwt = consumed.jwt;

    // 3. Admin approves the application.
    const approved = await api.admin.approveApplication(publisherId);
    expect(approved.publisher.id).toBe(publisherId);
    expect(approved.publisher.enabled).toBe(true);

    const list = await api.admin.listPublishers();
    expect(list.publishers).toContainEqual(
      expect.objectContaining({ id: publisherId, enabled: true }),
    );

    // 4. Trigger ingest and assert events publish.
    await api.admin.runIngest();
    const publishedCount = await waitForEventCount(
      publisherId,
      (n) => n > 0,
      { timeoutMs: 90_000, description: 'first publish' },
    );
    expect(publishedCount).toBeGreaterThan(0);

    // 4b. Assert the new observability endpoints reflect the publish.
    const runsResp = await api.publisher.runs(publisherJwt);
    expect(runsResp.runs.length).toBeGreaterThan(0);
    const mostRecent = runsResp.runs[0];
    expect(mostRecent.status).toBe('ok');
    expect(mostRecent.counts?.added).toBeGreaterThan(0);

    const eventsResp = await api.publisher.events(publisherJwt);
    expect(eventsResp.events.length).toBe(publishedCount);
    // bbtest is created with trustLevel='review' (consumeApplyByEmail in
    // adminHandler.ts hardcodes that), so freshly-ingested events sit in
    // 'pending' until an admin approves each one. The smoke does not
    // approve individual events, so we assert the contract (a valid state
    // and the projection shape) rather than a specific state.
    for (const e of eventsResp.events) {
      expect(['published', 'pending']).toContain(e.state);
      expect(typeof e.eventId).toBe('string');
      expect(typeof e.title).toBe('string');
    }

    // 5. Pause + ingest. Event count should remain unchanged (paused
    //    publishers are skipped in the ingest loop; existing events stay).
    await api.publisher.pause(publisherJwt);
    await api.admin.runIngest();
    // Give the ingest a beat to NOT touch this publisher.
    await new Promise(r => setTimeout(r, 15_000));
    const afterPause = (await api.admin.eventCount(publisherId)).count;
    expect(afterPause).toBe(publishedCount);

    // 6. Resume + ingest. Events should still be published.
    await api.publisher.resume(publisherJwt);
    await api.admin.runIngest();
    const afterResume = await waitForEventCount(
      publisherId,
      (n) => n > 0,
      { timeoutMs: 90_000, description: 'republish after resume' },
    );
    expect(afterResume).toBeGreaterThan(0);

    // 7. Self-disable + ingest. The reconciler retracts (deletes) all
    //    events for self-disabled publishers; count must drop to 0.
    // confirmSlug must equal the publisher id exactly (per
    // backend/src/handlers/publisherPortalHandler.ts handlePublisherDisable).
    await api.publisher.selfDisable(publisherJwt, { confirmSlug: publisherId });
    await api.admin.runIngest();
    const afterDisable = await waitForEventCount(
      publisherId,
      (n) => n === 0,
      { timeoutMs: 90_000, description: 'retract after self-disable' },
    );
    expect(afterDisable).toBe(0);

    // 7b. After self-disable + retract, both observability endpoints should
    //     still return 200 (publisher row exists, just disabled), but events
    //     will be empty and the most-recent run will reflect the retraction.
    const runsAfterDisable = await api.publisher.runs(publisherJwt);
    expect(runsAfterDisable.runs.length).toBeGreaterThan(0);

    const eventsAfterDisable = await api.publisher.events(publisherJwt);
    expect(eventsAfterDisable.events.length).toBe(0);
  }, 5 * 60 * 1000);
});
