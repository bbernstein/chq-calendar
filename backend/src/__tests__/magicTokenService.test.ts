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
    it('returns not_found when ConditionalCheckFailed (token did not exist)', async () => {
      const err = new Error('not found');
      (err as any).name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(err);
      const r = await svc.consumeToken('nonexistent', 'apply');
      expect(r).toEqual({ ok: false, reason: 'not_found' });
      // Single atomic DeleteCommand — no separate GetCommand.
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0][0].constructor.name).toBe('DeleteCommand');
    });

    it('returns not_found when DeleteCommand resolves with no Attributes', async () => {
      mockSend.mockResolvedValueOnce({}); // unusual but defensive
      const r = await svc.consumeToken('something', 'apply');
      expect(r).toEqual({ ok: false, reason: 'not_found' });
    });

    it('returns not_found for empty input without hitting DynamoDB', async () => {
      const r = await svc.consumeToken('', 'apply');
      expect(r).toEqual({ ok: false, reason: 'not_found' });
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns expired (row already deleted by the atomic command)', async () => {
      const past = Math.floor(FIXED_NOW_MS / 1000) - 1;
      mockSend.mockResolvedValueOnce({
        Attributes: { tokenHash: 'h', purpose: 'apply', email: 'a@b', expiresAt: past, createdAt: 'x' },
      });
      const r = await svc.consumeToken('rawtoken', 'apply');
      expect(r).toEqual({ ok: false, reason: 'expired' });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('returns wrong_purpose (row already deleted)', async () => {
      const future = Math.floor(FIXED_NOW_MS / 1000) + 60;
      mockSend.mockResolvedValueOnce({
        Attributes: { tokenHash: 'h', purpose: 'login', email: 'a@b', expiresAt: future, createdAt: 'x' },
      });
      const r = await svc.consumeToken('rawtoken', 'apply');
      expect(r).toEqual({ ok: false, reason: 'wrong_purpose' });
      // Atomic delete: one call.
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('returns ok and the row when the atomic delete succeeds within TTL', async () => {
      const future = Math.floor(FIXED_NOW_MS / 1000) + 60;
      mockSend.mockResolvedValueOnce({
        Attributes: {
          tokenHash: 'h',
          purpose: 'apply',
          email: 'a@b',
          expiresAt: future,
          createdAt: 'x',
          applyPayload: { name: 'X', email: 'a@b', sourceUrl: 'u', sourceType: 'json' },
        },
      });
      const r = await svc.consumeToken('rawtoken', 'apply');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.row.email).toBe('a@b');
        expect(r.row.applyPayload?.name).toBe('X');
      }
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0][0].constructor.name).toBe('DeleteCommand');
    });

    it('rethrows non-ConditionalCheckFailed errors', async () => {
      const err = new Error('throttled');
      (err as any).name = 'ProvisionedThroughputExceededException';
      mockSend.mockRejectedValueOnce(err);
      await expect(svc.consumeToken('rawtoken', 'apply')).rejects.toThrow(/throttled/);
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
