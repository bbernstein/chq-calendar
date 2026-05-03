jest.unmock('@aws-sdk/lib-dynamodb');

import { MagicTokenService, type MagicTokenRow } from '../services/magicTokenService';

const mockSend = jest.fn();
const mockClient: any = { send: mockSend };

const FIXED_NOW_MS = new Date('2026-05-03T12:00:00Z').getTime();
const fixedNow = () => new Date(FIXED_NOW_MS);

describe('MagicTokenService', () => {
  let svc: MagicTokenService;

  beforeEach(() => {
    jest.resetAllMocks();
    svc = new MagicTokenService(mockClient, 'magic-tokens', fixedNow);
  });

  describe('issueToken', () => {
    it('persists a hashed token row with default 15-min TTL and lowercased email', async () => {
      mockSend.mockResolvedValue({});
      const out = await svc.issueToken({
        purpose: 'apply',
        email: 'Foo@BAR.com',
        applyPayload: {
          name: 'Foo',
          email: 'Foo@BAR.com',
          sourceUrl: 'https://example.com/feed.json',
          sourceType: 'json',
        },
      });

      // Raw token: base64url, ~43 chars (32 bytes encoded).
      expect(out.rawToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(out.expiresAt).toBe(Math.floor(FIXED_NOW_MS / 1000) + 15 * 60);

      const cmd: any = mockSend.mock.calls[0][0];
      const item: MagicTokenRow = cmd.input.Item;
      expect(item.tokenHash).toBe(MagicTokenService.hashToken(out.rawToken));
      expect(item.email).toBe('foo@bar.com');
      expect(item.purpose).toBe('apply');
      expect(item.applyPayload?.name).toBe('Foo');
      expect(item.expiresAt).toBe(out.expiresAt);
      // The raw token must NEVER be persisted.
      expect(JSON.stringify(item)).not.toContain(out.rawToken);
    });

    it('honors custom ttlSeconds', async () => {
      mockSend.mockResolvedValue({});
      const out = await svc.issueToken({
        purpose: 'login',
        email: 'a@b.com',
        publisherId: 'pub-1',
        ttlSeconds: 60,
      });
      expect(out.expiresAt).toBe(Math.floor(FIXED_NOW_MS / 1000) + 60);
      const cmd: any = mockSend.mock.calls[0][0];
      expect(cmd.input.Item.publisherId).toBe('pub-1');
    });

    it('issues distinct tokens across calls', async () => {
      mockSend.mockResolvedValue({});
      const a = await svc.issueToken({ purpose: 'login', email: 'a@b.com' });
      const b = await svc.issueToken({ purpose: 'login', email: 'a@b.com' });
      expect(a.rawToken).not.toBe(b.rawToken);
    });
  });

  describe('consumeToken', () => {
    it('returns not_found for an unknown token', async () => {
      mockSend.mockResolvedValue({});
      const r = await svc.consumeToken('nonexistent', 'apply');
      expect(r).toEqual({ ok: false, reason: 'not_found' });
    });

    it('returns not_found for empty input without hitting DynamoDB', async () => {
      const r = await svc.consumeToken('', 'apply');
      expect(r).toEqual({ ok: false, reason: 'not_found' });
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns expired and best-effort deletes the row', async () => {
      const past = Math.floor(FIXED_NOW_MS / 1000) - 1;
      mockSend
        .mockResolvedValueOnce({
          Item: { tokenHash: 'h', purpose: 'apply', email: 'a@b', expiresAt: past, createdAt: 'x' },
        })
        .mockResolvedValueOnce({}); // delete

      const r = await svc.consumeToken('rawtoken', 'apply');
      expect(r).toEqual({ ok: false, reason: 'expired' });

      // Allow the fire-and-forget delete to flush.
      await new Promise(setImmediate);
      const second = mockSend.mock.calls[1]?.[0];
      expect(second?.constructor.name).toBe('DeleteCommand');
    });

    it('returns wrong_purpose without deleting the row', async () => {
      const future = Math.floor(FIXED_NOW_MS / 1000) + 60;
      mockSend.mockResolvedValueOnce({
        Item: { tokenHash: 'h', purpose: 'login', email: 'a@b', expiresAt: future, createdAt: 'x' },
      });
      const r = await svc.consumeToken('rawtoken', 'apply');
      expect(r).toEqual({ ok: false, reason: 'wrong_purpose' });
      expect(mockSend).toHaveBeenCalledTimes(1); // no delete
    });

    it('returns ok and deletes the row on a valid consume', async () => {
      const future = Math.floor(FIXED_NOW_MS / 1000) + 60;
      mockSend
        .mockResolvedValueOnce({
          Item: {
            tokenHash: 'h',
            purpose: 'apply',
            email: 'a@b',
            expiresAt: future,
            createdAt: 'x',
            applyPayload: { name: 'X', email: 'a@b', sourceUrl: 'u', sourceType: 'json' },
          },
        })
        .mockResolvedValueOnce({}); // delete
      const r = await svc.consumeToken('rawtoken', 'apply');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.row.email).toBe('a@b');
        expect(r.row.applyPayload?.name).toBe('X');
      }
      const second = mockSend.mock.calls[1][0];
      expect(second.constructor.name).toBe('DeleteCommand');
    });
  });

  describe('hashToken', () => {
    it('produces deterministic hex SHA-256', () => {
      const a = MagicTokenService.hashToken('hello');
      expect(a).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
      expect(MagicTokenService.hashToken('hello')).toBe(a);
    });
  });
});
