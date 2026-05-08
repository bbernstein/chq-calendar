// Happy-path E2E for the publisher email-flow chain:
//
//   apply → admin approve → login → profile edit → email change
//     (initiate, verify) → re-login forced (old JWT invalid; old email
//     no longer authenticates; new email does).
//
// Closes deferred follow-up #5 from PR #98. The deferred memo asked for
// "needs SES mocking infrastructure that doesn't exist in CI today" —
// that's true for *real* SES. At the service layer we already have an
// in-memory MailCapture that records every send call, which is enough
// to drive the chain end-to-end without touching network.
//
// Each step assertions:
//   - Apply: a magic link is mailed; verify produces a JWT.
//   - Admin approve: applicationStatus flips and an approval mail is sent.
//   - Login: a login magic link is mailed; verify produces a fresh JWT.
//   - Profile edit: PATCH is reflected on subsequent /publisher-status.
//   - Email change initiate: BOTH addresses are mailed (verify to new,
//     warning to old).
//   - Email change verify: registry contactEmail flips, tokenVersion bumps,
//     committed-email notifications go to BOTH addresses.
//   - Forced re-login: old-email login no longer mails a magic link;
//     new-email login does. The original JWT no longer authenticates
//     /publisher-status (tokenVersion mismatch → unauthorized).

jest.unmock('@aws-sdk/lib-dynamodb');
jest.unmock('@aws-sdk/client-dynamodb');

import { createHarness, type Harness } from './harness/harness';
import { tokenFromMagicLink } from './harness/testHelpers';

function tokenFromMail(h: Harness, email: string, kind: string, urlField: string): string {
  const sent = h.mail.byKind(kind as never).filter(m => m.to.toLowerCase() === email.toLowerCase()).pop();
  if (!sent) throw new Error(`no '${kind}' mail captured to ${email}`);
  const url = sent.data[urlField] as string;
  if (!url) throw new Error(`'${kind}' mail to ${email} had no '${urlField}' field`);
  return tokenFromMagicLink(url);
}

describe('publisher email-flow happy path', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness({ now: '2026-06-01T00:00:00Z' });
  });
  afterEach(() => {
    h.dispose();
  });

  it('apply → approve → login → edit → email-change → forced re-login', async () => {
    const oldEmail = 'before@example.com';
    const newEmail = 'after@example.com';

    // ── 1. Apply ─────────────────────────────────────────────────────────
    await h.actors.publisher.apply({
      name: 'Email Flow Co',
      email: oldEmail,
      sourceUrl: 'https://example.com/feed.json',
      sourceType: 'json',
    });
    const applyToken = (() => {
      const sent = h.mail.lastTo(oldEmail);
      if (!sent) throw new Error('no apply mail captured');
      return tokenFromMagicLink(sent.data.magicLinkUrl as string);
    })();
    const applied = await h.actors.publisher.verifyApplyMagicLink(applyToken);
    expect(applied.publisherId).toMatch(/^pub-/);
    const publisherId = applied.publisherId;

    // ── 2. Admin approve ────────────────────────────────────────────────
    await h.actors.admin.approveApplication(publisherId);
    const approvedRow = await h.registry.get(publisherId);
    expect(approvedRow?.applicationStatus).toBe('approved');
    expect(h.mail.byKind('approval').some(m => m.to === oldEmail)).toBe(true);

    // ── 3. Login (using the *post-approve* path, separate from apply) ──
    h.mail.clear();
    await h.actors.publisher.loginRequest(oldEmail);
    const loginToken = tokenFromMail(h, oldEmail, 'login', 'magicLinkUrl');
    const loggedIn = await h.actors.publisher.verifyLoginMagicLink(loginToken);
    expect(loggedIn.publisherId).toBe(publisherId);
    const oldJwt = loggedIn.jwt;

    // Sanity: status endpoint accepts the JWT.
    const status1 = await h.actors.publisher.status(oldJwt);
    expect(status1.publisher.id).toBe(publisherId);
    expect(status1.publisher.contactEmail).toBe(oldEmail);

    // ── 4. Profile edit ─────────────────────────────────────────────────
    await h.actors.publisher.updateProfile(oldJwt, { name: 'Email Flow Renamed' });
    const status2 = await h.actors.publisher.status(oldJwt);
    expect(status2.publisher.name).toBe('Email Flow Renamed');

    // ── 5. Email change initiate ────────────────────────────────────────
    h.mail.clear();
    await h.actors.publisher.requestEmailChange(oldJwt, newEmail);
    // Both verify (to new) and warning (to old) emails are sent.
    expect(h.mail.byKind('email_change_verify').some(m => m.to === newEmail)).toBe(true);
    expect(h.mail.byKind('email_change_warning').some(m => m.to === oldEmail)).toBe(true);

    // Status endpoint surfaces the pending change.
    const status3 = await h.actors.publisher.status(oldJwt);
    expect(status3.publisher.pendingEmailChange?.newEmail).toBe(newEmail);

    // ── 6. Email change verify (clicked from new address inbox) ─────────
    const verifyToken = tokenFromMail(h, newEmail, 'email_change_verify', 'verifyUrl');
    const verifyResult = await h.actors.publisher.confirmEmailChange(verifyToken);
    expect(verifyResult.kind).toBe('ok');
    expect(verifyResult.newEmail).toBe(newEmail);

    // Registry: contactEmail flipped + tokenVersion bumped.
    const postChangeRow = await h.registry.get(publisherId);
    expect(postChangeRow?.contactEmail).toBe(newEmail);

    // Both addresses were notified that the change committed.
    const committed = h.mail.byKind('email_change_committed');
    expect(committed.some(m => m.to === oldEmail)).toBe(true);
    expect(committed.some(m => m.to === newEmail)).toBe(true);

    // ── 7. Forced re-login ──────────────────────────────────────────────
    // Old JWT no longer authenticates because tokenVersion was bumped.
    // Match the actor's HandlerError shape — assert on the 401 status code
    // so a regression to a generic 500 (or worse, a silent 200) wouldn't
    // make this assertion accidentally pass.
    await expect(h.actors.publisher.status(oldJwt)).rejects.toMatchObject({ statusCode: 401 });

    // Old email no longer issues a login magic link (the address is no
    // longer associated with any publisher row).
    h.mail.clear();
    await h.actors.publisher.loginRequest(oldEmail);
    expect(h.mail.byKind('login').some(m => m.to === oldEmail)).toBe(false);

    // New email DOES issue a login magic link, and verifying it yields a
    // fresh JWT bound to the same publisher.
    await h.actors.publisher.loginRequest(newEmail);
    const reLoginToken = tokenFromMail(h, newEmail, 'login', 'magicLinkUrl');
    const reLoggedIn = await h.actors.publisher.verifyLoginMagicLink(reLoginToken);
    expect(reLoggedIn.publisherId).toBe(publisherId);
    expect(reLoggedIn.email).toBe(newEmail);

    // The fresh JWT authenticates /publisher-status with the new email.
    const finalStatus = await h.actors.publisher.status(reLoggedIn.jwt);
    expect(finalStatus.publisher.contactEmail).toBe(newEmail);
    // Pending email change was cleared by the verify step.
    expect(finalStatus.publisher.pendingEmailChange).toBeUndefined();
  });
});
