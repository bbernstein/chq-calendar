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
});
