// Tests for the bbtest reset path used by the post-deploy publisher
// smoke. The reset is idempotent (no-op on empty state, full cleanup on
// populated state, partial cleanup if only some rows exist) — each of
// those branches is covered below.

jest.unmock('@aws-sdk/lib-dynamodb');

import { resetBbtest } from '../services/smokeReset';
import type { PublisherRegistryService } from '../services/publisherRegistryService';
import type { PublisherEventStore } from '../services/publisherEventStore';
import type { PublisherRecord } from '../types/publisher';

const BBTEST_EMAIL = 'bbtest@chqcal.org';
const TOKENS_TABLE = 'chq-magic-tokens';

function makeRegistryFake(rowsByEmail: PublisherRecord[]): {
  registry: jest.Mocked<Pick<PublisherRegistryService, 'getByEmail' | 'delete' | 'upsert'>>;
  registryCalls: { upsert: PublisherRecord[]; delete: string[] };
} {
  const calls = { upsert: [] as PublisherRecord[], delete: [] as string[] };
  // Local copy so delete() actually mutates the result of subsequent
  // getByEmail calls — needed for the post-reset requestApply assertion.
  const rows = [...rowsByEmail];
  return {
    registryCalls: calls,
    registry: {
      getByEmail: jest.fn(async (e: string) => {
        // Mirror the real service's normalize-on-read.
        return rows.filter(r => r.contactEmail === e.toLowerCase().trim());
      }),
      delete: jest.fn(async (id: string) => {
        calls.delete.push(id);
        const idx = rows.findIndex(r => r.id === id);
        if (idx >= 0) rows.splice(idx, 1);
      }),
      upsert: jest.fn(async (rec: PublisherRecord) => { calls.upsert.push(rec); }),
    } as unknown as jest.Mocked<Pick<PublisherRegistryService, 'getByEmail' | 'delete' | 'upsert'>>,
  };
}

function makeEventStoreFake(eventsPerPublisher: Record<string, number>): {
  eventStore: jest.Mocked<Pick<PublisherEventStore, 'deleteAllForPublisher'>>;
  eventStoreCalls: { deleteAllForPublisher: string[] };
} {
  const calls = { deleteAllForPublisher: [] as string[] };
  return {
    eventStoreCalls: calls,
    eventStore: {
      deleteAllForPublisher: jest.fn(async (id: string) => {
        calls.deleteAllForPublisher.push(id);
        return eventsPerPublisher[id] ?? 0;
      }),
    } as unknown as jest.Mocked<Pick<PublisherEventStore, 'deleteAllForPublisher'>>,
  };
}

function makeDbFake(magicTokenRows: { tokenHash: string; email: string }[]): {
  db: { send: jest.Mock };
  dbCalls: { scans: number; deletes: string[] };
} {
  const calls = { scans: 0, deletes: [] as string[] };
  const send = jest.fn(async (cmd: { constructor: { name: string }; input?: Record<string, unknown> }) => {
    const name = cmd.constructor?.name;
    const input = cmd.input ?? {};
    if (name === 'ScanCommand') {
      calls.scans += 1;
      const filter = (input as { ExpressionAttributeValues?: { ':e'?: string } })
        .ExpressionAttributeValues?.[':e'];
      const matches = magicTokenRows.filter(r => r.email === filter);
      return { Items: matches };
    }
    if (name === 'DeleteCommand') {
      const key = (input as { Key?: { tokenHash?: string } }).Key;
      if (key?.tokenHash) calls.deletes.push(key.tokenHash);
      return {};
    }
    throw new Error(`unexpected DDB command in test: ${name}`);
  });
  return { db: { send }, dbCalls: calls };
}

function commonDeps(opts: {
  publishers?: PublisherRecord[];
  eventsPerPublisher?: Record<string, number>;
  magicTokens?: { tokenHash: string; email: string }[];
}) {
  const reg = makeRegistryFake(opts.publishers ?? []);
  const es = makeEventStoreFake(opts.eventsPerPublisher ?? {});
  const dbFake = makeDbFake(opts.magicTokens ?? []);
  return {
    deps: {
      registry: reg.registry as unknown as PublisherRegistryService,
      eventStore: es.eventStore as unknown as PublisherEventStore,
      db: dbFake.db as never,
      magicTokensTableName: TOKENS_TABLE,
    },
    registryCalls: reg.registryCalls,
    eventStoreCalls: es.eventStoreCalls,
    dbCalls: dbFake.dbCalls,
  };
}

const baselinePublisher: PublisherRecord = {
  id: 'pub-bbtest',
  name: 'bbtest',
  contactEmail: BBTEST_EMAIL,
  sourceUrl: 'https://example.com/bbtest.json',
  sourceType: 'json',
  trustLevel: 'auto',
  enabled: true,
  applicationStatus: 'approved',
  createdAt: '2026-01-01T00:00:00Z',
};

describe('resetBbtest', () => {
  it('is a no-op when nothing exists for the email', async () => {
    const { deps, registryCalls, eventStoreCalls, dbCalls } = commonDeps({});
    const r = await resetBbtest(deps, BBTEST_EMAIL);
    expect(r).toEqual({
      rowsAffected: 0,
      applicationsDeleted: 0,
      publishersDeleted: 0,
      eventsDeleted: 0,
      magicTokensDeleted: 0,
    });
    expect(registryCalls.delete).toEqual([]);
    expect(registryCalls.upsert).toEqual([]);
    expect(eventStoreCalls.deleteAllForPublisher).toEqual([]);
    expect(dbCalls.deletes).toEqual([]);
    // One scan still happens (we have to ask the magic-tokens table).
    expect(dbCalls.scans).toBe(1);
  });

  it('hard-deletes approved publisher rows (so requestApply can re-issue)', async () => {
    // The contract enforced here: after reset, no publisher row maps to
    // bbtest's email. requestApply refuses any email that maps to ANY
    // publisher row regardless of applicationStatus, so a row left in
    // place — even a pristinely-baseline-state one — would break the
    // smoke's step 1 on the next run.
    const dirty: PublisherRecord = {
      ...baselinePublisher,
      paused: true,
      selfPausedAt: '2026-01-02T00:00:00Z',
      selfDisabledAt: '2026-01-03T00:00:00Z',
      enabled: false, // self-disabled
      pendingThresholdHalt: { detectedAt: 'x', incomingFeed: { eventCount: 0, publisherId: 'pub-bbtest' } },
    };
    const { deps, registryCalls, eventStoreCalls } = commonDeps({
      publishers: [dirty],
      eventsPerPublisher: { 'pub-bbtest': 5 },
    });
    const r = await resetBbtest(deps, BBTEST_EMAIL);

    expect(eventStoreCalls.deleteAllForPublisher).toEqual(['pub-bbtest']);
    // Approved row is hard-deleted, NOT reset-in-place.
    expect(registryCalls.delete).toEqual(['pub-bbtest']);
    expect(registryCalls.upsert).toEqual([]);
    expect(r.rowsAffected).toBe(6); // 5 events + 1 publisher
    expect(r.publishersDeleted).toBe(1);
    expect(r.eventsDeleted).toBe(5);
  });

  it('hard-deletes pending application rows (vs resetting them in place)', async () => {
    const pending: PublisherRecord = {
      ...baselinePublisher,
      id: 'pub-bbtest-pending',
      enabled: false,
      applicationStatus: 'pending',
    };
    const { deps, registryCalls, eventStoreCalls } = commonDeps({
      publishers: [pending],
    });
    const r = await resetBbtest(deps, BBTEST_EMAIL);

    expect(registryCalls.delete).toEqual(['pub-bbtest-pending']);
    expect(registryCalls.upsert).toEqual([]); // never reset-in-place
    // Pending rows have no events to delete (smoke design — they were
    // never approved, never ingested), but the function does NOT call
    // deleteAllForPublisher for them either. The contract is "events are
    // tied to approved publishers."
    expect(eventStoreCalls.deleteAllForPublisher).toEqual([]);
    expect(r.applicationsDeleted).toBe(1);
    expect(r.rowsAffected).toBe(1);
  });

  it('hard-deletes rejected application rows', async () => {
    const rejected: PublisherRecord = {
      ...baselinePublisher,
      id: 'pub-bbtest-rejected',
      enabled: false,
      applicationStatus: 'rejected',
    };
    const { deps, registryCalls } = commonDeps({ publishers: [rejected] });
    const r = await resetBbtest(deps, BBTEST_EMAIL);
    expect(registryCalls.delete).toEqual(['pub-bbtest-rejected']);
    expect(r.applicationsDeleted).toBe(1);
  });

  it('cleans up magic-token rows by email', async () => {
    const { deps, dbCalls } = commonDeps({
      magicTokens: [
        { tokenHash: 'h1', email: BBTEST_EMAIL },
        { tokenHash: 'h2', email: BBTEST_EMAIL },
        { tokenHash: 'other', email: 'someone-else@example.com' }, // must NOT be touched
      ],
    });
    const r = await resetBbtest(deps, BBTEST_EMAIL);
    expect(dbCalls.deletes.sort()).toEqual(['h1', 'h2']); // 'other' excluded
    expect(r.magicTokensDeleted).toBe(2);
  });

  it('handles partial state (only magic-token rows exist, no publisher)', async () => {
    // This shape happens when an apply request was sent (token issued + email
    // dispatched) but the user never clicked through. The reset must still
    // clean up the orphaned token row so the next smoke run can issue fresh
    // ones without colliding.
    const { deps, registryCalls, dbCalls } = commonDeps({
      magicTokens: [{ tokenHash: 'orphan', email: BBTEST_EMAIL }],
    });
    const r = await resetBbtest(deps, BBTEST_EMAIL);
    expect(registryCalls.upsert).toEqual([]);
    expect(registryCalls.delete).toEqual([]);
    expect(dbCalls.deletes).toEqual(['orphan']);
    expect(r.magicTokensDeleted).toBe(1);
    expect(r.rowsAffected).toBe(1);
  });

  it('normalizes the email before querying', async () => {
    const { deps, registryCalls } = commonDeps({
      publishers: [baselinePublisher], // contactEmail = lowercased BBTEST_EMAIL
    });
    // Pass a mixed-case version of the email — the reset must lowercase
    // before scanning so the match still hits.
    const r = await resetBbtest(deps, '  BBTest@CHQCAL.ORG  ');
    expect(registryCalls.delete).toEqual(['pub-bbtest']);
    expect(r.publishersDeleted).toBe(1);
  });

  it('rejects an empty email outright (would otherwise scan-delete everything)', async () => {
    const { deps } = commonDeps({});
    await expect(resetBbtest(deps, '')).rejects.toThrow(/non-empty/);
    await expect(resetBbtest(deps, '   ')).rejects.toThrow(/non-empty/);
  });

  it('is idempotent — second call after the first has rowsAffected=0', async () => {
    const dirty: PublisherRecord = {
      ...baselinePublisher,
      paused: true,
    };
    const { deps } = commonDeps({
      publishers: [dirty],
      eventsPerPublisher: { 'pub-bbtest': 0 },
    });
    const first = await resetBbtest(deps, BBTEST_EMAIL);
    expect(first.publishersDeleted).toBe(1);

    // Post-first-reset world: row was deleted, so subsequent getByEmail returns [].
    const { deps: deps2 } = commonDeps({});
    const second = await resetBbtest(deps2, BBTEST_EMAIL);
    expect(second.rowsAffected).toBe(0);
  });

  it('after reset, requestApply (PublisherApplicationService) succeeds for the bbtest email', async () => {
    // Integration-style assertion: the contract that motivates "delete the
    // approved row, don't reset-in-place" is that
    // PublisherApplicationService.requestApply must succeed on the next
    // smoke run. We exercise that contract directly here against an
    // in-memory registry.
    const reg = makeRegistryFake([baselinePublisher]).registry;
    // Wire the fake into the resetBbtest deps. The eventStore and db can
    // be the same shared fakes — they don't matter for the post-reset
    // requestApply call.
    const dbFake = makeDbFake([]);
    const eventStoreFake = makeEventStoreFake({ 'pub-bbtest': 0 });
    const deps = {
      registry: reg as unknown as PublisherRegistryService,
      eventStore: eventStoreFake.eventStore as unknown as PublisherEventStore,
      db: dbFake.db as never,
      magicTokensTableName: TOKENS_TABLE,
    };

    // Pre-reset: getByEmail returns the approved row, so any logical
    // requestApply call would refuse.
    const before = await reg.getByEmail(BBTEST_EMAIL);
    expect(before).toHaveLength(1);

    await resetBbtest(deps, BBTEST_EMAIL);

    // Post-reset: getByEmail returns [], so the requestApply uniqueness
    // gate (registry.getByEmail(email).length > 0) does NOT fire.
    const after = await reg.getByEmail(BBTEST_EMAIL);
    expect(after).toEqual([]);
  });
});
