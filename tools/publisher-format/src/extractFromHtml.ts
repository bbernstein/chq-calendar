import * as cheerio from 'cheerio';
import type { FeedDocument, FeedEvent, PublisherInfo, ValidationIssue } from './types';

export interface ExtractOptions {
  registeredPublisherId?: string;
}

export interface ExtractResult {
  feed: FeedDocument | null;
  errors: ValidationIssue[];
}

const COMMENT_PREFIXES = {
  events: 'chq-events',
  event: 'chq-event',
  publisher: 'chq-publisher',
} as const;

interface ParsedComment {
  kind: 'events' | 'event' | 'publisher';
  body: string;
}

function stripPrefix(raw: string): ParsedComment | null {
  const trimmed = raw.trim();
  for (const kind of ['events', 'event', 'publisher'] as const) {
    if (trimmed.startsWith(COMMENT_PREFIXES[kind])) {
      const rest = trimmed.slice(COMMENT_PREFIXES[kind].length).trim();
      if (rest.length === 0 || /^[\s\n{]/.test(rest)) {
        return { kind, body: rest };
      }
    }
  }
  return null;
}

interface CheerioCommentNode {
  type: string;
  data?: string;
  children?: CheerioCommentNode[];
}

export function extractFromHtml(html: string, opts: ExtractOptions = {}): ExtractResult {
  const $ = cheerio.load(html);
  const errors: ValidationIssue[] = [];
  const events: FeedEvent[] = [];
  const eventsBlocks: { publisher: PublisherInfo; events: FeedEvent[] }[] = [];
  let pagePublisher: PublisherInfo | null = null;

  const walk = (node: CheerioCommentNode | undefined) => {
    if (!node) return;
    if (node.type === 'comment') {
      const parsed = stripPrefix(node.data ?? '');
      if (!parsed) return;
      let json: unknown;
      try {
        json = JSON.parse(parsed.body);
      } catch (e) {
        errors.push({ path: '/', message: `Comment "${parsed.kind}" contained invalid JSON: ${(e as Error).message}`, code: 'comment-json-error' });
        return;
      }
      if (parsed.kind === 'publisher') {
        if (pagePublisher) {
          errors.push({ path: '/', message: 'Page contains more than one chq-publisher comment.', code: 'multiple-page-publishers' });
        } else {
          pagePublisher = json as PublisherInfo;
        }
      } else if (parsed.kind === 'event') {
        events.push(json as FeedEvent);
      } else if (parsed.kind === 'events') {
        const obj = json as { publisher?: PublisherInfo; events?: FeedEvent[] };
        if (!obj.publisher || !Array.isArray(obj.events)) {
          errors.push({ path: '/', message: 'chq-events comment must contain { publisher, events: [...] }.', code: 'events-shape' });
          return;
        }
        eventsBlocks.push({ publisher: obj.publisher, events: obj.events });
      }
    }
    if (node.children) for (const child of node.children) walk(child);
  };
  const root = $.root() as unknown as { get(i: number): CheerioCommentNode };
  for (const child of root.get(0).children ?? []) walk(child);

  if (events.length > 0 && pagePublisher == null) {
    errors.push({ path: '/', message: 'Page contains chq-event comments but no chq-publisher comment.', code: 'missing-page-publisher' });
  }

  const allBlockPublisherIds = eventsBlocks.map(b => b.publisher.id);
  if (allBlockPublisherIds.length > 0) {
    const distinct = new Set(allBlockPublisherIds);
    if (distinct.size > 1) {
      errors.push({ path: '/', message: 'Multi-publisher aggregator pages are not supported in v1.0 (chq-events blocks must all use the same publisher.id).', code: 'multi-publisher' });
    }
    if (opts.registeredPublisherId) {
      for (const id of distinct) {
        if (id !== opts.registeredPublisherId) {
          errors.push({ path: '/', message: `chq-events block publisher.id "${id}" does not match registered publisher "${opts.registeredPublisherId}".`, code: 'publisher-id-mismatch' });
        }
      }
    }
  }
  if (pagePublisher && opts.registeredPublisherId && (pagePublisher as PublisherInfo).id !== opts.registeredPublisherId) {
    errors.push({ path: '/', message: `chq-publisher id "${(pagePublisher as PublisherInfo).id}" does not match registered publisher "${opts.registeredPublisherId}".`, code: 'publisher-id-mismatch' });
  }

  if (errors.length > 0) return { feed: null, errors };

  const publisher: PublisherInfo | null = eventsBlocks[0]?.publisher ?? pagePublisher;
  if (publisher == null) {
    return { feed: { formatVersion: '1.0', publisher: { id: '', name: '', contactEmail: '' }, events: [] }, errors: [] };
  }

  const allEvents = [...events, ...eventsBlocks.flatMap(b => b.events)];
  const feed: FeedDocument = { formatVersion: '1.0', publisher, events: allEvents };
  return { feed, errors: [] };
}
