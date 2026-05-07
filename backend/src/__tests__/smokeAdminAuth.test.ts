// Tests for the smoke-bot admin verifier. The verifier is what lets the
// post-deploy publisher-lifecycle smoke test authenticate against admin
// routes without going through Google OAuth — see services/smokeAdminAuth.ts
// for the security model.

import jwt from 'jsonwebtoken';
import { verifySmokeAdminToken } from '../services/smokeAdminAuth';

const ORIGINAL_ENV = { ...process.env };
const KEY = 'super-secret-test-key';

function sign(payload: Record<string, unknown>, opts: jwt.SignOptions = {}): string {
  return jwt.sign(payload, KEY, { algorithm: 'HS256', ...opts });
}

describe('verifySmokeAdminToken', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.ADMIN_SMOKE_SIGNING_KEY = KEY;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns the smoke principal on a valid bearer token', () => {
    const token = sign({ sub: 'smoke-bot', iss: 'smoke' }, { expiresIn: '5m' });
    const r = verifySmokeAdminToken(`Bearer ${token}`);
    expect(r).toEqual({ sub: 'smoke-bot', iss: 'smoke' });
  });

  it('accepts a bare token without "Bearer " prefix (X-Auth-Token style)', () => {
    // adminHandler forwards the bare token from X-Auth-Token. The verifier
    // must accept both shapes so a single helper works on either header.
    const token = sign({ sub: 'smoke-bot', iss: 'smoke' }, { expiresIn: '5m' });
    const r = verifySmokeAdminToken(token);
    expect(r).toEqual({ sub: 'smoke-bot', iss: 'smoke' });
  });

  it('returns null when ADMIN_SMOKE_SIGNING_KEY is unset (smoke not provisioned)', () => {
    // Without the env var, the bypass path is permanently inactive — even a
    // structurally-valid token signed with the actual key cannot be
    // accepted, because there's no key to verify against. This matters in
    // local dev / staging where smoke isn't wired up.
    delete process.env.ADMIN_SMOKE_SIGNING_KEY;
    const token = sign({ sub: 'smoke-bot', iss: 'smoke' }, { expiresIn: '5m' });
    expect(verifySmokeAdminToken(`Bearer ${token}`)).toBeNull();
  });

  it('returns null on missing header', () => {
    expect(verifySmokeAdminToken(undefined)).toBeNull();
  });

  it('returns null on empty header', () => {
    expect(verifySmokeAdminToken('')).toBeNull();
    expect(verifySmokeAdminToken('Bearer ')).toBeNull();
  });

  it('returns null on a token signed with the wrong key', () => {
    const token = jwt.sign({ sub: 'smoke-bot', iss: 'smoke' }, 'attacker-key', {
      algorithm: 'HS256',
      expiresIn: '5m',
    });
    expect(verifySmokeAdminToken(`Bearer ${token}`)).toBeNull();
  });

  it('returns null on an expired token', () => {
    // jsonwebtoken auto-rejects expired tokens during verify(); a negative
    // expiresIn is the easiest way to mint one without faking the clock.
    const token = sign({ sub: 'smoke-bot', iss: 'smoke' }, { expiresIn: -10 });
    expect(verifySmokeAdminToken(`Bearer ${token}`)).toBeNull();
  });

  it('returns null when sub is not "smoke-bot"', () => {
    // Even a valid signature must be rejected if the principal isn't the
    // smoke bot — defends against an attacker reusing the smoke key
    // signing path to forge another identity.
    const token = sign({ sub: 'someone-else', iss: 'smoke' }, { expiresIn: '5m' });
    expect(verifySmokeAdminToken(`Bearer ${token}`)).toBeNull();
  });

  it('returns null when iss is not "smoke"', () => {
    const token = sign({ sub: 'smoke-bot', iss: 'production' }, { expiresIn: '5m' });
    expect(verifySmokeAdminToken(`Bearer ${token}`)).toBeNull();
  });

  it('returns null on a non-HS256 algorithm', () => {
    // The verifier pins algorithms: ['HS256']. A token presenting itself
    // as HS512 (or any other alg) must be rejected — otherwise an
    // attacker could fork the verification to a key-confusion path.
    const token = jwt.sign({ sub: 'smoke-bot', iss: 'smoke' }, KEY, {
      algorithm: 'HS512',
      expiresIn: '5m',
    });
    expect(verifySmokeAdminToken(`Bearer ${token}`)).toBeNull();
  });

  it('returns null on a malformed token string', () => {
    expect(verifySmokeAdminToken('Bearer not-a-jwt')).toBeNull();
  });
});
