// Mock the secret cache so JWT signing/verification doesn't hit Secrets Manager.
jest.mock('../services/publisherSecretCache', () => ({
  getPublisherJwtSecret: jest.fn(async () => 'test-secret-do-not-use-in-prod'),
  _resetPublisherSecretCacheForTests: jest.fn(),
}));

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { requirePublisherSession } from '../services/publisherSession';
import { signPublisherJwt } from '../services/publisherAuthService';
import type { PublisherRegistryService } from '../services/publisherRegistryService';
import type { PublisherRecord } from '../types/publisher';

const fakeRegistry = (overrides: { tokenVersion?: number; row?: PublisherRecord | null }): PublisherRegistryService =>
  ({
    get: async () =>
      overrides.row !== undefined
        ? overrides.row
        : ({ id: 'pub-x', tokenVersion: overrides.tokenVersion ?? 0 } as unknown as PublisherRecord),
  }) as unknown as PublisherRegistryService;

const evt = (token: string | null): APIGatewayProxyEvent =>
  ({ headers: token ? { Authorization: `Bearer ${token}` } : {} }) as unknown as APIGatewayProxyEvent;

describe('requirePublisherSession', () => {
  it('returns 401 when no token is present', async () => {
    const r = await requirePublisherSession(evt(null), fakeRegistry({}));
    expect(r.kind).toBe('unauthorized');
  });

  it('returns 401 when the token is malformed', async () => {
    const r = await requirePublisherSession(evt('not-a-jwt'), fakeRegistry({}));
    expect(r.kind).toBe('unauthorized');
  });

  it('returns 401 when tokenVersion mismatches the registry row', async () => {
    const tok = await signPublisherJwt({ publisherId: 'pub-x', email: 'a@b.com', tokenVersion: 1 });
    const r = await requirePublisherSession(evt(tok), fakeRegistry({ tokenVersion: 2 }));
    expect(r.kind).toBe('unauthorized');
  });

  it('returns "publisher_missing" when the row no longer exists', async () => {
    const tok = await signPublisherJwt({ publisherId: 'pub-x', email: 'a@b.com', tokenVersion: 0 });
    const r = await requirePublisherSession(evt(tok), fakeRegistry({ row: null }));
    expect(r.kind).toBe('publisher_missing');
  });

  it('returns ok with claims and publisher row on success', async () => {
    const row: PublisherRecord = {
      id: 'pub-x',
      name: 'P',
      contactEmail: 'a@b.com',
      sourceUrl: 'https://example.com/feed.json',
      sourceType: 'json',
      trustLevel: 'auto',
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      tokenVersion: 3,
      applicationStatus: 'approved',
    };
    const tok = await signPublisherJwt({ publisherId: 'pub-x', email: 'a@b.com', tokenVersion: 3 });
    const r = await requirePublisherSession(evt(tok), fakeRegistry({ row }));
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.claims.sub).toBe('pub-x');
      expect(r.publisher).toEqual(row);
    }
  });

  it('treats a missing tokenVersion on the publisher row as 0 (legacy rows)', async () => {
    const row = {
      id: 'pub-legacy',
      name: 'Legacy',
      contactEmail: 'l@x.com',
      sourceUrl: 'https://example.com/feed.json',
      sourceType: 'json',
      trustLevel: 'auto',
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      // no tokenVersion field
    } as unknown as PublisherRecord;
    const tok = await signPublisherJwt({ publisherId: 'pub-legacy', email: 'l@x.com' /* defaults to 0 */ });
    const r = await requirePublisherSession(evt(tok), fakeRegistry({ row }));
    expect(r.kind).toBe('ok');
  });

  it('accepts the lowercase "authorization" header form', async () => {
    const tok = await signPublisherJwt({ publisherId: 'pub-x', email: 'a@b.com', tokenVersion: 0 });
    const event = ({ headers: { authorization: `Bearer ${tok}` } }) as unknown as APIGatewayProxyEvent;
    const row = { id: 'pub-x', tokenVersion: 0 } as unknown as PublisherRecord;
    const r = await requirePublisherSession(event, fakeRegistry({ row }));
    expect(r.kind).toBe('ok');
  });
});
