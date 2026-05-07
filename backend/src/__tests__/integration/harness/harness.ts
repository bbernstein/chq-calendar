// Integration test harness.
//
// Each test file constructs a harness with `await createHarness({ now })` in
// `beforeEach`, runs a journey via the actor API, and discards the harness in
// `afterEach` (`harness.dispose()`).
//
// The harness owns:
//   - the in-memory DDB fake (shared across all services)
//   - real services constructed against the fake
//   - a clock controller, mail capture, fake feed fetcher, fake lambda invoker
//   - an in-memory rate limiter
//   - a per-harness JWT signing secret
//
// It calls the production handlers' `_setXxxForTests` injection points so the
// handlers route through our fakes instead of building their own clients.

// Side-effect import: sets env vars and unmocks the AWS SDK BEFORE any
// production module loads. adminHandler.ts captures JWT_SECRET / whitelist
// at module load, so this must be the first import in this file.
import './integrationSetup';

import { InMemoryDocClient, type TableSpec } from './inMemoryDocClient';
import {
  ClockController,
  MailCapture,
  FakeFeedFetcher,
  FakeLambdaInvoker,
  CaptchaToggle,
  FakeRateLimiter,
} from './fakes';
import { PublisherRegistryService } from '../../../services/publisherRegistryService';
import { PublisherEventStore } from '../../../services/publisherEventStore';
import { PublisherSidecarPublisher } from '../../../services/publisherSidecarPublisher';
import { PublisherApplicationService } from '../../../services/publisherApplicationService';
import { PublisherEmailChangeService } from '../../../services/publisherEmailChangeService';
import { PublisherAdminService } from '../../../services/publisherAdminService';
import { MagicTokenService } from '../../../services/magicTokenService';
import { runIngest, type IngestDeps } from '../../../handlers/publisherIngestHandler';
import * as portal from '../../../handlers/publisherPortalHandler';
import * as admin from '../../../handlers/adminHandler';
import * as captchaModule from '../../../services/captchaService';
import * as secretCache from '../../../services/publisherSecretCache';

import jwt from 'jsonwebtoken';
import type { Actors } from './actors';

// Re-exports for tests.
export type { ClockController, MailCapture, FakeFeedFetcher } from './fakes';
export { feedOk } from './fakes';

const PUBLISHERS_TABLE = 'publishers';
const PUBLISHER_EVENTS_TABLE = 'publisher-events';
const MAGIC_TOKENS_TABLE = 'magic-tokens';
const RATE_LIMIT_TABLE = 'rate-limit';

const TABLE_SPECS: TableSpec[] = [
  { name: PUBLISHERS_TABLE, hashKey: 'id' },
  {
    name: PUBLISHER_EVENTS_TABLE,
    hashKey: 'publisherId',
    sortKey: 'eventId',
    gsis: [{ name: 'by-state', hashKey: 'state', sortKey: 'startDate' }],
  },
  { name: MAGIC_TOKENS_TABLE, hashKey: 'tokenHash' },
  { name: RATE_LIMIT_TABLE, hashKey: 'id' },
];

export interface Harness {
  ddb: InMemoryDocClient;
  now: ClockController;
  feeds: FakeFeedFetcher;
  mail: MailCapture;
  invoker: FakeLambdaInvoker;
  captcha: CaptchaToggle;
  rateLimiter: FakeRateLimiter;
  registry: PublisherRegistryService;
  store: PublisherEventStore;
  appService: PublisherApplicationService;
  emailChangeService: PublisherEmailChangeService;
  adminService: PublisherAdminService;
  magicTokens: MagicTokenService;
  /** Ingest a feed cycle in-process. */
  ingest: { run: (singlePublisherId?: string) => Promise<void> };
  /** Sign a publisher session JWT for a given record. */
  signSession: (publisherId: string, opts?: { tokenVersion?: number; email?: string }) => Promise<string>;
  /** Returns event states for a publisher: { [eventId]: state }. */
  events: {
    statesOf: (publisherId: string) => Promise<Record<string, 'published' | 'pending'>>;
    count: (publisherId: string) => Promise<number>;
  };
  /** Lazily-imported actor wrappers. Set after createHarness completes. */
  actors: Actors;
  jwtSecret: string;
  dispose: () => void;
}

export interface CreateHarnessOpts {
  now?: Date | string;
}

// Module-level singletons (so harness can reset across tests).
let _harnessSingleton: Harness | null = null;
const TEST_JWT_SECRET = 'test-publisher-jwt-secret-do-not-use-in-prod';

// Mock the publisher secret cache so signPublisherJwt / verifyPublisherJwt use
// our deterministic secret. This needs to happen before any test module that
// imports auth. We do it once on first import of harness.ts.
let _secretMockInstalled = false;
function installSecretMock() {
  if (_secretMockInstalled) return;
  jest.spyOn(secretCache, 'getPublisherJwtSecret').mockResolvedValue(TEST_JWT_SECRET);
  _secretMockInstalled = true;
}

// Mock the captcha verifier to always go through our toggle.
// publisherPortalHandler calls verifyCaptchaWithBypass (the smoke-bypass wrapper added in PR #105),
// so we intercept that entry point too — otherwise the wrapper's internal call to verifyCaptcha
// uses the imported reference and bypasses jest.spyOn on the module export.
let _captchaMockInstalled = false;
let _captchaToggleRef: CaptchaToggle | null = null;
function installCaptchaMock() {
  if (_captchaMockInstalled) return;
  const toggleVerify = async (token: string, action: string | undefined) => {
    if (!_captchaToggleRef) return true;
    return _captchaToggleRef.verify(token, action);
  };
  jest.spyOn(captchaModule, 'verifyCaptcha').mockImplementation(toggleVerify);
  jest
    .spyOn(captchaModule, 'verifyCaptchaWithBypass')
    .mockImplementation(async (token, action, _headers) => toggleVerify(token, action));
  _captchaMockInstalled = true;
}

export async function createHarness(opts: CreateHarnessOpts = {}): Promise<Harness> {
  installSecretMock();
  installCaptchaMock();

  const now = new ClockController(opts.now ?? new Date());
  const ddb = new InMemoryDocClient(TABLE_SPECS);
  // The DDB fake has a `.send(cmd)` shape but isn't a real DocumentClient.
  // Services accept the type as `DynamoDBDocumentClient` — we cast through
  // unknown.
  const docClient = ddb as unknown as import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient;

  const mail = new MailCapture();
  const captcha = new CaptchaToggle();
  _captchaToggleRef = captcha;
  const feeds = new FakeFeedFetcher();
  const rateLimiter = new FakeRateLimiter(now);

  const nowFn = () => now.now;

  const registry = new PublisherRegistryService(docClient, PUBLISHERS_TABLE);
  const store = new PublisherEventStore(docClient, PUBLISHER_EVENTS_TABLE);
  const magicTokens = new MagicTokenService(docClient, MAGIC_TOKENS_TABLE, nowFn);

  // The sidecar publisher needs an S3 client; we don't actually exercise S3
  // in integration tests so we stub the publish() method.
  const sidecar = {
    publish: async () => undefined,
  } as unknown as PublisherSidecarPublisher;

  const appService = new PublisherApplicationService({
    registry,
    tokens: magicTokens,
    mail,
    siteBaseUrl: 'https://test.chqcal.local',
    now: nowFn,
  });
  const emailChangeService = new PublisherEmailChangeService({
    registry,
    tokens: magicTokens,
    mail,
    siteBaseUrl: 'https://test.chqcal.local',
    now: nowFn,
  });
  const adminService = new PublisherAdminService(registry, store, {
    mail,
    siteBaseUrl: 'https://test.chqcal.local',
  });

  // Set up ingest. The Lambda invoker (used by both /publisher-fetch-now and
  // /publishers/run-ingest) routes back to runIngest in-process so a single
  // harness run can drive both the API call and the resulting ingest.
  const ingestDeps: IngestDeps = {
    registry,
    store,
    sidecar,
    fetcher: feeds.fetchFn,
    now: nowFn(),
    publishersTableName: PUBLISHERS_TABLE,
  };
  const runIngestInProcess = async (payload: { singlePublisherId?: string } = {}) => {
    // Refresh deps.now to reflect the current clock.
    const deps: IngestDeps = { ...ingestDeps, now: now.now };
    await runIngest(deps, { singlePublisherId: payload.singlePublisherId });
  };
  const invoker = new FakeLambdaInvoker(runIngestInProcess);

  // Wire handler-level injection points. The setters simply overwrite the
  // module-level singletons in each handler; dispose() passes `null` to
  // each one, which causes those handlers to fall back to lazily
  // constructing fresh defaults on the next call (rather than restoring a
  // previously-captured value). This is safe because every test file
  // builds a new harness in beforeEach and tears it down in afterEach.
  portal._setStatusRegistryForTests(registry);
  portal._setAppServiceForTests(appService);
  portal._setEmailChangeServiceForTests(emailChangeService);
  portal._setSelfDisableDepsForTests({
    registry,
    magicTokens,
    mail,
  });
  portal._setRateLimiterForTests(rateLimiter);
  admin._setPublisherAdminForTests(adminService);
  admin._setLambdaClientForTests(invoker as unknown as import('@aws-sdk/client-lambda').LambdaClient);

  // Set the publisher-ingest function name so the invoker's lookup doesn't
  // throw. The fake invoker ignores the value.
  process.env.PUBLISHER_INGEST_FUNCTION_NAME = 'test-publisher-ingest';
  process.env.SES_FROM_ADDRESS = 'test@chqcal.local';
  process.env.SITE_BASE_URL = 'https://test.chqcal.local';

  // Lazy-import actors to avoid circular imports.
  const { buildActors } = await import('./actors');

  const events = {
    statesOf: async (publisherId: string) => {
      const all = await store.listForPublisher(publisherId);
      const out: Record<string, 'published' | 'pending'> = {};
      for (const e of all) out[e.eventId] = e.state;
      return out;
    },
    count: async (publisherId: string) => {
      const all = await store.listForPublisher(publisherId);
      return all.length;
    },
  };

  const signSession = async (publisherId: string, sopts: { tokenVersion?: number; email?: string } = {}) => {
    const rec = await registry.get(publisherId);
    const tv = sopts.tokenVersion ?? rec?.tokenVersion ?? 0;
    const email = sopts.email ?? rec?.contactEmail ?? 'test@example.com';
    return jwt.sign(
      {
        sub: publisherId,
        role: 'publisher',
        email,
        tokenVersion: tv,
      },
      TEST_JWT_SECRET,
      { expiresIn: '7d' },
    );
  };

  const harness: Harness = {
    ddb,
    now,
    feeds,
    mail,
    invoker,
    captcha,
    rateLimiter,
    registry,
    store,
    appService,
    emailChangeService,
    adminService,
    magicTokens,
    ingest: {
      run: async (singlePublisherId?: string) => {
        await runIngestInProcess(singlePublisherId ? { singlePublisherId } : {});
      },
    },
    signSession,
    events,
    actors: undefined as unknown as Actors,
    jwtSecret: TEST_JWT_SECRET,
    dispose: () => {
      portal._setStatusRegistryForTests(null);
      portal._setAppServiceForTests(null);
      portal._setEmailChangeServiceForTests(null);
      portal._setSelfDisableDepsForTests(null);
      portal._setRateLimiterForTests(null);
      admin._setPublisherAdminForTests(null);
      admin._setLambdaClientForTests(null);
      _captchaToggleRef = null;
      _harnessSingleton = null;
    },
  };
  harness.actors = buildActors(harness);
  _harnessSingleton = harness;

  return harness;
}

export function currentHarness(): Harness | null {
  return _harnessSingleton;
}
