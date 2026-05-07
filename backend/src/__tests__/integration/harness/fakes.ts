// Fake collaborators used by the integration harness:
//   - ClockController: deterministic clock the harness can advance
//   - MailCapture: in-memory `MailService` implementation that records sends
//   - FakeFeedFetcher: matches `fetchAndParseFeed` signature; per-publisher results
//   - FakeLambdaInvoker: in-process Lambda invoker that calls runIngest()
//   - FakeRateLimiter: an in-memory limiter that uses the harness clock
//
// These are pure objects — no module mocking happens here. The harness wires
// them into the real services via constructor injection or via the
// `_setXxxForTests` hooks the production handlers expose.

import type {
  MailService,
  ApprovalEmailOpts,
  RejectionEmailOpts,
  EmailChangeVerifyOpts,
  EmailChangeWarningOpts,
  EmailChangeCommittedOpts,
  EmailChangeCancelledOpts,
  SelfDisabledConfirmationOpts,
  IngestFailureEmailOpts,
  IngestRecoveryEmailOpts,
  EventRejectedEmailOpts,
} from '../../../services/mailService';
import type {
  RateLimiter,
  RateLimitOptions,
  RateLimitDecision,
} from '../../../services/rateLimitService';
import type {
  FetchFeedInput,
  FetchFeedOutput,
} from '../../../services/publisherFeedFetcher';
import type { PublisherRecord } from '../../../types/publisher';

// ─── Clock ──────────────────────────────────────────────────────────────

export class ClockController {
  private current: Date;
  constructor(now: Date | string) {
    this.current = typeof now === 'string' ? new Date(now) : now;
  }
  get now(): Date { return new Date(this.current); }
  /** Returns ms since epoch, suitable for `() => Date.now()` callers. */
  nowMs(): number { return this.current.getTime(); }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(date: Date | string): void {
    this.current = typeof date === 'string' ? new Date(date) : date;
  }
}

// ─── Mail capture ───────────────────────────────────────────────────────

export type SentMailKind =
  | 'apply'
  | 'login'
  | 'approval'
  | 'rejection'
  | 'email_change_verify'
  | 'email_change_warning'
  | 'email_change_committed'
  | 'email_change_cancelled'
  | 'self_disabled_confirmation'
  | 'ingest_failure'
  | 'ingest_recovery'
  | 'event_rejected';

export interface SentMail {
  kind: SentMailKind;
  to: string;
  data: Record<string, unknown>;
}

export class MailCapture implements MailService {
  private readonly sent: SentMail[] = [];

  async sendApplyMagicLink(toEmail: string, applicantName: string, magicLinkUrl: string) {
    this.sent.push({ kind: 'apply', to: toEmail, data: { applicantName, magicLinkUrl } });
    return { messageId: `mid-${this.sent.length}` };
  }
  async sendLoginMagicLink(toEmail: string, magicLinkUrl: string) {
    this.sent.push({ kind: 'login', to: toEmail, data: { magicLinkUrl } });
    return { messageId: `mid-${this.sent.length}` };
  }
  async sendApprovalEmail(opts: ApprovalEmailOpts) {
    this.sent.push({ kind: 'approval', to: opts.to, data: { ...opts } });
    return { messageId: `mid-${this.sent.length}` };
  }
  async sendRejectionEmail(opts: RejectionEmailOpts) {
    this.sent.push({ kind: 'rejection', to: opts.to, data: { ...opts } });
    return { messageId: `mid-${this.sent.length}` };
  }
  async sendEmailChangeVerify(opts: EmailChangeVerifyOpts) {
    this.sent.push({ kind: 'email_change_verify', to: opts.to, data: { ...opts } });
    return { messageId: `mid-${this.sent.length}` };
  }
  async sendEmailChangeWarning(opts: EmailChangeWarningOpts) {
    this.sent.push({ kind: 'email_change_warning', to: opts.to, data: { ...opts } });
    return { messageId: `mid-${this.sent.length}` };
  }
  async sendEmailChangeCommitted(opts: EmailChangeCommittedOpts) {
    this.sent.push({ kind: 'email_change_committed', to: opts.to, data: { ...opts } });
    return { messageId: `mid-${this.sent.length}` };
  }
  async sendEmailChangeCancelled(opts: EmailChangeCancelledOpts) {
    this.sent.push({ kind: 'email_change_cancelled', to: opts.to, data: { ...opts } });
    return { messageId: `mid-${this.sent.length}` };
  }
  async sendSelfDisabledConfirmation(opts: SelfDisabledConfirmationOpts) {
    this.sent.push({ kind: 'self_disabled_confirmation', to: opts.to, data: { ...opts } });
    return { messageId: `mid-${this.sent.length}` };
  }
  async sendIngestFailureEmail(opts: IngestFailureEmailOpts) {
    this.sent.push({ kind: 'ingest_failure', to: opts.to, data: { ...opts } });
    return { messageId: `mid-${this.sent.length}` };
  }
  async sendIngestRecoveryEmail(opts: IngestRecoveryEmailOpts) {
    this.sent.push({ kind: 'ingest_recovery', to: opts.to, data: { ...opts } });
    return { messageId: `mid-${this.sent.length}` };
  }
  async sendEventRejectedEmail(opts: EventRejectedEmailOpts) {
    this.sent.push({ kind: 'event_rejected', to: opts.to, data: { ...opts } });
    return { messageId: `mid-${this.sent.length}` };
  }

  all(): SentMail[] { return [...this.sent]; }
  byKind(kind: SentMailKind): SentMail[] { return this.sent.filter(m => m.kind === kind); }
  lastTo(email: string): SentMail | undefined {
    const lower = email.trim().toLowerCase();
    for (let i = this.sent.length - 1; i >= 0; i--) {
      if (this.sent[i].to.trim().toLowerCase() === lower) return this.sent[i];
    }
    return undefined;
  }
  clear(): void { this.sent.length = 0; }
}

// ─── Fake feed fetcher ──────────────────────────────────────────────────

export class FakeFeedFetcher {
  private readonly responses = new Map<string, FetchFeedOutput>();

  set(publisherId: string, result: FetchFeedOutput): void {
    this.responses.set(publisherId, result);
  }

  /** Matches `fetchAndParseFeed` signature so we can be passed as `deps.fetcher`. */
  fetchFn = async (input: FetchFeedInput): Promise<FetchFeedOutput> => {
    const r = this.responses.get(input.registeredPublisherId);
    if (!r) {
      // Default: a clean network_error so ingest's outcome path runs.
      return {
        fetchStatus: 'network_error',
        feed: null,
        report: {
          ok: false,
          errors: [{ path: '/', message: 'no fake response set' }],
          warnings: [],
        },
      };
    }
    return r;
  };
}

// Helper: build a successful FetchFeedOutput from a list of feed events.
export function feedOk(
  publisherId: string,
  publisherName: string,
  events: Array<{
    id: string;
    title?: string;
    description?: string;
    startDate: string;
    endDate: string;
    lastModified: string;
    [k: string]: unknown;
  }>,
): FetchFeedOutput {
  const safeEvents = events.map(e => ({
    title: e.title ?? `Event ${e.id}`,
    description: e.description ?? '',
    ...e,
  }));
  return {
    fetchStatus: 'ok',
    // Cast through unknown — the FeedDocument type from publisher-format
    // requires more fields, but reconcile only reads a subset.
    feed: {
      version: '1.0',
      publisher: { id: publisherId, name: publisherName },
      events: safeEvents,
    } as unknown as FetchFeedOutput['feed'],
    report: { ok: true, errors: [], warnings: [] },
  };
}

// ─── Fake Lambda invoker ────────────────────────────────────────────────
//
// The /publisher-fetch-now and /publishers/run-ingest paths call
// `lambdaClient().send(new InvokeCommand(...))`. In tests we route those
// invocations to an in-process callback so the fake ingest happens
// synchronously.

export class FakeLambdaInvoker {
  public readonly invocations: Array<{ functionName: string; payload: unknown }> = [];
  constructor(private readonly run: (payload: { singlePublisherId?: string }) => Promise<void>) {}

  async send(cmd: any): Promise<{ StatusCode: number }> {
    const input = cmd?.input ?? cmd;
    const fnName = input?.FunctionName ?? 'unknown';
    let payload: { singlePublisherId?: string } = {};
    try {
      const buf = input?.Payload;
      if (buf) {
        const text = typeof buf === 'string' ? buf : Buffer.from(buf).toString('utf8');
        payload = JSON.parse(text);
      }
    } catch {
      // ignore — leave payload empty
    }
    this.invocations.push({ functionName: fnName, payload });
    await this.run(payload);
    return { StatusCode: 202 };
  }
}

// ─── Captcha toggle ─────────────────────────────────────────────────────

export class CaptchaToggle {
  private result = true;
  pass(): void { this.result = true; }
  fail(): void { this.result = false; }
  /** Module-mock target — matches verifyCaptcha(token, action) → Promise<boolean>. */
  verify = async (_token: string, _action?: string): Promise<boolean> => this.result;
}

// ─── In-memory rate limiter (clock-driven) ─────────────────────────────
//
// The production InMemoryRateLimiter uses Date.now(), which we don't want
// in tests because we can't advance the harness clock through it. This
// variant takes the clock controller and is otherwise identical.

export class FakeRateLimiter implements RateLimiter {
  private readonly state = new Map<string, number[]>();
  constructor(private readonly clock: ClockController) {}

  async checkAndConsume(opts: RateLimitOptions): Promise<RateLimitDecision> {
    const now = this.clock.nowMs();
    const windowStart = now - opts.windowMs;
    const existing = this.state.get(opts.key) ?? [];
    const recent = existing.filter(t => t > windowStart);
    if (recent.length >= opts.max) {
      const oldest = recent[0];
      this.state.set(opts.key, recent);
      return {
        ok: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + opts.windowMs - now) / 1000)),
      };
    }
    recent.push(now);
    this.state.set(opts.key, recent);
    return { ok: true };
  }
  reset(key?: string): void {
    if (key === undefined) this.state.clear();
    else this.state.delete(key);
  }
}

// ─── Re-export PublisherRecord for actor signatures ─────────────────────
export type { PublisherRecord };
