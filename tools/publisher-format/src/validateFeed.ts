import Ajv, { type ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import sanitizeHtml from 'sanitize-html';
import { FEED_JSON_SCHEMA } from './schema';
import type { FeedDocument, ValidationIssue, ValidationReport } from './types';
import { loadReferences, type References } from './references';

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li'];
const ALLOWED_ATTRS = { a: ['href'] };

export interface ValidateOptions {
  references?: References;
}

export function validateFeed(input: unknown, opts: ValidateOptions = {}): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(FEED_JSON_SCHEMA);
  const ok = validate(input);
  if (!ok) {
    for (const e of (validate.errors ?? []) as ErrorObject[]) {
      errors.push({
        path: e.instancePath || '/',
        message: `${e.message ?? 'invalid'}`,
        code: e.keyword,
      });
    }
    return { ok: false, errors, warnings };
  }

  const feed = input as unknown as FeedDocument;
  const refs = opts.references ?? loadReferences();

  feed.events.forEach((ev, i) => {
    const base = `/events/${i}`;

    if (!refs.categoryNames.has(ev.category)) {
      errors.push({
        path: `${base}/category`,
        message: `Unknown category "${ev.category}". See docs/publisher/categories.json.`,
        code: 'unknown-category',
      });
    }

    const hasVenueId = typeof ev.venueId === 'string' && ev.venueId.length > 0;
    const hasVenue = ev.venue != null;
    if (hasVenueId && hasVenue) {
      errors.push({ path: base, message: 'Use either venueId or venue, not both.', code: 'venue-both' });
    } else if (!hasVenueId && !hasVenue) {
      errors.push({ path: base, message: 'Each event must have either venueId or venue.', code: 'venue-missing' });
    } else if (hasVenueId && !refs.venueIds.has(ev.venueId!)) {
      errors.push({
        path: `${base}/venueId`,
        message: `Unknown venueId "${ev.venueId}". See docs/publisher/venues.json.`,
        code: 'unknown-venue',
      });
    }

    if (Date.parse(ev.endDate) < Date.parse(ev.startDate)) {
      errors.push({ path: `${base}/endDate`, message: 'endDate is before startDate.', code: 'end-before-start' });
    }

    if (ev.description) {
      const cleaned = sanitizeHtml(ev.description, {
        allowedTags: ALLOWED_TAGS,
        allowedAttributes: ALLOWED_ATTRS,
      });
      if (cleaned !== ev.description) {
        warnings.push({
          path: `${base}/description`,
          message: 'Description contains tags/attributes that will be stripped at ingest.',
          code: 'description-sanitized',
        });
      }
    }
  });

  return { ok: errors.length === 0, feed, errors, warnings };
}
