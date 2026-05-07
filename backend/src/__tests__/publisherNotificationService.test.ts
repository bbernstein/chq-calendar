import { PublisherNotificationService } from '../services/publisherNotificationService';
import type { PublisherRecord } from '../types/publisher';
import type { IngestRunRow } from '../types/publisherIngestRun';

function publisher(overrides: Partial<PublisherRecord> = {}): PublisherRecord {
  return {
    id: 'pub-1',
    name: 'Test Pub',
    contactEmail: 'pub@example.com',
    sourceUrl: 'https://example.com/feed.json',
    sourceType: 'json',
    trustLevel: 'review',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function run(overrides: Partial<IngestRunRow> = {}): IngestRunRow {
  return {
    publisherId: 'pub-1',
    runAt: '2026-05-06T12:00:00.000Z',
    status: 'ok',
    triggeredBy: 'schedule',
    counts: { added: 1, updated: 0, retracted: 0, unchanged: 5 },
    ...overrides,
  };
}

function makeMail() {
  return {
    sendApplyMagicLink: jest.fn(),
    sendLoginMagicLink: jest.fn(),
    sendApprovalEmail: jest.fn(),
    sendRejectionEmail: jest.fn(),
    sendEmailChangeVerify: jest.fn(),
    sendEmailChangeWarning: jest.fn(),
    sendEmailChangeCommitted: jest.fn(),
    sendEmailChangeCancelled: jest.fn(),
    sendSelfDisabledConfirmation: jest.fn(),
    sendIngestFailureEmail: jest.fn().mockResolvedValue({ messageId: 'm1' }),
    sendIngestRecoveryEmail: jest.fn().mockResolvedValue({ messageId: 'm2' }),
    sendEventRejectedEmail: jest.fn().mockResolvedValue({ messageId: 'm3' }),
  };
}

describe('PublisherNotificationService.notifyIngestRunRecorded', () => {
  test('first failure after OK streak sends failure email with correct opts', async () => {
    const mail = makeMail();
    const svc = new PublisherNotificationService({ mail: mail as any, portalUrl: 'https://x.test/publish/status/' });
    await svc.notifyIngestRunRecorded({
      publisher: publisher(),
      prevRun: run({ status: 'ok' }),
      newRun: run({ status: 'parse_error', message: 'boom', counts: undefined }),
    });
    expect(mail.sendIngestFailureEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendIngestFailureEmail).toHaveBeenCalledWith({
      to: 'pub@example.com',
      publisherName: 'Test Pub',
      status: 'parse_error',
      message: 'boom',
      portalUrl: 'https://x.test/publish/status/',
    });
    expect(mail.sendIngestRecoveryEmail).not.toHaveBeenCalled();
  });

  test('first OK after failure streak sends recovery email with correct opts', async () => {
    const mail = makeMail();
    const svc = new PublisherNotificationService({ mail: mail as any, portalUrl: 'https://x.test/publish/status/' });
    await svc.notifyIngestRunRecorded({
      publisher: publisher(),
      prevRun: run({ status: 'network_error', message: 'timeout', counts: undefined }),
      newRun: run({ status: 'ok', counts: { added: 5, updated: 1, retracted: 0, unchanged: 10 } }),
    });
    expect(mail.sendIngestRecoveryEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendIngestRecoveryEmail).toHaveBeenCalledWith({
      to: 'pub@example.com',
      publisherName: 'Test Pub',
      counts: { added: 5, updated: 1, retracted: 0, unchanged: 10 },
      portalUrl: 'https://x.test/publish/status/',
    });
    expect(mail.sendIngestFailureEmail).not.toHaveBeenCalled();
  });

  test('OK→OK is silent', async () => {
    const mail = makeMail();
    const svc = new PublisherNotificationService({ mail: mail as any, portalUrl: 'https://x.test' });
    await svc.notifyIngestRunRecorded({
      publisher: publisher(),
      prevRun: run({ status: 'ok' }),
      newRun: run({ status: 'ok' }),
    });
    expect(mail.sendIngestFailureEmail).not.toHaveBeenCalled();
    expect(mail.sendIngestRecoveryEmail).not.toHaveBeenCalled();
  });

  test('failure→failure is silent (consecutive failures suppress repeat)', async () => {
    const mail = makeMail();
    const svc = new PublisherNotificationService({ mail: mail as any, portalUrl: 'https://x.test' });
    await svc.notifyIngestRunRecorded({
      publisher: publisher(),
      prevRun: run({ status: 'parse_error' }),
      newRun: run({ status: 'network_error' }),
    });
    expect(mail.sendIngestFailureEmail).not.toHaveBeenCalled();
    expect(mail.sendIngestRecoveryEmail).not.toHaveBeenCalled();
  });

  test('first ever run that fails sends failure email (prevRun undefined treated as OK)', async () => {
    const mail = makeMail();
    const svc = new PublisherNotificationService({ mail: mail as any, portalUrl: 'https://x.test' });
    await svc.notifyIngestRunRecorded({
      publisher: publisher(),
      prevRun: undefined,
      newRun: run({ status: 'parse_error', message: 'boom' }),
    });
    expect(mail.sendIngestFailureEmail).toHaveBeenCalledTimes(1);
  });

  test('first ever run that succeeds is silent', async () => {
    const mail = makeMail();
    const svc = new PublisherNotificationService({ mail: mail as any, portalUrl: 'https://x.test' });
    await svc.notifyIngestRunRecorded({
      publisher: publisher(),
      prevRun: undefined,
      newRun: run({ status: 'ok' }),
    });
    expect(mail.sendIngestFailureEmail).not.toHaveBeenCalled();
    expect(mail.sendIngestRecoveryEmail).not.toHaveBeenCalled();
  });

  test('notificationsEnabled === false short-circuits', async () => {
    const mail = makeMail();
    const svc = new PublisherNotificationService({ mail: mail as any, portalUrl: 'https://x.test' });
    await svc.notifyIngestRunRecorded({
      publisher: publisher({ notificationsEnabled: false }),
      prevRun: run({ status: 'ok' }),
      newRun: run({ status: 'parse_error' }),
    });
    expect(mail.sendIngestFailureEmail).not.toHaveBeenCalled();
  });

  test('mail throw is swallowed and logged (does not propagate)', async () => {
    const mail = makeMail();
    mail.sendIngestFailureEmail.mockRejectedValueOnce(new Error('SES down'));
    const svc = new PublisherNotificationService({ mail: mail as any, portalUrl: 'https://x.test' });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(svc.notifyIngestRunRecorded({
      publisher: publisher(),
      prevRun: run({ status: 'ok' }),
      newRun: run({ status: 'parse_error' }),
    })).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  test('mail timeout (>2s) is swallowed', async () => {
    const mail = makeMail();
    mail.sendIngestFailureEmail.mockImplementation(() => new Promise(() => {})); // never resolves
    const svc = new PublisherNotificationService({ mail: mail as any, portalUrl: 'https://x.test' });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.useFakeTimers();
    const promise = svc.notifyIngestRunRecorded({
      publisher: publisher(),
      prevRun: run({ status: 'ok' }),
      newRun: run({ status: 'parse_error' }),
    });
    jest.advanceTimersByTime(2_001);
    await expect(promise).resolves.toBeUndefined();
    jest.useRealTimers();
    errSpy.mockRestore();
  });
});

describe('PublisherNotificationService.notifyEventRejected', () => {
  test('sends rejection email with reason verbatim', async () => {
    const mail = makeMail();
    const svc = new PublisherNotificationService({ mail: mail as any, portalUrl: 'https://x.test/publish/status/' });
    await svc.notifyEventRejected({
      publisher: publisher(),
      event: { eventId: 'ev-1', startDate: '2026-07-01T18:00:00Z', payload: { title: 'Symphony' } } as any,
      reason: 'duplicate',
    });
    expect(mail.sendEventRejectedEmail).toHaveBeenCalledWith({
      to: 'pub@example.com',
      publisherName: 'Test Pub',
      eventTitle: 'Symphony',
      eventStartDate: '2026-07-01T18:00:00Z',
      reason: 'duplicate',
      portalUrl: 'https://x.test/publish/status/',
    });
  });

  test('reason undefined still sends but with reason: undefined', async () => {
    const mail = makeMail();
    const svc = new PublisherNotificationService({ mail: mail as any, portalUrl: 'https://x.test' });
    await svc.notifyEventRejected({
      publisher: publisher(),
      event: { eventId: 'ev-1', startDate: '2026-07-01T18:00:00Z', payload: { title: 'X' } } as any,
      reason: undefined,
    });
    expect(mail.sendEventRejectedEmail).toHaveBeenCalledWith(expect.objectContaining({ reason: undefined }));
  });

  test('whitespace-only reason becomes undefined', async () => {
    const mail = makeMail();
    const svc = new PublisherNotificationService({ mail: mail as any, portalUrl: 'https://x.test' });
    await svc.notifyEventRejected({
      publisher: publisher(),
      event: { eventId: 'ev-1', startDate: '2026-07-01T18:00:00Z', payload: { title: 'X' } } as any,
      reason: '   ',
    });
    expect(mail.sendEventRejectedEmail).toHaveBeenCalledWith(expect.objectContaining({ reason: undefined }));
  });

  test('event title falls back to "(untitled)" when payload.title missing', async () => {
    const mail = makeMail();
    const svc = new PublisherNotificationService({ mail: mail as any, portalUrl: 'https://x.test' });
    await svc.notifyEventRejected({
      publisher: publisher(),
      event: { eventId: 'ev-1', startDate: '2026-07-01T18:00:00Z', payload: {} } as any,
      reason: 'r',
    });
    expect(mail.sendEventRejectedEmail).toHaveBeenCalledWith(expect.objectContaining({ eventTitle: '(untitled)' }));
  });

  test('notificationsEnabled === false short-circuits', async () => {
    const mail = makeMail();
    const svc = new PublisherNotificationService({ mail: mail as any, portalUrl: 'https://x.test' });
    await svc.notifyEventRejected({
      publisher: publisher({ notificationsEnabled: false }),
      event: { eventId: 'ev-1', startDate: '2026-07-01T18:00:00Z', payload: { title: 'X' } } as any,
      reason: 'r',
    });
    expect(mail.sendEventRejectedEmail).not.toHaveBeenCalled();
  });
});
