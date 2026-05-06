import fetch from 'node-fetch';

interface SiteVerifyResponse {
  success: boolean;
  score?: number;
  action?: string;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
}

const SITE_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

// reCAPTCHA v3 score threshold. Below this we treat the request as bot-like.
// Matches the historical threshold used by the feedback endpoint.
const SCORE_THRESHOLD = 0.5;

// Cap the round-trip to Google so a slow/unreachable siteverify endpoint
// can't hold the Lambda for the full platform default (~30 s). 8 s is well
// above siteverify's median latency but short enough to fail fast under
// network trouble.
const SITE_VERIFY_TIMEOUT_MS = 8000;

/**
 * Verify a reCAPTCHA v3 token against Google's siteverify endpoint.
 *
 * Returns true on success, false on failure. Behaviour when
 * RECAPTCHA_SECRET_KEY is unset:
 *   - production (`ENVIRONMENT === 'prod'`): fail closed (returns false)
 *   - any other environment: log a warning, return true so local dev /
 *     unit tests don't require a real Google round-trip. Token may be
 *     empty in this case (frontend skips reCAPTCHA when no site key).
 *
 * The `action` argument is checked against `result.action` from Google's
 * response. v3 tokens are minted per-action; rejecting on mismatch prevents
 * an attacker from replaying a token issued for a different form (e.g. a
 * `submit_feedback` token reused against `publisher_apply`).
 */
export async function verifyCaptcha(
  token: string,
  action: string = 'submit',
): Promise<boolean> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    if (process.env.ENVIRONMENT === 'prod') {
      console.error('RECAPTCHA_SECRET_KEY not configured in production - rejecting request');
      return false;
    }
    console.warn('RECAPTCHA_SECRET_KEY not configured, skipping CAPTCHA verification in non-production');
    return true;
  }

  // Empty token in production with secret configured: short-circuit. Sending
  // an empty `response` to Google would be a wasted round-trip — siteverify
  // returns success=false with `missing-input-response` in that case.
  if (!token) {
    console.warn('verifyCaptcha called with empty token; rejecting without contacting Google');
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SITE_VERIFY_TIMEOUT_MS);

  try {
    const response = await fetch(SITE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
      signal: controller.signal,
    });

    const result = (await response.json()) as SiteVerifyResponse;

    console.log('reCAPTCHA verification result:', {
      success: result.success,
      score: result.score,
      expectedAction: action,
      action: result.action,
      errorCodes: result['error-codes'],
      challengeTimestamp: result.challenge_ts,
      hostname: result.hostname,
    });

    // Reject action mismatches even if the score gate would otherwise pass —
    // a token minted for a different action can't safely be used here.
    if (result.action !== undefined && result.action !== action) {
      console.warn(
        `reCAPTCHA action mismatch: expected "${action}", got "${result.action}"`,
      );
      return false;
    }

    if (result.score !== undefined) {
      const isValid = result.success && result.score > SCORE_THRESHOLD;
      console.log(`reCAPTCHA score validation: ${result.score} > ${SCORE_THRESHOLD} = ${isValid}`);
      return isValid;
    }

    return result.success;
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      console.error(`reCAPTCHA verification timed out after ${SITE_VERIFY_TIMEOUT_MS}ms`);
    } else {
      console.error('Error verifying CAPTCHA:', error);
    }
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Wrapper around verifyCaptcha that admits a test-only bypass header for the
 * post-deploy publisher smoke test (scripts/smoke/publisher-lifecycle.test.ts).
 *
 * The bypass fires ONLY when both:
 *   - process.env.CAPTCHA_BYPASS_TOKEN is non-empty (i.e. infra explicitly
 *     provisioned a smoke-bypass secret on this Lambda), AND
 *   - the caller sent header `X-Smoke-Bypass` (case-insensitive) matching
 *     that secret exactly.
 *
 * If either condition fails we fall through to verifyCaptcha — production
 * traffic without CAPTCHA_BYPASS_TOKEN provisioned cannot use this path no
 * matter what header values it sends, and a wrong header value short-circuits
 * back to the real verification.
 *
 * Auditability: each accepted bypass is logged with a fixed source tag so
 * misuse is greppable in CloudWatch.
 */
export async function verifyCaptchaWithBypass(
  token: string,
  action: string | undefined,
  headers: { [k: string]: string | undefined },
): Promise<boolean> {
  const bypassToken = process.env.CAPTCHA_BYPASS_TOKEN;
  // Pull both common-cased forms — API Gateway lowercases inbound header
  // names but reflective lookups by the original casing are still safe.
  const bypassHeader = headers['x-smoke-bypass'] ?? headers['X-Smoke-Bypass'];
  if (bypassToken && bypassHeader && bypassHeader === bypassToken) {
    console.info('[captcha] bypass accepted', { source: 'smoke' });
    return true;
  }
  return verifyCaptcha(token, action);
}
