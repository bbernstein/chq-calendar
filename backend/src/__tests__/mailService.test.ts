import { SesMailService } from '../services/mailService';

const mockSend = jest.fn();
const mockClient: any = { send: mockSend };

describe('SesMailService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('sendApplyMagicLink builds a SendEmailCommand with subject + dual bodies', async () => {
    mockSend.mockResolvedValue({ MessageId: 'mid-1' });
    const svc = new SesMailService(mockClient, 'no-reply@chqcal.org');
    const out = await svc.sendApplyMagicLink('user@example.com', 'Alice', 'https://x.test/verify?token=abc');
    expect(out.messageId).toBe('mid-1');

    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('SendEmailCommand');
    expect(cmd.input.FromEmailAddress).toBe('no-reply@chqcal.org');
    expect(cmd.input.Destination.ToAddresses).toEqual(['user@example.com']);
    expect(cmd.input.Content.Simple.Subject.Data).toMatch(/Verify your Chautauqua/);
    expect(cmd.input.Content.Simple.Body.Text.Data).toContain('https://x.test/verify?token=abc');
    expect(cmd.input.Content.Simple.Body.Text.Data).toContain('Alice');
    expect(cmd.input.Content.Simple.Body.Html.Data).toContain('https://x.test/verify?token=abc');
    expect(cmd.input.Content.Simple.Body.Html.Data).toContain('Alice');
  });

  it('escapes HTML-special characters in the applicant name (HTML body only)', async () => {
    mockSend.mockResolvedValue({ MessageId: 'mid-2' });
    const svc = new SesMailService(mockClient, 'no-reply@chqcal.org');
    await svc.sendApplyMagicLink('user@example.com', '<script>x</script>', 'https://x.test/v');
    const cmd: any = mockSend.mock.calls[0][0];
    const html: string = cmd.input.Content.Simple.Body.Html.Data;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    // Plain text body has no HTML escaping (it's text/plain).
    expect(cmd.input.Content.Simple.Body.Text.Data).toContain('<script>x</script>');
  });

  it('falls back to "there" when applicantName is empty', async () => {
    mockSend.mockResolvedValue({ MessageId: 'mid-3' });
    const svc = new SesMailService(mockClient, 'no-reply@chqcal.org');
    await svc.sendApplyMagicLink('user@example.com', '', 'https://x.test/v');
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.Content.Simple.Body.Text.Data).toContain('Hi there,');
  });

  it('sendLoginMagicLink uses login subject and link', async () => {
    mockSend.mockResolvedValue({ MessageId: 'mid-4' });
    const svc = new SesMailService(mockClient, 'no-reply@chqcal.org');
    const out = await svc.sendLoginMagicLink('a@b.com', 'https://x.test/login?token=xyz');
    expect(out.messageId).toBe('mid-4');
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.Content.Simple.Subject.Data).toMatch(/Sign in/);
    expect(cmd.input.Content.Simple.Body.Text.Data).toContain('https://x.test/login?token=xyz');
  });

  it('throws if SES_FROM_ADDRESS is empty', async () => {
    const svc = new SesMailService(mockClient, '');
    await expect(
      svc.sendApplyMagicLink('a@b.com', 'X', 'https://x.test/v'),
    ).rejects.toThrow(/SES_FROM_ADDRESS/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  // ─── Phase C: approval / rejection emails ─────────────────────────────

  it('sendApprovalEmail uses approval subject and embeds publisherId + login + status URLs', async () => {
    mockSend.mockResolvedValue({ MessageId: 'mid-app-1' });
    const svc = new SesMailService(mockClient, 'no-reply@chqcal.org');
    const out = await svc.sendApprovalEmail({
      to: 'pub@example.com',
      publisherName: 'Acme Concerts',
      publisherId: 'acme-concerts',
      statusUrl: 'https://x.test/publish/status/',
      loginUrl: 'https://x.test/publish/login/',
    });
    expect(out.messageId).toBe('mid-app-1');
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.Destination.ToAddresses).toEqual(['pub@example.com']);
    expect(cmd.input.Content.Simple.Subject.Data).toMatch(/approved/i);
    const text = cmd.input.Content.Simple.Body.Text.Data;
    expect(text).toContain('Acme Concerts');
    // The publisher slug is required to make the feed go live; surface it
    // prominently with surrounding context so a recipient can act on it.
    expect(text).toContain('acme-concerts');
    expect(text).toMatch(/publisher\.id/);
    expect(text).toContain('https://x.test/publish/login/');
    expect(text).toContain('https://x.test/publish/status/');
    const html = cmd.input.Content.Simple.Body.Html.Data;
    expect(html).toContain('Acme Concerts');
    expect(html).toContain('acme-concerts');
    // Symmetric with the text body assertion above — the same instruction
    // text must appear in HTML so a recipient reading either format
    // understands what to do with the slug.
    expect(html).toMatch(/publisher\.id/);
    expect(html).toContain('https://x.test/publish/login/');
    // <pre> gives reliable monospace rendering across email clients
    // (notably Outlook 2010–2016 which strips font-family from <p>).
    expect(html).toContain('<pre');
  });

  it('sendApprovalEmail HTML-escapes the publisher name and publisher id', async () => {
    mockSend.mockResolvedValue({ MessageId: 'mid-app-2' });
    const svc = new SesMailService(mockClient, 'no-reply@chqcal.org');
    await svc.sendApprovalEmail({
      to: 'p@x.com',
      publisherName: '<script>alert(1)</script>',
      // publisherId is admin-controlled (a slug), but we escape it
      // defensively so an unusual value can't break the email rendering.
      publisherId: 'pub-<bad>',
      statusUrl: 'https://x.test/s',
      loginUrl: 'https://x.test/l',
    });
    const cmd: any = mockSend.mock.calls[0][0];
    const html: string = cmd.input.Content.Simple.Body.Html.Data;
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('pub-<bad>');
    expect(html).toContain('pub-&lt;bad&gt;');
  });

  it('sendRejectionEmail includes reviewer reason when supplied', async () => {
    mockSend.mockResolvedValue({ MessageId: 'mid-rej-1' });
    const svc = new SesMailService(mockClient, 'no-reply@chqcal.org');
    await svc.sendRejectionEmail({
      to: 'pub@example.com',
      publisherName: 'Acme',
      reason: 'Source URL returned non-public events.',
      applyAgainUrl: 'https://x.test/publish/apply/',
    });
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.Content.Simple.Subject.Data).toMatch(/Update on your/i);
    const text = cmd.input.Content.Simple.Body.Text.Data;
    expect(text).toContain('Source URL returned non-public events.');
    expect(text).toContain('https://x.test/publish/apply/');
    const html = cmd.input.Content.Simple.Body.Html.Data;
    expect(html).toContain('blockquote');
    expect(html).toContain('Source URL returned non-public events.');
  });

  it('sendRejectionEmail omits the reason block when reason is missing', async () => {
    mockSend.mockResolvedValue({ MessageId: 'mid-rej-2' });
    const svc = new SesMailService(mockClient, 'no-reply@chqcal.org');
    await svc.sendRejectionEmail({
      to: 'pub@example.com',
      publisherName: 'Acme',
      applyAgainUrl: 'https://x.test/publish/apply/',
    });
    const cmd: any = mockSend.mock.calls[0][0];
    const html = cmd.input.Content.Simple.Body.Html.Data;
    expect(html).not.toContain('blockquote');
    expect(html).not.toContain('Reviewer note');
  });

  it('sendRejectionEmail HTML-escapes the reviewer reason', async () => {
    mockSend.mockResolvedValue({ MessageId: 'mid-rej-3' });
    const svc = new SesMailService(mockClient, 'no-reply@chqcal.org');
    await svc.sendRejectionEmail({
      to: 'pub@example.com',
      publisherName: 'Acme',
      reason: '<img src=x onerror=alert(1)>',
      applyAgainUrl: 'https://x.test/publish/apply/',
    });
    const cmd: any = mockSend.mock.calls[0][0];
    const html: string = cmd.input.Content.Simple.Body.Html.Data;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('approval/rejection emails throw if SES_FROM_ADDRESS is empty', async () => {
    const svc = new SesMailService(mockClient, '');
    await expect(
      svc.sendApprovalEmail({ to: 'a@b.com', publisherName: 'X', publisherId: 'x', statusUrl: 'https://x', loginUrl: 'https://x' }),
    ).rejects.toThrow(/SES_FROM_ADDRESS/);
    await expect(
      svc.sendRejectionEmail({ to: 'a@b.com', publisherName: 'X', applyAgainUrl: 'https://x' }),
    ).rejects.toThrow(/SES_FROM_ADDRESS/);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
