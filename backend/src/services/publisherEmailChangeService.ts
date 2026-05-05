// Phase 4 (publisher portal self-service) — orchestrates the publisher
// email-change flow, which is double-opt-in:
//
//   1. initiate            (authenticated)
//        - validate inputs + uniqueness + lock
//        - issue verify+cancel token pair
//        - send verify link to NEW address
//        - send warning + cancel link to OLD address
//
//   2. verifyByNewAddress  (one-shot, no auth — token clicked from email)
//        - re-check newEmail still unused (race against another applicant)
//        - commit registry: contactEmail = newEmail; tokenVersion += 1
//        - delete the pending token pair (peer cancel + this verify)
//        - notify BOTH old and new ("your email was changed")
//
//   3. cancelByOldAddress  (one-shot, no auth — token clicked from email)
//        - delete the pending token pair
//        - set emailChangeLockedUntil = now + 24h on the registry row
//        - notify BOTH old and new ("change cancelled")
//
//   4. cancelBySelf        (authenticated; same publisher session)
//        - delete the pending token pair
//        - NO lock written (publisher cancelled their own request)
//
// All edge cases enforced are listed in
// docs/plans/2026-05-05-publisher-self-service-design.md ("Edge cases enforced").

import type { MagicTokenService, MagicTokenRow } from './magicTokenService';
import { PublisherNotFoundError, type PublisherRegistryService } from './publisherRegistryService';
import type { MailService } from './mailService';
import { isValidEmail } from '../utils/validateEmail';

export interface EmailChangeServiceDeps {
  registry: PublisherRegistryService;
  tokens: MagicTokenService;
  mail: MailService;
  siteBaseUrl: string;
  now?: () => Date;
}

const LOCK_DURATION_MS = 24 * 60 * 60 * 1000; // 24h, matches token TTL

export type EmailChangeErrorCode =
  | 'same_email'        // newEmail equals current contactEmail
  | 'email_in_use'      // newEmail belongs to another publisher / pending change
  | 'locked'            // emailChangeLockedUntil not yet passed
  | 'invalid_email';    // malformed input

export class EmailChangeError extends Error {
  constructor(
    public readonly code: EmailChangeErrorCode,
    message?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = 'EmailChangeError';
  }
}

export type VerifyEmailChangeResult =
  | { kind: 'ok'; publisherId: string; newEmail: string }
  | { kind: 'invalid' }         // token entirely missing/empty (link truncated)
  | { kind: 'already_used' }    // not_found / wrong_purpose
  | { kind: 'expired' }
  | { kind: 'email_taken' }     // race: newEmail snatched between submit and verify
  | { kind: 'publisher_missing' }; // publisher row deleted between issue and verify

export type CancelEmailChangeResult =
  | { kind: 'ok'; publisherId: string; lockedUntil: string }
  | { kind: 'invalid' }         // token entirely missing/empty (link truncated)
  | { kind: 'already_used' }
  | { kind: 'expired' }
  | { kind: 'publisher_missing' }; // publisher row deleted between issue and cancel

export class PublisherEmailChangeService {
  private readonly now: () => Date;

  constructor(private readonly deps: EmailChangeServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  // ─── Initiate ─────────────────────────────────────────────────────────

  async initiate(input: {
    publisherId: string;
    oldEmail: string;
    newEmail: string;
  }): Promise<void> {
    const oldEmail = input.oldEmail.trim().toLowerCase();
    const newEmail = input.newEmail.trim().toLowerCase();

    if (!isValidEmail(newEmail)) {
      throw new EmailChangeError('invalid_email', 'A valid email address is required.');
    }
    if (newEmail === oldEmail) {
      throw new EmailChangeError('same_email', "You're already using that email.");
    }

    // Lock check (registry row column).
    const pub = await this.deps.registry.get(input.publisherId);
    if (!pub) {
      // Caller must have validated this; treat as a programming error.
      throw new Error(`initiate: publisher ${input.publisherId} not found`);
    }
    if (pub.emailChangeLockedUntil) {
      const until = new Date(pub.emailChangeLockedUntil).getTime();
      if (Number.isFinite(until) && until > this.now().getTime()) {
        throw new EmailChangeError(
          'locked',
          'Email changes are temporarily locked on this account.',
          { lockedUntil: pub.emailChangeLockedUntil },
        );
      }
    }

    // Uniqueness checks.
    const existingRows = await this.deps.registry.getByEmail(newEmail);
    if (existingRows.some(r => r.id !== input.publisherId)) {
      throw new EmailChangeError(
        'email_in_use',
        "We can't accept that email address.",
      );
    }
    if (existingRows.some(r => r.id === input.publisherId)) {
      // newEmail matches our own row even after the !== check — defensive
      // (e.g. casing/whitespace variations folded out by normalization).
      throw new EmailChangeError('same_email', "You're already using that email.");
    }
    const existingPending = await this.deps.tokens.queryActiveEmailChangeByNewEmail(newEmail);
    if (existingPending && existingPending.publisherId !== input.publisherId) {
      throw new EmailChangeError(
        'email_in_use',
        "We can't accept that email address.",
      );
    }

    // Supersede any prior pending pair for THIS publisher. Clean both rows
    // so we don't leak a still-clickable verify link from a previous attempt.
    await this.deps.tokens.deleteEmailChangePairByPublisher(input.publisherId);

    // Issue the new pair.
    const issued = await this.deps.tokens.issueEmailChangePair({
      publisherId: input.publisherId,
      oldEmail,
      newEmail,
    });

    // Build URLs for the two action links. We do this after issuance because
    // the raw tokens are only known here.
    const verifyUrl = this.buildLandingUrl('verify', issued.verifyRawToken);
    const cancelUrl = this.buildLandingUrl('cancel', issued.cancelRawToken);

    // Send mail. Order: verify first (the legitimate user typically clicks
    // this), warning second (only matters if verify wasn't from them).
    // Failures here leave orphaned token rows; they TTL out in 24h. We
    // surface the error so the caller can return 5xx.
    await this.deps.mail.sendEmailChangeVerify({ to: newEmail, verifyUrl });
    await this.deps.mail.sendEmailChangeWarning({ to: oldEmail, newEmail, cancelUrl });
  }

  // ─── Verify (new-address click) ───────────────────────────────────────

  async verifyByNewAddress(rawToken: string): Promise<VerifyEmailChangeResult> {
    const r = await this.deps.tokens.consumeEmailChangeToken(rawToken, 'email_change_verify');
    if (r.ok === false) {
      // wrong_purpose folds into already_used: the caller doesn't need to
      // distinguish "you used the cancel link as a verify link" from
      // "this verify link was already used".
      if (r.reason === 'expired') return { kind: 'expired' };
      return { kind: 'already_used' };
    }

    const payload = r.row.emailChangePayload;
    if (!payload) {
      // Defensive — verify rows are always issued with a payload.
      return { kind: 'already_used' };
    }
    const { publisherId, newEmail, oldEmail } = payload;

    // Race guard: another publisher might have applied with this email
    // during the 24h window. Re-check immediately before commit. We can't
    // make commit + re-check fully atomic without a transaction; the
    // best-effort double-check is the spec.
    const existingRows = await this.deps.registry.getByEmail(newEmail);
    if (existingRows.some(rec => rec.id !== publisherId)) {
      // Race-loser path: another publisher claimed `newEmail` between submit
      // and verify. Delete both peer rows so the panel state is clean, and
      // signal `email_taken` so the verify landing page renders the right
      // error. The publisher can re-initiate from /publish/status/ — the
      // supersede path on initiate will do the right thing.
      await this.deps.tokens.deleteEmailChangePairByPublisher(publisherId);
      return { kind: 'email_taken' };
    }

    // Commit registry: change contactEmail and bump tokenVersion in one write.
    // The helper guards with attribute_exists(id); if the row was deleted
    // between issue and verify, signal 'publisher_missing' so the handler
    // doesn't render a misleading "ok" page.
    try {
      await this.deps.registry.commitEmailChange(publisherId, newEmail);
    } catch (err) {
      if (err instanceof PublisherNotFoundError) {
        // Best-effort cleanup of any orphan peer row, then surface.
        await this.deps.tokens
          .deleteEmailChangePairByPublisher(publisherId)
          .catch(cleanupErr =>
            console.error('[email-change] verify: orphan-cleanup failed after publisher-missing', cleanupErr),
          );
        return { kind: 'publisher_missing' };
      }
      throw err;
    }

    // Post-commit best-effort cleanup. The commit above is the authoritative
    // event — if any of these throw (e.g. underlying DDB Scan failure on
    // cleanup, or SES outage on notify), we still want the publisher to see
    // a successful verify page rather than a 500. Otherwise their email DID
    // change but we told them it failed, leaving them confused when their
    // old address no longer logs in. Log loudly so the failure is visible.
    try {
      // Delete the peer cancel row + any orphans for this publisher.
      // Surviving rows will TTL out within 24h regardless.
      await this.deps.tokens.deleteEmailChangePairByPublisher(publisherId);
    } catch (err) {
      console.error(
        '[email-change] verify: peer-row cleanup failed; row(s) will TTL within 24h',
        err,
      );
    }

    // Notify BOTH addresses. Failures are logged but not rethrown — the
    // change has already committed; mail issues shouldn't unwind it.
    try {
      await Promise.all([
        this.deps.mail
          .sendEmailChangeCommitted({ to: oldEmail, oldEmail, newEmail })
          .catch(err => console.error('[email-change] verify: notify-old-address failed', err)),
        this.deps.mail
          .sendEmailChangeCommitted({ to: newEmail, oldEmail, newEmail })
          .catch(err => console.error('[email-change] verify: notify-new-address failed', err)),
      ]);
    } catch (err) {
      console.error('[email-change] verify: notification block failed', err);
    }

    return { kind: 'ok', publisherId, newEmail };
  }

  // ─── Cancel-by-old-address (one-shot link) ────────────────────────────

  async cancelByOldAddress(rawToken: string): Promise<CancelEmailChangeResult> {
    const r = await this.deps.tokens.consumeEmailChangeToken(rawToken, 'email_change_cancel');
    if (r.ok === false) {
      if (r.reason === 'expired') return { kind: 'expired' };
      return { kind: 'already_used' };
    }
    const payload = r.row.emailChangePayload;
    if (!payload) return { kind: 'already_used' };
    const { publisherId, oldEmail, newEmail } = payload;

    // Delete the peer verify row (and any other orphans).
    await this.deps.tokens.deleteEmailChangePairByPublisher(publisherId);

    // Set the lock. attribute_exists(id) guard in the helper — if the row was
    // deleted between issue and cancel, signal 'publisher_missing'. We've
    // already deleted the peer rows above so cleanup is complete.
    const lockedUntil = new Date(this.now().getTime() + LOCK_DURATION_MS).toISOString();
    try {
      await this.deps.registry.setEmailChangeLock(publisherId, lockedUntil);
    } catch (err) {
      if (err instanceof PublisherNotFoundError) {
        return { kind: 'publisher_missing' };
      }
      throw err;
    }

    // Notify both addresses.
    await Promise.all([
      this.deps.mail
        .sendEmailChangeCancelled({ to: oldEmail, oldEmail, newEmail })
        .catch(err => console.error('[email-change] notify old failed:', err)),
      this.deps.mail
        .sendEmailChangeCancelled({ to: newEmail, oldEmail, newEmail })
        .catch(err => console.error('[email-change] notify new failed:', err)),
    ]);

    return { kind: 'ok', publisherId, lockedUntil };
  }

  // ─── Cancel-by-self (authenticated; own session) ──────────────────────

  async cancelBySelf(input: { publisherId: string }): Promise<void> {
    // Idempotent: deletes any pending pair (or zero rows). No lock — the
    // publisher cancelled their OWN request, so there's no abuse signal
    // here.
    await this.deps.tokens.deleteEmailChangePairByPublisher(input.publisherId);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  // Status surface: the active pending change for a publisher (or null).
  // Returned as a sanitized shape — only the fields the frontend needs.
  async getPendingForPublisher(
    publisherId: string,
  ): Promise<{ newEmail: string; expiresAt: string } | null> {
    const row = await this.deps.tokens.findActiveEmailChangeByPublisher(publisherId);
    if (!row || !row.emailChangePayload) return null;
    return {
      newEmail: row.emailChangePayload.newEmail,
      // Convert epoch seconds back to ISO for the wire shape.
      expiresAt: new Date(row.expiresAt * 1000).toISOString(),
    };
  }

  // Helper exposed for tests / the cancel-pending-on-disable hook.
  async _peerByPublisher(publisherId: string): Promise<MagicTokenRow[]> {
    const verify = await this.deps.tokens.findActiveEmailChangeByPublisher(publisherId);
    return verify ? [verify] : [];
  }

  private buildLandingUrl(action: 'verify' | 'cancel', rawToken: string): string {
    const base = this.deps.siteBaseUrl.replace(/\/+$/, '');
    const params = new URLSearchParams({ token: rawToken });
    return `${base}/publish/email-change/${action}/?${params.toString()}`;
  }
}
