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

/**
 * Verify a reCAPTCHA v3 token against Google's siteverify endpoint.
 *
 * Returns true on success, false on failure. Behaviour when
 * RECAPTCHA_SECRET_KEY is unset:
 *   - production (`ENVIRONMENT === 'prod'`): fail closed (returns false)
 *   - any other environment: log a warning, return true so local dev /
 *     unit tests don't require a real Google round-trip.
 *
 * The optional `action` argument is included in the result-log line for
 * easier triage; it is *not* checked against the response (we trust the
 * score gate instead). Pass it to make the logs self-explanatory.
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

  try {
    const response = await fetch(SITE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
    });

    const result = (await response.json()) as SiteVerifyResponse;

    console.log('reCAPTCHA verification result:', {
      success: result.success,
      score: result.score,
      action: result.action || action,
      errorCodes: result['error-codes'],
      challengeTimestamp: result.challenge_ts,
      hostname: result.hostname,
    });

    if (result.score !== undefined) {
      const isValid = result.success && result.score > SCORE_THRESHOLD;
      console.log(`reCAPTCHA score validation: ${result.score} > ${SCORE_THRESHOLD} = ${isValid}`);
      return isValid;
    }

    return result.success;
  } catch (error) {
    console.error('Error verifying CAPTCHA:', error);
    return false;
  }
}
