// Mock the secret cache so tests don't hit Secrets Manager.
jest.mock('../services/publisherSecretCache', () => ({
  getPublisherJwtSecret: jest.fn(async () => 'test-secret-do-not-use-in-prod'),
  _resetPublisherSecretCacheForTests: jest.fn(),
}));

import jwt from 'jsonwebtoken';
import { signPublisherJwt, verifyPublisherJwt } from '../services/publisherAuthService';

describe('publisherAuthService', () => {
  it('signPublisherJwt produces a verifiable token with role=publisher', async () => {
    const token = await signPublisherJwt({ publisherId: 'pub-1', email: 'A@B.com' });
    const decoded = jwt.verify(token, 'test-secret-do-not-use-in-prod') as any;
    expect(decoded.sub).toBe('pub-1');
    expect(decoded.role).toBe('publisher');
    expect(decoded.email).toBe('a@b.com'); // normalized
    expect(typeof decoded.exp).toBe('number');
    expect(typeof decoded.iat).toBe('number');
  });

  it('default expiry is 7 days', async () => {
    const token = await signPublisherJwt({ publisherId: 'p', email: 'a@b' });
    const decoded = jwt.verify(token, 'test-secret-do-not-use-in-prod') as any;
    const sevenDaysSec = 7 * 24 * 60 * 60;
    expect(decoded.exp - decoded.iat).toBe(sevenDaysSec);
  });

  it('verifyPublisherJwt returns claims for a valid token', async () => {
    const token = await signPublisherJwt({ publisherId: 'pub-1', email: 'a@b.com' });
    const claims = await verifyPublisherJwt(token);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe('pub-1');
    expect(claims!.role).toBe('publisher');
    expect(claims!.email).toBe('a@b.com');
  });

  it('verifyPublisherJwt returns null for an expired token', async () => {
    const token = await signPublisherJwt({ publisherId: 'p', email: 'a@b' }, '-1s');
    const claims = await verifyPublisherJwt(token);
    expect(claims).toBeNull();
  });

  it('verifyPublisherJwt returns null for a token signed with a different secret', async () => {
    const token = jwt.sign(
      { sub: 'p', role: 'publisher', email: 'a@b' },
      'wrong-secret',
      { expiresIn: '1d' },
    );
    const claims = await verifyPublisherJwt(token);
    expect(claims).toBeNull();
  });

  it('verifyPublisherJwt returns null for a token whose role is not publisher', async () => {
    const token = jwt.sign(
      { sub: 'p', role: 'admin', email: 'a@b' },
      'test-secret-do-not-use-in-prod',
      { expiresIn: '1d' },
    );
    const claims = await verifyPublisherJwt(token);
    expect(claims).toBeNull();
  });

  it('verifyPublisherJwt returns null for empty / non-string input', async () => {
    expect(await verifyPublisherJwt('')).toBeNull();
    expect(await verifyPublisherJwt(undefined as any)).toBeNull();
    expect(await verifyPublisherJwt(null as any)).toBeNull();
  });
});
