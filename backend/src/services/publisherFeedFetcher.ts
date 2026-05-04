import { extractFromHtml, validateFeed } from '@chq-calendar/publisher-format';
import type { FeedDocument, ValidationReport } from '@chq-calendar/publisher-format';
import type { FetchStatus, SourceType } from '../types/publisher';

export interface FetchFeedInput {
  url: string;
  sourceType: SourceType;
  registeredPublisherId: string;
  /**
   * When true, skip the `feed.publisher.id === registeredPublisherId` check.
   * Used by the public publisher-test endpoint, where prospective publishers
   * iterate on their feed before they have an assigned id. Production ingest
   * MUST leave this false (the default).
   */
  skipPublisherIdCheck?: boolean;
}

export interface FetchFeedOutput {
  fetchStatus: FetchStatus;
  feed: FeedDocument | null;
  report: ValidationReport;
}

type FetchFn = typeof fetch;

const FETCH_TIMEOUT_MS = 30_000;

export async function fetchAndParseFeed(
  input: FetchFeedInput,
  fetchFn: FetchFn = fetch,
): Promise<FetchFeedOutput> {
  let res: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    res = await fetchFn(input.url, {
      method: 'GET',
      headers: {
        Accept: input.sourceType === 'json' ? 'application/json' : 'text/html',
      },
      signal: controller.signal,
    });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    // Timeout has its own deterministic message — the AbortError wrapping is
    // an implementation detail. Return early so we don't append the
    // DOMException cause that some Node versions attach to the abort.
    if (err.name === 'AbortError') {
      return {
        fetchStatus: 'network_error',
        feed: null,
        report: {
          ok: false,
          errors: [{ path: '/', message: `timed out after ${FETCH_TIMEOUT_MS}ms` }],
          warnings: [],
        },
      };
    }
    // Node's fetch surfaces real network failures (ENOTFOUND, ECONNREFUSED,
    // certificate errors) only on err.cause — the top-level message is just
    // "fetch failed". Prefer cause.message (it usually already includes the
    // code, e.g. "getaddrinfo ENOTFOUND host"), and fall back to the bare
    // code only if message is absent — joining both duplicates the code.
    const causeStr = err.cause ? (err.cause.message || err.cause.code || '') : '';
    const baseMsg = err.message ?? String(e);
    const message = causeStr ? `${baseMsg} (${causeStr})` : baseMsg;
    return {
      fetchStatus: 'network_error',
      feed: null,
      report: {
        ok: false,
        errors: [{ path: '/', message }],
        warnings: [],
      },
    };
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    return {
      fetchStatus: 'network_error',
      feed: null,
      report: {
        ok: false,
        errors: [{ path: '/', message: `HTTP ${res.status}` }],
        warnings: [],
      },
    };
  }
  const body = await res.text();

  if (input.sourceType === 'html') {
    const ex = extractFromHtml(body);
    if (ex.errors.length > 0 || !ex.feed) {
      return {
        fetchStatus: 'parse_error',
        feed: null,
        report: { ok: false, errors: ex.errors, warnings: [] },
      };
    }
    if (!input.skipPublisherIdCheck && ex.feed.publisher.id !== input.registeredPublisherId) {
      return {
        fetchStatus: 'validation_error',
        feed: null,
        report: {
          ok: false,
          errors: [{
            path: '/publisher/id',
            message: `feed publisher.id "${ex.feed.publisher.id}" does not match registered publisher "${input.registeredPublisherId}"`,
          }],
          warnings: [],
        },
      };
    }
    const report = validateFeed(ex.feed);
    return {
      fetchStatus: report.ok ? 'ok' : 'validation_error',
      feed: report.ok ? ex.feed : null,
      report,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    return {
      fetchStatus: 'parse_error',
      feed: null,
      report: {
        ok: false,
        errors: [{ path: '/', message: (e as Error).message }],
        warnings: [],
      },
    };
  }
  const report = validateFeed(parsed);
  if (!report.ok || !report.feed) {
    return { fetchStatus: 'validation_error', feed: null, report };
  }
  if (!input.skipPublisherIdCheck && report.feed.publisher.id !== input.registeredPublisherId) {
    return {
      fetchStatus: 'validation_error',
      feed: null,
      report: {
        ok: false,
        errors: [{
          path: '/publisher/id',
          message: `feed publisher.id "${report.feed.publisher.id}" does not match registered publisher "${input.registeredPublisherId}"`,
        }],
        warnings: [],
      },
    };
  }
  return { fetchStatus: 'ok', feed: report.feed, report };
}
