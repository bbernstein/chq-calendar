import { fetchAndParseFeed, type FetchFeedOutput } from './publisherFeedFetcher';
import { validateUrlIsPublic } from './urlGuard';
import type { SourceType } from '../types/publisher';

export interface PublisherTestInput {
  url: string;
  sourceType: SourceType;
  /**
   * Optional registered publisher id. When supplied, the feed's
   * `publisher.id` must match — same check the production ingest pipeline
   * applies. When omitted, the publisher.id check is skipped entirely so a
   * prospective publisher can iterate on their feed before being registered.
   *
   * We chose to add a `skipPublisherIdCheck` flag to fetchAndParseFeed
   * (rather than wrap/post-process) because it's the single least-invasive
   * change that preserves the full parsed feed on success. Production
   * ingest never sets the flag, so its behaviour is unchanged.
   */
  publisherId?: string;
}

export type PublisherTestError = { kind: 'blocked_url'; reason: string };

export type PublisherTestResult =
  | { kind: 'ok'; output: FetchFeedOutput }
  | { kind: 'error'; error: PublisherTestError };

// Sentinel passed as `registeredPublisherId` when the caller supplied no id.
// With `skipPublisherIdCheck: true` this value is never compared against the
// feed; it's here purely to satisfy the required field in `FetchFeedInput`.
export const TEST_PUBLISHER_ID_SENTINEL = '__chqcal_test_unregistered__';

/**
 * Validate the URL, then fetch + parse + validate the feed.
 *
 * Returns either:
 *   - `{ kind: 'ok', output }` — `output` is the FetchFeedOutput from
 *     fetchAndParseFeed (which itself may carry a non-ok report; parse and
 *     validation failures are part of the success payload, not transport
 *     errors).
 *   - `{ kind: 'error', error }` — caller-side errors (currently just
 *     URL-guard rejections). Translate these to HTTP 400 at the handler.
 */
export async function testPublisherFeed(
  input: PublisherTestInput,
  fetchFn: typeof fetch = fetch,
): Promise<PublisherTestResult> {
  const guard = validateUrlIsPublic(input.url);
  if (guard.ok === false) {
    return { kind: 'error', error: { kind: 'blocked_url', reason: guard.reason } };
  }

  const output = await fetchAndParseFeed(
    {
      url: input.url,
      sourceType: input.sourceType,
      registeredPublisherId: input.publisherId ?? TEST_PUBLISHER_ID_SENTINEL,
      skipPublisherIdCheck: !input.publisherId,
    },
    fetchFn,
  );

  return { kind: 'ok', output };
}
