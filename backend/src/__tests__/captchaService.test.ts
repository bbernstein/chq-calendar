// Tests for the shared captcha service. node-fetch is mocked so we don't
// hit Google's siteverify endpoint.

import { verifyCaptcha } from '../services/captchaService';

jest.mock('node-fetch', () => jest.fn());
import fetch from 'node-fetch';

const mockFetch = fetch as unknown as jest.Mock;

const ORIGINAL_ENV = { ...process.env };

function mockResponse(body: Record<string, unknown>) {
  mockFetch.mockResolvedValueOnce({
    json: () => Promise.resolve(body),
  });
}

describe('verifyCaptcha', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('without RECAPTCHA_SECRET_KEY', () => {
    it('returns true in non-production (test/dev pass-through)', async () => {
      delete process.env.RECAPTCHA_SECRET_KEY;
      process.env.ENVIRONMENT = 'dev';
      const ok = await verifyCaptcha('any-token', 'submit_feedback');
      expect(ok).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns false in production (fail closed)', async () => {
      delete process.env.RECAPTCHA_SECRET_KEY;
      process.env.ENVIRONMENT = 'prod';
      const ok = await verifyCaptcha('any-token', 'submit_feedback');
      expect(ok).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('with RECAPTCHA_SECRET_KEY configured', () => {
    beforeEach(() => {
      process.env.RECAPTCHA_SECRET_KEY = 'test-secret';
      process.env.ENVIRONMENT = 'prod';
    });

    it('rejects empty tokens without contacting Google', async () => {
      const ok = await verifyCaptcha('', 'publisher_apply');
      expect(ok).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns true on successful verification with matching action and good score', async () => {
      mockResponse({ success: true, score: 0.9, action: 'publisher_apply' });
      const ok = await verifyCaptcha('tok', 'publisher_apply');
      expect(ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.google.com/recaptcha/api/siteverify',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('returns false when score is below threshold even with matching action', async () => {
      mockResponse({ success: true, score: 0.3, action: 'publisher_apply' });
      const ok = await verifyCaptcha('tok', 'publisher_apply');
      expect(ok).toBe(false);
    });

    it('returns false on action mismatch even when the score is fine', async () => {
      // Token minted for `submit_feedback` should not be valid against
      // `publisher_apply` — prevents cross-form token replay.
      mockResponse({ success: true, score: 0.9, action: 'submit_feedback' });
      const ok = await verifyCaptcha('tok', 'publisher_apply');
      expect(ok).toBe(false);
    });

    it('returns false when Google reports success=false', async () => {
      mockResponse({
        success: false,
        score: 0.9,
        action: 'publisher_apply',
        'error-codes': ['invalid-input-response'],
      });
      const ok = await verifyCaptcha('bad-tok', 'publisher_apply');
      expect(ok).toBe(false);
    });

    it('falls back to result.success when no score is present (v2 compatibility)', async () => {
      mockResponse({ success: true });
      const ok = await verifyCaptcha('tok', 'publisher_apply');
      expect(ok).toBe(true);
    });

    it('returns false when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network down'));
      const ok = await verifyCaptcha('tok', 'publisher_apply');
      expect(ok).toBe(false);
    });

    it('returns false when siteverify times out (AbortError path)', async () => {
      // The 8s AbortController timeout protects the Lambda from a slow or
      // unreachable Google endpoint. When the controller aborts, fetch
      // throws an AbortError; this test asserts the catch branch handles
      // it cleanly and returns false rather than propagating.
      const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
      mockFetch.mockRejectedValueOnce(abortErr);
      const ok = await verifyCaptcha('tok', 'publisher_apply');
      expect(ok).toBe(false);
    });
  });
});
