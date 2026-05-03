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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
