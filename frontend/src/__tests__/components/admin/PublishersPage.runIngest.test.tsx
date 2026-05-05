// Component tests for the polling state machine in handleRunIngest on the
// /admin/publishers/ page. Each prior copilot/claude review iteration found
// a regression in this block (double-trigger window, paused publishers
// forcing timeouts, post-trigger rows being counted, stale closure on
// publishers). These tests pin down the contract so the next refactor
// trips an alarm before reaching production.
//
// Approach: render the full PublishersPage with adminPublisherApi mocked
// so we can drive `runPublisherIngest` and `listPublishers` from the test,
// then exercise the toolbar's "Run ingest now" button and observe the
// status indicator + button-disabled state across poll ticks.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/preact';

import type { PublisherRecord } from '@/lib/adminPublisherApi';

// All API functions used by PublishersPage must be mocked or the component
// will hit real endpoints during render.
vi.mock('@/lib/adminPublisherApi', () => ({
  listPublishers: vi.fn(),
  createPublisher: vi.fn(),
  updatePublisher: vi.fn(),
  deletePublisher: vi.fn(),
  listPendingApplications: vi.fn(),
  runPublisherIngest: vi.fn(),
}));

// useAdminAuth defaults to null while it bootstraps; we stub it so the
// page renders the table immediately without redirecting to login.
vi.mock('@/hooks/useAdminAuth', () => ({
  useAdminAuth: () => ({ email: 'dev@localhost.local', name: 'Local Dev User' }),
}));

// Inline child components are simple wrappers; mock them so we don't have to
// thread their props through every test.
vi.mock('@/app/admin/publishers/PendingApplications', () => ({
  PendingApplications: () => null,
}));
vi.mock('@/app/admin/publishers/PublisherForm', () => ({
  PublisherForm: () => null,
}));

import * as api from '@/lib/adminPublisherApi';
import PublishersPage from '@/app/admin/publishers/page';

function makePublisher(overrides: Partial<PublisherRecord> = {}): PublisherRecord {
  return {
    id: 'pub-1',
    name: 'Pub 1',
    contactEmail: 'a@b',
    sourceUrl: 'https://example.com/feed.json',
    sourceType: 'json',
    trustLevel: 'auto',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const mocked = api as unknown as {
  listPublishers: ReturnType<typeof vi.fn>;
  runPublisherIngest: ReturnType<typeof vi.fn>;
  updatePublisher: ReturnType<typeof vi.fn>;
  deletePublisher: ReturnType<typeof vi.fn>;
  listPendingApplications: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.useFakeTimers();
  mocked.listPublishers.mockReset();
  mocked.runPublisherIngest.mockReset();
  mocked.updatePublisher.mockReset();
  mocked.deletePublisher.mockReset();
  mocked.listPendingApplications.mockReset();
  mocked.listPendingApplications.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

// Wait for the initial fetchPublishers call after the page mounts. Required
// before the toolbar's "Run ingest now" button is clickable because the
// page renders a loading screen until publishers have loaded.
async function waitForInitialLoad(): Promise<void> {
  // The initial fetch is fired by an effect; vi.fake timers don't tick
  // microtasks, so we yield real time via flushPromises() until the toolbar
  // renders.
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Run ingest now' })).toBeTruthy();
  });
}

function getRunButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Run ingest|Running…/ }) as HTMLButtonElement;
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('PublishersPage — Run ingest now polling state machine', () => {
  it('button disables immediately on click (closes the double-fire window)', async () => {
    mocked.listPublishers.mockResolvedValue([makePublisher({ id: 'pub-1' })]);
    // runPublisherIngest hangs forever for this test so we can observe the
    // button state DURING the network call, before the response lands.
    let resolveTrigger: (value: { triggeredAt: string }) => void = () => {};
    mocked.runPublisherIngest.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveTrigger = resolve;
        }),
    );

    render(<PublishersPage />);
    await waitForInitialLoad();

    const btn = getRunButton();
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);

    // After the click, before runPublisherIngest resolves, the button MUST
    // already be disabled — otherwise a fast double-click fires two POSTs.
    await waitFor(() => {
      expect(getRunButton().disabled).toBe(true);
    });
    expect(mocked.runPublisherIngest).toHaveBeenCalledTimes(1);

    // Cleanup: let the trigger resolve so the polling can settle.
    resolveTrigger({ triggeredAt: '2026-05-04T22:00:00.000Z' });
  });

  it('reports success when every snapshotted publisher refreshes past the trigger', async () => {
    const triggeredAt = '2026-05-04T22:00:00.000Z';
    const triggeredAtMs = Date.parse(triggeredAt);
    const fresh: PublisherRecord[] = [
      makePublisher({ id: 'pub-1', lastFetchedAt: new Date(triggeredAtMs + 1000).toISOString() }),
    ];

    // Initial load returns the snapshot publishers; subsequent poll ticks
    // return the post-ingest fresh data.
    mocked.listPublishers
      .mockResolvedValueOnce([makePublisher({ id: 'pub-1' })])
      .mockResolvedValue(fresh);
    mocked.runPublisherIngest.mockResolvedValue({ triggeredAt });

    render(<PublishersPage />);
    await waitForInitialLoad();

    fireEvent.click(getRunButton());

    // First poll tick fires after INGEST_POLL_INTERVAL_MS = 3000 ms.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    await waitFor(() => {
      expect(screen.queryByText(/Ingest finished/)).toBeTruthy();
    });
  });

  it('excludes paused publishers from the completion check (regression: paused → permanent timeout)', async () => {
    const triggeredAt = '2026-05-04T22:00:00.000Z';
    const triggeredAtMs = Date.parse(triggeredAt);
    const initial = [
      makePublisher({ id: 'active', enabled: true }),
      makePublisher({ id: 'paused', enabled: true, paused: true }),
    ];
    const after = [
      makePublisher({
        id: 'active',
        enabled: true,
        // active publisher refreshed past trigger
        lastFetchedAt: new Date(triggeredAtMs + 1000).toISOString(),
      }),
      makePublisher({
        id: 'paused',
        enabled: true,
        paused: true,
        // paused publisher's lastFetchedAt is intentionally OLDER than the
        // trigger — the backend never updates it for paused rows. If the
        // completion check counted paused rows, this test would time out.
        lastFetchedAt: new Date(triggeredAtMs - 1_000_000).toISOString(),
      }),
    ];
    mocked.listPublishers.mockResolvedValueOnce(initial).mockResolvedValue(after);
    mocked.runPublisherIngest.mockResolvedValue({ triggeredAt });

    render(<PublishersPage />);
    await waitForInitialLoad();

    fireEvent.click(getRunButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    await waitFor(() => {
      expect(screen.queryByText(/Ingest finished/)).toBeTruthy();
    });
  });

  it('does NOT count post-trigger publishers (regression: live-list completion check)', async () => {
    const triggeredAt = '2026-05-04T22:00:00.000Z';
    const triggeredAtMs = Date.parse(triggeredAt);
    const initial = [
      makePublisher({ id: 'pub-1', lastFetchedAt: undefined }),
    ];
    const afterWithNewRow = [
      makePublisher({
        id: 'pub-1',
        lastFetchedAt: new Date(triggeredAtMs + 1000).toISOString(),
      }),
      // A row appearing after the trigger — the ingest Lambda never saw
      // this in its snapshot, so its lastFetchedAt is older. If the
      // completion check used the live list, this would force a timeout.
      makePublisher({
        id: 'late-arrival',
        lastFetchedAt: new Date(triggeredAtMs - 1_000_000).toISOString(),
      }),
    ];
    mocked.listPublishers.mockResolvedValueOnce(initial).mockResolvedValue(afterWithNewRow);
    mocked.runPublisherIngest.mockResolvedValue({ triggeredAt });

    render(<PublishersPage />);
    await waitForInitialLoad();

    fireEvent.click(getRunButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    await waitFor(() => {
      expect(screen.queryByText(/Ingest finished/)).toBeTruthy();
    });
  });

  it('uses the latest publishers state when building the trigger snapshot (regression: stale closure)', async () => {
    // If handleRunIngest's useCallback dropped `publishers` from its deps,
    // the captured snapshot would be the mount-time empty list — which
    // means triggerSnapshot is empty and `eligible.length === 0` makes
    // the poll declare success immediately, regardless of the real ingest
    // status. We pin this down with a counter on listPublishers: every
    // poll call returns a list where the publisher's lastFetchedAt is
    // STALE (older than the trigger). With the stale-closure regression
    // the first tick succeeds (empty snapshot ⇒ allRefreshed via the
    // `eligible.length === 0` branch). With the fix in place the snapshot
    // is non-empty, every tick sees stale lastFetchedAt, and we burn all
    // 40 attempts to a timeout.
    const triggeredAt = '2026-05-04T22:00:00.000Z';
    const triggeredAtMs = Date.parse(triggeredAt);
    const stale = [
      makePublisher({
        id: 'pub-1',
        lastFetchedAt: new Date(triggeredAtMs - 1_000_000).toISOString(),
      }),
    ];

    let call = 0;
    mocked.listPublishers.mockImplementation(async () => {
      call++;
      return stale;
    });
    mocked.runPublisherIngest.mockResolvedValue({ triggeredAt });

    render(<PublishersPage />);
    await waitForInitialLoad();

    fireEvent.click(getRunButton());

    // After the first poll tick the page MUST still be running. With the
    // stale closure regression it would already say "Ingest finished".
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.queryByText(/Ingest finished/)).toBeNull();
    expect(screen.queryByText(/Ingest running/)).toBeTruthy();
    // Also a sanity check that the snapshot is actually being polled —
    // call #1 was mount, call #2 is the first poll tick.
    expect(call).toBeGreaterThanOrEqual(2);
  });

  it('shows error state when runPublisherIngest rejects (e.g. local-dev refusal)', async () => {
    mocked.listPublishers.mockResolvedValue([makePublisher({ id: 'pub-1' })]);
    mocked.runPublisherIngest.mockRejectedValue(
      new Error('500: PUBLISHER_INGEST_FUNCTION_NAME is not set'),
    );

    render(<PublishersPage />);
    await waitForInitialLoad();

    fireEvent.click(getRunButton());

    await waitFor(() => {
      expect(screen.queryByText(/PUBLISHER_INGEST_FUNCTION_NAME/)).toBeTruthy();
    });
    // Button is re-enabled after error so the user can retry.
    expect(getRunButton().disabled).toBe(false);
  });
});
