// Thin SES v2 wrapper for transactional publisher-portal emails.
//
// Why SESv2 (not SESv1): v2 is the current API; both work for plain
// SendEmail, but v2 supports configuration sets cleanly if we add bounce
// tracking later.
//
// Sender: $SES_FROM_ADDRESS (verified domain identity is chqcal.org).
// Site base URL: $SITE_BASE_URL (e.g. https://www.chqcal.org). Local dev
// can override to http://localhost:3000.
//
// All publisher-portal emails are short, plain-text-first, with a parallel
// HTML version. We do NOT use templates because the variation is minimal.
//
// IMPORTANT: never log the magic-link URL or raw token. Only log the email
// address, purpose, and SES MessageId.

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

export interface MailService {
  sendApplyMagicLink(toEmail: string, applicantName: string, magicLinkUrl: string): Promise<{ messageId: string }>;
  sendLoginMagicLink(toEmail: string, magicLinkUrl: string): Promise<{ messageId: string }>;
  sendApprovalEmail(opts: ApprovalEmailOpts): Promise<{ messageId: string }>;
  sendRejectionEmail(opts: RejectionEmailOpts): Promise<{ messageId: string }>;
  // Phase 4 (publisher email change — double-opt-in).
  sendEmailChangeVerify(opts: EmailChangeVerifyOpts): Promise<{ messageId: string }>;
  sendEmailChangeWarning(opts: EmailChangeWarningOpts): Promise<{ messageId: string }>;
  sendEmailChangeCommitted(opts: EmailChangeCommittedOpts): Promise<{ messageId: string }>;
  sendEmailChangeCancelled(opts: EmailChangeCancelledOpts): Promise<{ messageId: string }>;
  // Phase 6 (publisher self-disable). Sent to the current contact address
  // after a successful self-disable confirmation. Records the slug so the
  // publisher has a written reference for re-enable conversations.
  sendSelfDisabledConfirmation(opts: SelfDisabledConfirmationOpts): Promise<{ messageId: string }>;
}

export interface EmailChangeVerifyOpts {
  to: string;       // newEmail
  verifyUrl: string;
}

export interface EmailChangeWarningOpts {
  to: string;       // oldEmail
  newEmail: string; // shown to the user; escaped in HTML
  cancelUrl: string;
}

export interface EmailChangeCommittedOpts {
  to: string;       // sent to BOTH old and new — caller invokes twice
  oldEmail: string;
  newEmail: string;
}

export interface EmailChangeCancelledOpts {
  to: string;       // sent to BOTH old and new — caller invokes twice
  oldEmail: string;
  newEmail: string;
}

export interface SelfDisabledConfirmationOpts {
  to: string;       // current contactEmail
  slug: string;     // publisher.id — needed for any future re-enable request
}

export interface ApprovalEmailOpts {
  to: string;
  publisherName: string;
  // The publisher's unique ID. Auto-generated as `pub-<uuid4>` at
  // apply-verify time (publisherApplicationService.ts), not assigned by
  // the admin during review — the admin's only review actions are
  // approve / reject. The publisher must include this exact value as
  // `publisher.id` in their feed (or in the `chq-publisher` HTML
  // comment) for the ingest pipeline to recognise their events.
  // Without it the feed validates but no events go live.
  publisherId: string;
  statusUrl: string;
  loginUrl: string;
}

export interface RejectionEmailOpts {
  to: string;
  publisherName: string;
  reason?: string;
  applyAgainUrl: string;
}

export class SesMailService implements MailService {
  constructor(
    private readonly client: SESv2Client = new SESv2Client({}),
    private readonly fromAddress: string = process.env.SES_FROM_ADDRESS ?? '',
  ) {}

  async sendApplyMagicLink(toEmail: string, applicantName: string, magicLinkUrl: string) {
    if (!this.fromAddress) {
      throw new Error('SES_FROM_ADDRESS env var not set');
    }
    const subject = 'Verify your Chautauqua Calendar publisher application';
    const text = applyText(applicantName, magicLinkUrl);
    const html = applyHtml(applicantName, magicLinkUrl);
    return this._send(toEmail, subject, text, html);
  }

  async sendLoginMagicLink(toEmail: string, magicLinkUrl: string) {
    if (!this.fromAddress) {
      throw new Error('SES_FROM_ADDRESS env var not set');
    }
    const subject = 'Sign in to your Chautauqua Calendar publisher account';
    const text = loginText(magicLinkUrl);
    const html = loginHtml(magicLinkUrl);
    return this._send(toEmail, subject, text, html);
  }

  async sendApprovalEmail(opts: ApprovalEmailOpts) {
    if (!this.fromAddress) {
      throw new Error('SES_FROM_ADDRESS env var not set');
    }
    const subject = 'Your Chautauqua Calendar publisher application is approved';
    const text = approvalText(opts);
    const html = approvalHtml(opts);
    return this._send(opts.to, subject, text, html);
  }

  async sendRejectionEmail(opts: RejectionEmailOpts) {
    if (!this.fromAddress) {
      throw new Error('SES_FROM_ADDRESS env var not set');
    }
    const subject = 'Update on your Chautauqua Calendar publisher application';
    const text = rejectionText(opts);
    const html = rejectionHtml(opts);
    return this._send(opts.to, subject, text, html);
  }

  async sendEmailChangeVerify(opts: EmailChangeVerifyOpts) {
    if (!this.fromAddress) {
      throw new Error('SES_FROM_ADDRESS env var not set');
    }
    const subject = 'Confirm your new Chautauqua Calendar publisher email';
    const text = emailChangeVerifyText(opts);
    const html = emailChangeVerifyHtml(opts);
    return this._send(opts.to, subject, text, html);
  }

  async sendEmailChangeWarning(opts: EmailChangeWarningOpts) {
    if (!this.fromAddress) {
      throw new Error('SES_FROM_ADDRESS env var not set');
    }
    const subject = 'Someone requested to change your publisher email';
    const text = emailChangeWarningText(opts);
    const html = emailChangeWarningHtml(opts);
    return this._send(opts.to, subject, text, html);
  }

  async sendEmailChangeCommitted(opts: EmailChangeCommittedOpts) {
    if (!this.fromAddress) {
      throw new Error('SES_FROM_ADDRESS env var not set');
    }
    const subject = 'Your publisher email was changed';
    const text = emailChangeCommittedText(opts);
    const html = emailChangeCommittedHtml(opts);
    return this._send(opts.to, subject, text, html);
  }

  async sendEmailChangeCancelled(opts: EmailChangeCancelledOpts) {
    if (!this.fromAddress) {
      throw new Error('SES_FROM_ADDRESS env var not set');
    }
    const subject = 'Email change cancelled';
    const text = emailChangeCancelledText(opts);
    const html = emailChangeCancelledHtml(opts);
    return this._send(opts.to, subject, text, html);
  }

  async sendSelfDisabledConfirmation(opts: SelfDisabledConfirmationOpts) {
    if (!this.fromAddress) {
      throw new Error('SES_FROM_ADDRESS env var not set');
    }
    const subject = 'Your Chautauqua Calendar publisher is disabled';
    const text = selfDisabledConfirmationText(opts);
    const html = selfDisabledConfirmationHtml(opts);
    return this._send(opts.to, subject, text, html);
  }

  private async _send(to: string, subject: string, text: string, html: string) {
    const cmd = new SendEmailCommand({
      FromEmailAddress: this.fromAddress,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: text, Charset: 'UTF-8' },
            Html: { Data: html, Charset: 'UTF-8' },
          },
        },
      },
    });
    const resp = await this.client.send(cmd);
    return { messageId: resp.MessageId ?? '' };
  }
}

// ─── Email body templates ────────────────────────────────────────────────
//
// Kept inline + plain to make audit trivial. If we add more variations,
// extract to a templates/ directory.

function applyText(name: string, url: string): string {
  return [
    `Hi ${name || 'there'},`,
    '',
    'Thanks for applying to publish events on chqcal.org.',
    '',
    'To complete your application, click the link below within 15 minutes:',
    '',
    url,
    '',
    'If you did not submit this application, you can safely ignore this email.',
    '',
    '— Chautauqua Calendar',
  ].join('\n');
}

function applyHtml(name: string, url: string): string {
  // Escape user-controlled name in the HTML version. URL is already
  // application-controlled (we built it server-side), but we still avoid
  // breaking out of the href.
  const safeName = escapeHtml(name || 'there');
  const safeUrl = encodeURI(url);
  return [
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">',
    `<p>Hi ${safeName},</p>`,
    '<p>Thanks for applying to publish events on chqcal.org.</p>',
    '<p>To complete your application, click the link below within 15 minutes:</p>',
    `<p><a href="${safeUrl}">${safeUrl}</a></p>`,
    '<p>If you did not submit this application, you can safely ignore this email.</p>',
    '<p>— Chautauqua Calendar</p>',
    '</body></html>',
  ].join('');
}

function loginText(url: string): string {
  return [
    'Hi,',
    '',
    'Click the link below within 15 minutes to sign in to your',
    'Chautauqua Calendar publisher account:',
    '',
    url,
    '',
    'If you did not request this, you can safely ignore this email.',
    '',
    '— Chautauqua Calendar',
  ].join('\n');
}

function loginHtml(url: string): string {
  const safeUrl = encodeURI(url);
  return [
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">',
    '<p>Hi,</p>',
    '<p>Click the link below within 15 minutes to sign in to your Chautauqua Calendar publisher account:</p>',
    `<p><a href="${safeUrl}">${safeUrl}</a></p>`,
    '<p>If you did not request this, you can safely ignore this email.</p>',
    '<p>— Chautauqua Calendar</p>',
    '</body></html>',
  ].join('');
}

// Empty-id fallback — defensive only. publisherId is set from rec.id at
// record creation time and is never empty in practice; using a placeholder
// instead of rendering blank avoids a confusing email if the invariant
// ever drifts.
const PUBLISHER_ID_PLACEHOLDER = '(missing — contact us)';

function approvalText(o: ApprovalEmailOpts): string {
  const id = o.publisherId || PUBLISHER_ID_PLACEHOLDER;
  return [
    `Hi ${o.publisherName || 'there'},`,
    '',
    'Good news — your Chautauqua Calendar publisher application has been approved.',
    '',
    'Your assigned publisher ID is:',
    '',
    `    ${id}`,
    '',
    'You MUST include this exact value as `publisher.id` in your feed (or in the',
    '`chq-publisher` HTML comment) for your events to appear on chqcal.org. Without',
    'it the feed validates but no events go live.',
    '',
    'Once your feed lists this ID, the next ingest run will pick up your events.',
    '',
    'Sign in to view your status and recent fetch history:',
    o.loginUrl,
    '',
    'You can check your status anytime here:',
    o.statusUrl,
    '',
    '— Chautauqua Calendar',
  ].join('\n');
}

function approvalHtml(o: ApprovalEmailOpts): string {
  const safeName = escapeHtml(o.publisherName || 'there');
  const safeId = escapeHtml(o.publisherId || PUBLISHER_ID_PLACEHOLDER);
  const safeLogin = encodeURI(o.loginUrl);
  const safeStatus = encodeURI(o.statusUrl);
  // Wrap the publisher ID in <pre> rather than a styled <p> + <code>: Outlook
  // 2010–2016 strips font-family from <p>, so an inline-styled <p><code> would
  // render in the body font (defeating the "stand-out monospace" intent).
  // <pre> defaults to monospace in every email client we care about, with no
  // CSS dependency.
  return [
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">',
    `<p>Hi ${safeName},</p>`,
    '<p>Good news — your Chautauqua Calendar publisher application has been <strong>approved</strong>.</p>',
    '<p>Your assigned publisher ID is:</p>',
    `<pre style="margin:0.5em 0 0.5em 1em;font-size:1.05em">${safeId}</pre>`,
    '<p>You <strong>must</strong> include this exact value as <code>publisher.id</code> in your feed (or in the <code>chq-publisher</code> HTML comment) for your events to appear on chqcal.org. Without it the feed validates but no events go live.</p>',
    '<p>Once your feed lists this ID, the next ingest run will pick up your events.</p>',
    `<p>Sign in to view your status and recent fetch history: <a href="${safeLogin}">${safeLogin}</a></p>`,
    `<p>You can check your status anytime here: <a href="${safeStatus}">${safeStatus}</a></p>`,
    '<p>— Chautauqua Calendar</p>',
    '</body></html>',
  ].join('');
}

function rejectionText(o: RejectionEmailOpts): string {
  const lines = [
    `Hi ${o.publisherName || 'there'},`,
    '',
    'Thanks for applying to publish events on chqcal.org. After review, we are not able to approve your application at this time.',
  ];
  if (o.reason && o.reason.trim().length > 0) {
    lines.push('', 'Reviewer note:', o.reason.trim());
  }
  lines.push(
    '',
    'You are welcome to address any issues and apply again here:',
    o.applyAgainUrl,
    '',
    '— Chautauqua Calendar',
  );
  return lines.join('\n');
}

function rejectionHtml(o: RejectionEmailOpts): string {
  const safeName = escapeHtml(o.publisherName || 'there');
  const safeApply = encodeURI(o.applyAgainUrl);
  const reasonBlock = o.reason && o.reason.trim().length > 0
    ? `<p><strong>Reviewer note:</strong></p><blockquote style="margin:0 0 0 1em;padding-left:1em;border-left:3px solid #ccc;color:#444">${escapeHtml(o.reason.trim())}</blockquote>`
    : '';
  return [
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">',
    `<p>Hi ${safeName},</p>`,
    '<p>Thanks for applying to publish events on chqcal.org. After review, we are not able to approve your application at this time.</p>',
    reasonBlock,
    `<p>You are welcome to address any issues and apply again here: <a href="${safeApply}">${safeApply}</a></p>`,
    '<p>— Chautauqua Calendar</p>',
    '</body></html>',
  ].join('');
}

// ─── Email-change templates (Phase 4) ────────────────────────────────────

function emailChangeVerifyText(o: EmailChangeVerifyOpts): string {
  return [
    'Hi,',
    '',
    'Someone — hopefully you — asked to use this address as the contact email',
    'for a Chautauqua Calendar publisher account.',
    '',
    'To confirm and complete the change, click the link below within 24 hours:',
    '',
    o.verifyUrl,
    '',
    'If you did not expect this, you can safely ignore this email — no change',
    'will be made.',
    '',
    '— Chautauqua Calendar',
  ].join('\n');
}

function emailChangeVerifyHtml(o: EmailChangeVerifyOpts): string {
  const safeUrl = encodeURI(o.verifyUrl);
  return [
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">',
    '<p>Hi,</p>',
    '<p>Someone — hopefully you — asked to use this address as the contact email for a Chautauqua Calendar publisher account.</p>',
    '<p>To confirm and complete the change, click the link below within 24 hours:</p>',
    `<p><a href="${safeUrl}">${safeUrl}</a></p>`,
    '<p>If you did not expect this, you can safely ignore this email — no change will be made.</p>',
    '<p>— Chautauqua Calendar</p>',
    '</body></html>',
  ].join('');
}

function emailChangeWarningText(o: EmailChangeWarningOpts): string {
  return [
    'Hi,',
    '',
    'A request was just made to move your Chautauqua Calendar publisher contact',
    `email to a new address: ${o.newEmail}`,
    '',
    'If that was you, no action is needed — the new address must confirm the',
    'change before it takes effect.',
    '',
    'If that was NOT you, click the link below to cancel the request and lock',
    'email-change attempts on your account for 24 hours:',
    '',
    o.cancelUrl,
    '',
    '— Chautauqua Calendar',
  ].join('\n');
}

function emailChangeWarningHtml(o: EmailChangeWarningOpts): string {
  const safeNew = escapeHtml(o.newEmail);
  const safeUrl = encodeURI(o.cancelUrl);
  return [
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">',
    '<p>Hi,</p>',
    `<p>A request was just made to move your Chautauqua Calendar publisher contact email to a new address: <strong>${safeNew}</strong>.</p>`,
    '<p>If that was you, no action is needed — the new address must confirm the change before it takes effect.</p>',
    '<p>If that was <strong>not</strong> you, click the link below to cancel the request and lock email-change attempts on your account for 24 hours:</p>',
    `<p><a href="${safeUrl}">${safeUrl}</a></p>`,
    '<p>— Chautauqua Calendar</p>',
    '</body></html>',
  ].join('');
}

function emailChangeCommittedText(o: EmailChangeCommittedOpts): string {
  return [
    'Hi,',
    '',
    'Your Chautauqua Calendar publisher contact email has been changed.',
    '',
    `Previous: ${o.oldEmail}`,
    `New:      ${o.newEmail}`,
    '',
    'If you did not request this, contact us right away.',
    '',
    '— Chautauqua Calendar',
  ].join('\n');
}

function emailChangeCommittedHtml(o: EmailChangeCommittedOpts): string {
  const safeOld = escapeHtml(o.oldEmail);
  const safeNew = escapeHtml(o.newEmail);
  return [
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">',
    '<p>Hi,</p>',
    '<p>Your Chautauqua Calendar publisher contact email has been changed.</p>',
    `<p>Previous: <code>${safeOld}</code><br/>New: <code>${safeNew}</code></p>`,
    '<p>If you did not request this, contact us right away.</p>',
    '<p>— Chautauqua Calendar</p>',
    '</body></html>',
  ].join('');
}

function emailChangeCancelledText(o: EmailChangeCancelledOpts): string {
  return [
    'Hi,',
    '',
    'A pending request to change a Chautauqua Calendar publisher contact email',
    'was cancelled.',
    '',
    `Previous: ${o.oldEmail}`,
    `Requested: ${o.newEmail}`,
    '',
    'No change was made. The publisher account remains tied to the previous',
    'address.',
    '',
    '— Chautauqua Calendar',
  ].join('\n');
}

function emailChangeCancelledHtml(o: EmailChangeCancelledOpts): string {
  const safeOld = escapeHtml(o.oldEmail);
  const safeNew = escapeHtml(o.newEmail);
  return [
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">',
    '<p>Hi,</p>',
    '<p>A pending request to change a Chautauqua Calendar publisher contact email was cancelled.</p>',
    `<p>Previous: <code>${safeOld}</code><br/>Requested: <code>${safeNew}</code></p>`,
    '<p>No change was made. The publisher account remains tied to the previous address.</p>',
    '<p>— Chautauqua Calendar</p>',
    '</body></html>',
  ].join('');
}

// ─── Self-disable confirmation (Phase 6) ─────────────────────────────────

function selfDisabledConfirmationText(o: SelfDisabledConfirmationOpts): string {
  return [
    'Hi,',
    '',
    'Your Chautauqua Calendar publisher account has been disabled at your',
    'request. The next ingest run will retract your events from the calendar',
    '(usually within an hour).',
    '',
    'Your publisher record stays on file so a future re-enable preserves your',
    'slug:',
    '',
    `    ${o.slug}`,
    '',
    'Re-enabling a disabled publisher is an admin action — reply to this',
    'email or contact us at hello@chqcal.org if you change your mind. Your',
    'previously-published events will need to be re-fetched from your feed,',
    'so make sure the feed is still serving them when you ask to re-enable.',
    '',
    'If you did NOT request this, contact us right away.',
    '',
    '— Chautauqua Calendar',
  ].join('\n');
}

function selfDisabledConfirmationHtml(o: SelfDisabledConfirmationOpts): string {
  // Same <pre> rationale as the approval template — Outlook strips font-family
  // from <p>, so the slug needs its own monospace block.
  const safeSlug = escapeHtml(o.slug);
  return [
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">',
    '<p>Hi,</p>',
    '<p>Your Chautauqua Calendar publisher account has been <strong>disabled</strong> at your request. The next ingest run will retract your events from the calendar (usually within an hour).</p>',
    '<p>Your publisher record stays on file so a future re-enable preserves your slug:</p>',
    `<pre style="margin:0.5em 0 0.5em 1em;font-size:1.05em">${safeSlug}</pre>`,
    '<p>Re-enabling a disabled publisher is an admin action — reply to this email or contact us at <a href="mailto:hello@chqcal.org">hello@chqcal.org</a> if you change your mind. Your previously-published events will need to be re-fetched from your feed, so make sure the feed is still serving them when you ask to re-enable.</p>',
    '<p>If you did <strong>not</strong> request this, contact us right away.</p>',
    '<p>— Chautauqua Calendar</p>',
    '</body></html>',
  ].join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
