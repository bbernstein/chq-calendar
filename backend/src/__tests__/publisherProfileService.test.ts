// Unit tests for publisherProfileService.updateProfile.
//
// The service is deliberately small but covers a lot of validation surface;
// each branch gets its own focused test. The registry + runFeedTest deps are
// jest.fn() spies — we never hit DDB or fetch.

import {
  updatePublisherProfile,
  ProfileValidationError,
  type FeedTestResult,
} from '../services/publisherProfileService';
import type { PublisherRecord, SourceType } from '../types/publisher';
import type { PublisherRegistryService } from '../services/publisherRegistryService';

function makeDeps(opts: {
  current?: PublisherRecord | null;
  feedTest?: FeedTestResult | Error;
} = {}) {
  const get = jest.fn(async () => opts.current ?? null);
  const updateProfile = jest.fn(async () => undefined);
  const runFeedTest = jest.fn(async () => {
    if (opts.feedTest instanceof Error) throw opts.feedTest;
    return opts.feedTest ?? { ok: true };
  });
  const registry = { get, updateProfile } as unknown as PublisherRegistryService;
  return { registry, runFeedTest, get, updateProfile };
}

const baseRecord: PublisherRecord = {
  id: 'pub-1',
  name: 'Old Name',
  contactEmail: 'a@b.com',
  sourceUrl: 'https://example.com/feed.json',
  sourceType: 'json',
  trustLevel: 'review',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('updatePublisherProfile', () => {
  it('updates name without invoking runFeedTest', async () => {
    const deps = makeDeps();
    await updatePublisherProfile('pub-1', { name: '  Renamed  ' }, deps);
    expect(deps.runFeedTest).not.toHaveBeenCalled();
    expect(deps.updateProfile).toHaveBeenCalledWith('pub-1', { name: 'Renamed' });
  });

  it('updates organization without invoking runFeedTest', async () => {
    const deps = makeDeps();
    await updatePublisherProfile('pub-1', { organization: 'Acme Co' }, deps);
    expect(deps.runFeedTest).not.toHaveBeenCalled();
    expect(deps.updateProfile).toHaveBeenCalledWith('pub-1', { organization: 'Acme Co' });
  });

  it('forwards organization="" to registry.updateProfile when cleared via empty string', async () => {
    const deps = makeDeps();
    await updatePublisherProfile('pub-1', { organization: '' }, deps);
    expect(deps.updateProfile).toHaveBeenCalledWith('pub-1', { organization: '' });
  });

  it('forwards organization="" when cleared via null', async () => {
    const deps = makeDeps();
    await updatePublisherProfile('pub-1', { organization: null }, deps);
    expect(deps.updateProfile).toHaveBeenCalledWith('pub-1', { organization: '' });
  });

  it('throws empty_name when name is empty after trim', async () => {
    const deps = makeDeps();
    await expect(
      updatePublisherProfile('pub-1', { name: '   ' }, deps),
    ).rejects.toMatchObject({ code: 'empty_name' });
    expect(deps.updateProfile).not.toHaveBeenCalled();
  });

  it('throws unknown_field when patch contains a non-editable field', async () => {
    const deps = makeDeps();
    await expect(
      updatePublisherProfile('pub-1', { trustLevel: 'auto' }, deps),
    ).rejects.toMatchObject({ code: 'unknown_field' });
    expect(deps.updateProfile).not.toHaveBeenCalled();
  });

  it('throws field_too_long when name exceeds 200 chars', async () => {
    const deps = makeDeps();
    await expect(
      updatePublisherProfile('pub-1', { name: 'a'.repeat(201) }, deps),
    ).rejects.toMatchObject({ code: 'field_too_long' });
  });

  it('throws field_too_long when organization exceeds 200 chars', async () => {
    const deps = makeDeps();
    await expect(
      updatePublisherProfile('pub-1', { organization: 'b'.repeat(201) }, deps),
    ).rejects.toMatchObject({ code: 'field_too_long' });
  });

  it('throws bad_url when sourceUrl is not https', async () => {
    const deps = makeDeps({ current: baseRecord });
    await expect(
      updatePublisherProfile('pub-1', { sourceUrl: 'http://insecure.example/feed' }, deps),
    ).rejects.toMatchObject({ code: 'bad_url' });
    expect(deps.runFeedTest).not.toHaveBeenCalled();
    expect(deps.updateProfile).not.toHaveBeenCalled();
  });

  it('throws bad_source_type for an unknown sourceType value', async () => {
    const deps = makeDeps({ current: baseRecord });
    await expect(
      updatePublisherProfile('pub-1', { sourceType: 'rss' as unknown as SourceType }, deps),
    ).rejects.toMatchObject({ code: 'bad_source_type' });
    expect(deps.runFeedTest).not.toHaveBeenCalled();
  });

  it('throws empty_patch when nothing editable was supplied', async () => {
    const deps = makeDeps();
    await expect(
      updatePublisherProfile('pub-1', {}, deps),
    ).rejects.toMatchObject({ code: 'empty_patch' });
    expect(deps.updateProfile).not.toHaveBeenCalled();
  });

  it('runs feed test with new URL + current sourceType when URL changes alone', async () => {
    const deps = makeDeps({ current: baseRecord });
    await updatePublisherProfile(
      'pub-1',
      { sourceUrl: 'https://other.example/feed.json' },
      deps,
    );
    expect(deps.runFeedTest).toHaveBeenCalledWith({
      url: 'https://other.example/feed.json',
      sourceType: 'json',
    });
    expect(deps.updateProfile).toHaveBeenCalledWith('pub-1', {
      sourceUrl: 'https://other.example/feed.json',
    });
  });

  it('runs feed test with current URL + new sourceType when sourceType changes alone', async () => {
    const deps = makeDeps({ current: baseRecord });
    await updatePublisherProfile('pub-1', { sourceType: 'html' }, deps);
    expect(deps.runFeedTest).toHaveBeenCalledWith({
      url: 'https://example.com/feed.json',
      sourceType: 'html',
    });
    expect(deps.updateProfile).toHaveBeenCalledWith('pub-1', { sourceType: 'html' });
  });

  it('runs feed test with both new URL and sourceType when both change', async () => {
    const deps = makeDeps({ current: baseRecord });
    await updatePublisherProfile(
      'pub-1',
      { sourceUrl: 'https://other.example/page', sourceType: 'html' },
      deps,
    );
    expect(deps.runFeedTest).toHaveBeenCalledWith({
      url: 'https://other.example/page',
      sourceType: 'html',
    });
  });

  it('throws feed_test_failed and skips updateProfile when feed test fails', async () => {
    const deps = makeDeps({
      current: baseRecord,
      feedTest: { ok: false, errors: ['publisher.id mismatch'] },
    });
    await expect(
      updatePublisherProfile(
        'pub-1',
        { sourceUrl: 'https://other.example/feed.json' },
        deps,
      ),
    ).rejects.toMatchObject({
      code: 'feed_test_failed',
      details: ['publisher.id mismatch'],
    });
    expect(deps.updateProfile).not.toHaveBeenCalled();
  });

  it('throws not_found when publisher row is missing during URL change', async () => {
    const deps = makeDeps({ current: null });
    await expect(
      updatePublisherProfile(
        'pub-1',
        { sourceUrl: 'https://other.example/feed.json' },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(deps.runFeedTest).not.toHaveBeenCalled();
  });

  it('does not call registry.get for pure name/org edits', async () => {
    const deps = makeDeps();
    await updatePublisherProfile('pub-1', { name: 'X', organization: 'Y' }, deps);
    expect(deps.get).not.toHaveBeenCalled();
  });

  it('passes name + sourceUrl together: feed test runs once, updateProfile called with both', async () => {
    const deps = makeDeps({ current: baseRecord });
    await updatePublisherProfile(
      'pub-1',
      { name: 'New', sourceUrl: 'https://other.example/feed.json' },
      deps,
    );
    expect(deps.runFeedTest).toHaveBeenCalledTimes(1);
    expect(deps.updateProfile).toHaveBeenCalledWith('pub-1', {
      name: 'New',
      sourceUrl: 'https://other.example/feed.json',
    });
  });
});
