// Tests for selfDisable (Phase 6 — publisher self-disable orchestration).
//
// Three collaborators, all stubbed: registry, magic-tokens, mail. The service
// is responsible for:
//   - Throwing 'not_found' if the row is gone.
//   - Throwing 'confirm_mismatch' if the typed slug doesn't match publisher.id.
//   - Calling registry.setSelfDisabled exactly once on success.
//   - Calling magicTokens.deleteEmailChangePairByPublisher to clear in-flight
//     email changes.
//   - Sending the confirmation email — and surviving an SES failure (we
//     don't want a flaky mail to roll back a successful disable).

import { selfDisable, SelfDisableError } from '../services/publisherSelfActionService';
import type { PublisherRecord } from '../types/publisher';

function makeRecord(overrides: Partial<PublisherRecord> = {}): PublisherRecord {
  return {
    id: 'pub-abc',
    name: 'Test Publisher',
    contactEmail: 'pub@example.com',
    sourceUrl: 'https://example.com/feed.json',
    sourceType: 'json',
    trustLevel: 'review',
    enabled: true,
    applicationStatus: 'approved',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('selfDisable', () => {
  let registry: { get: jest.Mock; setSelfDisabled: jest.Mock };
  let magicTokens: { deleteEmailChangePairByPublisher: jest.Mock };
  let mail: { sendSelfDisabledConfirmation: jest.Mock };

  beforeEach(() => {
    registry = {
      get: jest.fn(),
      setSelfDisabled: jest.fn().mockResolvedValue(undefined),
    };
    magicTokens = {
      deleteEmailChangePairByPublisher: jest.fn().mockResolvedValue(0),
    };
    mail = {
      sendSelfDisabledConfirmation: jest.fn().mockResolvedValue({ messageId: 'm1' }),
    };
  });

  it('happy path: disables, drops email-change pair, sends confirmation email', async () => {
    registry.get.mockResolvedValue(makeRecord());
    const result = await selfDisable(
      { publisherId: 'pub-abc', confirmSlug: 'pub-abc' },
      { registry: registry as any, magicTokens: magicTokens as any, mail: mail as any },
    );
    expect(registry.setSelfDisabled).toHaveBeenCalledTimes(1);
    expect(registry.setSelfDisabled).toHaveBeenCalledWith('pub-abc');
    expect(magicTokens.deleteEmailChangePairByPublisher).toHaveBeenCalledWith('pub-abc');
    expect(mail.sendSelfDisabledConfirmation).toHaveBeenCalledWith({
      to: 'pub@example.com',
      slug: 'pub-abc',
    });
    expect(result).toEqual({
      publisherId: 'pub-abc',
      slug: 'pub-abc',
      emailedTo: 'pub@example.com',
    });
  });

  it('throws SelfDisableError("not_found") when the row is gone', async () => {
    registry.get.mockResolvedValue(null);
    await expect(
      selfDisable(
        { publisherId: 'pub-abc', confirmSlug: 'pub-abc' },
        { registry: registry as any, magicTokens: magicTokens as any, mail: mail as any },
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    // No side effects on the not-found path.
    expect(registry.setSelfDisabled).not.toHaveBeenCalled();
    expect(magicTokens.deleteEmailChangePairByPublisher).not.toHaveBeenCalled();
    expect(mail.sendSelfDisabledConfirmation).not.toHaveBeenCalled();
  });

  it('throws SelfDisableError("confirm_mismatch") when confirmSlug does not match publisher.id', async () => {
    registry.get.mockResolvedValue(makeRecord({ id: 'pub-abc' }));
    await expect(
      selfDisable(
        { publisherId: 'pub-abc', confirmSlug: 'pub-xyz' },
        { registry: registry as any, magicTokens: magicTokens as any, mail: mail as any },
      ),
    ).rejects.toBeInstanceOf(SelfDisableError);
    expect(registry.setSelfDisabled).not.toHaveBeenCalled();
    expect(magicTokens.deleteEmailChangePairByPublisher).not.toHaveBeenCalled();
    expect(mail.sendSelfDisabledConfirmation).not.toHaveBeenCalled();
  });

  it('confirmSlug match is exact (case-sensitive, no whitespace tolerance)', async () => {
    registry.get.mockResolvedValue(makeRecord({ id: 'pub-abc' }));
    // Trailing whitespace is a paste-error pattern — fail closed.
    await expect(
      selfDisable(
        { publisherId: 'pub-abc', confirmSlug: 'pub-abc ' },
        { registry: registry as any, magicTokens: magicTokens as any, mail: mail as any },
      ),
    ).rejects.toMatchObject({ code: 'confirm_mismatch' });

    // Different case — also a mismatch (slugs are stored lowercase).
    await expect(
      selfDisable(
        { publisherId: 'pub-abc', confirmSlug: 'PUB-ABC' },
        { registry: registry as any, magicTokens: magicTokens as any, mail: mail as any },
      ),
    ).rejects.toMatchObject({ code: 'confirm_mismatch' });
  });

  it('mail failure does NOT prevent successful registry update (best-effort send)', async () => {
    registry.get.mockResolvedValue(makeRecord());
    mail.sendSelfDisabledConfirmation.mockRejectedValueOnce(new Error('SES throttled'));
    // Suppress the expected error log so test output stays clean.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await selfDisable(
        { publisherId: 'pub-abc', confirmSlug: 'pub-abc' },
        { registry: registry as any, magicTokens: magicTokens as any, mail: mail as any },
      );
      // Disable still succeeded.
      expect(registry.setSelfDisabled).toHaveBeenCalledTimes(1);
      expect(magicTokens.deleteEmailChangePairByPublisher).toHaveBeenCalledTimes(1);
      expect(result.publisherId).toBe('pub-abc');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('idempotent: calling twice on an already-disabled publisher repeats the same writes', async () => {
    // setSelfDisabled is itself idempotent at the DDB layer (an unconditional
    // SET); the service should call it again without inspecting the current
    // state. This guards against a "self-disable disabled" UX bug where the
    // second click silently no-ops while the row is in some half-flipped state.
    registry.get.mockResolvedValue(
      makeRecord({ enabled: false, selfDisabledAt: '2026-05-05T00:00:00.000Z' }),
    );
    await selfDisable(
      { publisherId: 'pub-abc', confirmSlug: 'pub-abc' },
      { registry: registry as any, magicTokens: magicTokens as any, mail: mail as any },
    );
    await selfDisable(
      { publisherId: 'pub-abc', confirmSlug: 'pub-abc' },
      { registry: registry as any, magicTokens: magicTokens as any, mail: mail as any },
    );
    expect(registry.setSelfDisabled).toHaveBeenCalledTimes(2);
    expect(magicTokens.deleteEmailChangePairByPublisher).toHaveBeenCalledTimes(2);
    expect(mail.sendSelfDisabledConfirmation).toHaveBeenCalledTimes(2);
  });
});
