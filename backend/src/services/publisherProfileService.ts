// Phase 2 (publisher portal self-service) — server-side profile editor.
//
// `updatePublisherProfile` is the single entry point: it normalises +
// validates the patch, gates URL/sourceType changes behind a feed test, and
// only then calls registry.updateProfile. The handler layer wires it to the
// real registry + feed-test pieces.
//
// Validation here is intentionally strict (whitelist of editable fields,
// trim+length limits, https-only URLs). Business rules that depend on the
// registry row itself (e.g. "URL changed → must pass feed test") are
// expressed as effects on `deps`, not inline.

import { PublisherNotFoundError, type PublisherRegistryService } from './publisherRegistryService';
import type { SourceType } from '../types/publisher';

export class ProfileValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ProfileValidationError';
  }
}

export interface ProfilePatch {
  name?: string;
  organization?: string;
  sourceUrl?: string;
  sourceType?: SourceType;
  notificationsEnabled?: boolean;
}

const ALLOWED_FIELDS = new Set<keyof ProfilePatch>([
  'name',
  'organization',
  'sourceUrl',
  'sourceType',
  'notificationsEnabled',
]);
// SourceType is 'json' | 'html' in this codebase (see types/publisher.ts);
// the values that match the existing /publisher-test endpoint.
const ALLOWED_SOURCE_TYPES = new Set<SourceType>(['json', 'html']);

export interface FeedTestResult {
  ok: boolean;
  errors?: string[];
  summary?: string;
}

export interface UpdateDeps {
  registry: PublisherRegistryService;
  // Same checks as POST /publisher-test: URL guard + fetch + parse + validate.
  // Accepts a {url, sourceType} pair (already merged with current values when
  // only one of the two is being patched) and returns a normalised ok/errors
  // result. The handler layer is responsible for adapting the existing
  // testPublisherFeed return shape to this contract.
  runFeedTest: (input: { url: string; sourceType: SourceType }) => Promise<FeedTestResult>;
}

export async function updatePublisherProfile(
  publisherId: string,
  rawPatch: Record<string, unknown>,
  deps: UpdateDeps,
): Promise<void> {
  // Reject any field outside the editable whitelist BEFORE doing other work —
  // we want a clear "you can't edit X" error rather than silently dropping it.
  for (const k of Object.keys(rawPatch)) {
    if (!ALLOWED_FIELDS.has(k as keyof ProfilePatch)) {
      throw new ProfileValidationError('unknown_field', `Field "${k}" is not editable.`);
    }
  }

  const patch: ProfilePatch = {};

  if ('name' in rawPatch) {
    const v = String(rawPatch.name ?? '').trim();
    if (v.length === 0) {
      throw new ProfileValidationError('empty_name', 'Name cannot be empty.');
    }
    if (v.length > 200) {
      throw new ProfileValidationError('field_too_long', 'Name cannot exceed 200 characters.');
    }
    patch.name = v;
  }

  if ('organization' in rawPatch) {
    const raw = rawPatch.organization;
    if (raw === null || raw === undefined || raw === '') {
      // Empty/null organization means "clear" — the registry helper accepts
      // '' as a clear signal for fields in CLEARABLE_PROFILE_FIELDS, and
      // organization is the only such field today.
      patch.organization = '';
    } else {
      const v = String(raw).trim();
      if (v.length > 200) {
        throw new ProfileValidationError(
          'field_too_long',
          'Organization cannot exceed 200 characters.',
        );
      }
      // If the user supplied whitespace-only, treat as clear (consistent with
      // the trim semantics of name).
      patch.organization = v;
    }
  }

  if ('sourceUrl' in rawPatch) {
    const v = String(rawPatch.sourceUrl ?? '').trim();
    if (!/^https:\/\//.test(v)) {
      throw new ProfileValidationError('bad_url', 'Source URL must be https.');
    }
    if (v.length > 2000) {
      throw new ProfileValidationError('field_too_long', 'Source URL is too long.');
    }
    patch.sourceUrl = v;
  }

  if ('sourceType' in rawPatch) {
    const v = String(rawPatch.sourceType ?? '');
    if (!ALLOWED_SOURCE_TYPES.has(v as SourceType)) {
      throw new ProfileValidationError(
        'bad_source_type',
        'Source type must be "json" or "html".',
      );
    }
    patch.sourceType = v as SourceType;
  }

  if ('notificationsEnabled' in rawPatch) {
    const v = rawPatch.notificationsEnabled;
    if (typeof v !== 'boolean') {
      throw new ProfileValidationError(
        'invalid_notifications_enabled',
        '"notificationsEnabled" must be a boolean.',
      );
    }
    patch.notificationsEnabled = v;
  }

  if (Object.keys(patch).length === 0) {
    throw new ProfileValidationError('empty_patch', 'No editable fields supplied.');
  }

  // Gate URL/sourceType changes on a successful feed test. Read the current
  // row so we can run the test with whichever side wasn't supplied. We only
  // hit the registry when we actually need it — pure name/org edits skip
  // this entirely.
  if ('sourceUrl' in patch || 'sourceType' in patch) {
    const current = await deps.registry.get(publisherId);
    if (!current) {
      throw new ProfileValidationError('not_found', 'Publisher not found.');
    }
    const effectiveUrl = patch.sourceUrl ?? current.sourceUrl;
    const effectiveType = patch.sourceType ?? current.sourceType;
    const result = await deps.runFeedTest({ url: effectiveUrl, sourceType: effectiveType });
    if (!result.ok) {
      throw new ProfileValidationError(
        'feed_test_failed',
        'Proposed feed did not pass validation.',
        result.errors ?? [],
      );
    }
  }

  // The registry helper guards with attribute_exists(id) so a row deleted
  // between the validation read and this write doesn't get resurrected as a
  // partial fragment. Translate to the local typed error so the handler can
  // map it to a 404 the same way the rest of the validation surface does.
  try {
    await deps.registry.updateProfile(publisherId, patch);
  } catch (err) {
    if (err instanceof PublisherNotFoundError) {
      throw new ProfileValidationError('not_found', 'Publisher not found.');
    }
    throw err;
  }
}
