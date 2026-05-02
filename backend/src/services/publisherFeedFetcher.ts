import { extractFromHtml, validateFeed } from '@chq-calendar/publisher-format';
import type { FeedDocument, ValidationReport } from '@chq-calendar/publisher-format';
import type { FetchStatus, SourceType } from '../types/publisher';

export interface FetchFeedInput {
  url: string;
  sourceType: SourceType;
  registeredPublisherId: string;
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
    return {
      fetchStatus: 'network_error',
      feed: null,
      report: {
        ok: false,
        errors: [{ path: '/', message: (e as Error).message }],
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
    if (ex.feed.publisher.id !== input.registeredPublisherId) {
      return {
        fetchStatus: 'validation_error',
        feed: null,
        report: {
          ok: false,
          errors: [{ path: '/publisher/id', message: 'mismatch' }],
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
  if (report.feed.publisher.id !== input.registeredPublisherId) {
    return {
      fetchStatus: 'validation_error',
      feed: null,
      report: {
        ok: false,
        errors: [{ path: '/publisher/id', message: 'mismatch' }],
        warnings: [],
      },
    };
  }
  return { fetchStatus: 'ok', feed: report.feed, report };
}
