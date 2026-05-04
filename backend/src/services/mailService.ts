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
}

export interface ApprovalEmailOpts {
  to: string;
  publisherName: string;
  // The slug the admin assigned to this publisher. The publisher must
  // include this exact value as `publisher.id` in their feed (or in the
  // `chq-publisher` HTML comment) for the ingest pipeline to recognise
  // their events. Without it the feed validates but no events go live.
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

function approvalText(o: ApprovalEmailOpts): string {
  return [
    `Hi ${o.publisherName || 'there'},`,
    '',
    'Good news — your Chautauqua Calendar publisher application has been approved.',
    '',
    'Your assigned publisher ID is:',
    '',
    `    ${o.publisherId}`,
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
  const safeId = escapeHtml(o.publisherId);
  const safeLogin = encodeURI(o.loginUrl);
  const safeStatus = encodeURI(o.statusUrl);
  return [
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">',
    `<p>Hi ${safeName},</p>`,
    '<p>Good news — your Chautauqua Calendar publisher application has been <strong>approved</strong>.</p>',
    '<p>Your assigned publisher ID is:</p>',
    `<p style="margin:0.5em 0 0.5em 1em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:1.1em"><code>${safeId}</code></p>`,
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
