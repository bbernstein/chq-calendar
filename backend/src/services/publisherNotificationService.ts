import type { MailService } from './mailService';
import type { PublisherRecord, StoredPublisherEvent } from '../types/publisher';
import type { IngestRunRow } from '../types/publisherIngestRun';

const MAIL_TIMEOUT_MS = 2_000;

export interface NotifyIngestRunArgs {
  publisher: PublisherRecord;
  prevRun: IngestRunRow | undefined;
  newRun: IngestRunRow;
}

export interface NotifyEventRejectedArgs {
  publisher: PublisherRecord;
  event: StoredPublisherEvent;
  reason: string | undefined;
}

export interface PublisherNotificationServiceDeps {
  mail: MailService;
  // Absolute URL to the publisher portal status page; embedded in email bodies.
  portalUrl: string;
}

export class PublisherNotificationService {
  constructor(private readonly deps: PublisherNotificationServiceDeps) {}

  async notifyIngestRunRecorded(args: NotifyIngestRunArgs): Promise<void> {
    if (args.publisher.notificationsEnabled === false) return;

    // prevRun undefined is treated as OK so the first-ever run only emails
    // on failure. This avoids a "your feed is broken" email on the first
    // schedule fire after deployment for a publisher that has never run.
    const prevOk = args.prevRun === undefined || args.prevRun.status === 'ok';
    const newOk = args.newRun.status === 'ok';

    if (prevOk && !newOk) {
      await this.guarded(() =>
        this.deps.mail.sendIngestFailureEmail({
          to: args.publisher.contactEmail,
          publisherName: args.publisher.name,
          status: args.newRun.status as Exclude<IngestRunRow['status'], 'ok'>,
          message: args.newRun.message ?? '(no message)',
          portalUrl: this.deps.portalUrl,
        }),
      );
      return;
    }
    if (!prevOk && newOk) {
      await this.guarded(() =>
        this.deps.mail.sendIngestRecoveryEmail({
          to: args.publisher.contactEmail,
          publisherName: args.publisher.name,
          counts: args.newRun.counts ?? { added: 0, updated: 0, retracted: 0, unchanged: 0 },
          portalUrl: this.deps.portalUrl,
        }),
      );
      return;
    }
    // ok→ok or fail→fail: silent.
  }

  async notifyEventRejected(args: NotifyEventRejectedArgs): Promise<void> {
    if (args.publisher.notificationsEnabled === false) return;
    const title = (args.event.payload as { title?: string } | undefined)?.title ?? '(untitled)';
    const trimmed = args.reason?.trim();
    const reason = trimmed && trimmed.length > 0 ? trimmed : undefined;
    await this.guarded(() =>
      this.deps.mail.sendEventRejectedEmail({
        to: args.publisher.contactEmail,
        publisherName: args.publisher.name,
        eventTitle: title,
        eventStartDate: args.event.startDate,
        reason,
        portalUrl: this.deps.portalUrl,
      }),
    );
  }

  // Bounded swallow-on-failure wrapper. Email is best-effort; a failed/late
  // mail call must NOT cause the caller (ingest loop, admin handler) to fail.
  // Errors and 2s+ timeouts are logged and swallowed.
  //
  // Important: when the timeout wins Promise.race, fn() keeps running as a
  // floating promise. If it rejects later (AWS SDK retry-then-fail), Node 15+
  // raises an unhandledRejection that defaults to crashing the Lambda.
  // Attach a no-op .catch BEFORE racing so a late rejection is logged and
  // swallowed instead.
  private async guarded(fn: () => Promise<unknown>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const inner = fn().catch(err => {
      console.error('[notification] mail send failed (late):', err);
      return '__failed__' as const;
    });
    try {
      const timeout = new Promise<'__timeout__'>(resolve => {
        timer = setTimeout(() => resolve('__timeout__'), MAIL_TIMEOUT_MS);
      });
      const result = await Promise.race([inner, timeout]);
      if (result === '__timeout__') {
        console.error('[notification] mail send timed out after 2s');
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
