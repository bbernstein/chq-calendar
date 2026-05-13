// Unit tests for PublisherEmailChangeService.
//
// All collaborators (registry, magic-token service, mail) are jest.fn() stubs;
// no DDB or SES contact. The tests focus on the edge-case matrix from the
// design spec section "Edge cases enforced".

import { PublisherEmailChangeService } from '../services/publisherEmailChangeService';
import { PublisherNotFoundError } from '../services/publisherRegistryService';
import type { PublisherRecord } from '../types/publisher';

function mkDeps(overrides: { fixedNow?: Date } = {}) {
  const registry = {
    get: jest.fn<Promise<PublisherRecord | null>, [string]>(),
    getByEmail: jest.fn().mockResolvedValue([]),
    setEmailChangeLock: jest.fn().mockResolvedValue(undefined),
    clearEmailChangeLock: jest.fn().mockResolvedValue(undefined),
    commitEmailChange: jest.fn().mockResolvedValue(undefined),
  };
  const tokens = {
    issueEmailChangePair: jest.fn().mockResolvedValue({
      verifyRawToken: 'V_RAW',
      cancelRawToken: 'C_RAW',
      expiresAt: 1234567890,
      payload: {
        publisherId: 'pub-1',
        oldEmail: 'old@e.com',
        newEmail: 'new@e.com',
        requestedAt: '2026-05-05T00:00:00.000Z',
      },
    }),
    consumeEmailChangeToken: jest.fn(),
    deleteEmailChangePairByPublisher: jest.fn().mockResolvedValue(0),
    findActiveEmailChangeByPublisher: jest.fn().mockResolvedValue(null),
    queryActiveEmailChangeByNewEmail: jest.fn().mockResolvedValue(null),
  };
  const mail = {
    sendEmailChangeVerify: jest.fn().mockResolvedValue({ messageId: 'm1' }),
    sendEmailChangeWarning: jest.fn().mockResolvedValue({ messageId: 'm2' }),
    sendEmailChangeCommitted: jest.fn().mockResolvedValue({ messageId: 'm3' }),
    sendEmailChangeCancelled: jest.fn().mockResolvedValue({ messageId: 'm4' }),
  };
  const now = overrides.fixedNow ?? new Date('2026-05-05T12:00:00.000Z');
  return {
    registry: registry as any,
    tokens: tokens as any,
    mail: mail as any,
    siteBaseUrl: 'https://www.chqcal.test',
    now: () => now,
  };
}

const basePublisher: PublisherRecord = {
  id: 'pub-1',
  name: 'Acme',
  contactEmail: 'old@e.com',
  sourceUrl: 'https://x.test/feed',
  sourceType: 'json',
  trustLevel: 'auto',
  enabled: true,
  createdAt: 't',
  applicationStatus: 'approved',
};

describe('PublisherEmailChangeService.initiate', () => {
  it('happy path: issues pair, sends verify to new + warning to old', async () => {
    const deps = mkDeps();
    deps.registry.get.mockResolvedValue(basePublisher);
    const svc = new PublisherEmailChangeService(deps);

    await svc.initiate({
      publisherId: 'pub-1',
      oldEmail: 'old@e.com',
      newEmail: 'NEW@e.com', // exercise normalization
    });

    // Pair issued with normalized emails
    expect(deps.tokens.issueEmailChangePair).toHaveBeenCalledWith({
      publisherId: 'pub-1',
      oldEmail: 'old@e.com',
      newEmail: 'new@e.com',
    });

    // Verify URL goes to new address
    const verifyArgs = deps.mail.sendEmailChangeVerify.mock.calls[0][0];
    expect(verifyArgs.to).toBe('new@e.com');
    expect(verifyArgs.verifyUrl).toMatch(/\/publish\/email-change\/verify\/\?token=V_RAW$/);

    // Cancel URL goes to old address
    const warnArgs = deps.mail.sendEmailChangeWarning.mock.calls[0][0];
    expect(warnArgs.to).toBe('old@e.com');
    expect(warnArgs.newEmail).toBe('new@e.com');
    expect(warnArgs.cancelUrl).toMatch(/\/publish\/email-change\/cancel\/\?token=C_RAW$/);
  });

  it('rejects same email (no-op rename) before any side effect', async () => {
    const deps = mkDeps();
    deps.registry.get.mockResolvedValue(basePublisher);
    const svc = new PublisherEmailChangeService(deps);

    await expect(svc.initiate({
      publisherId: 'pub-1',
      oldEmail: 'old@e.com',
      newEmail: 'old@e.com',
    })).rejects.toMatchObject({ code: 'same_email' });

    expect(deps.tokens.issueEmailChangePair).not.toHaveBeenCalled();
    expect(deps.mail.sendEmailChangeVerify).not.toHaveBeenCalled();
  });

  it('rejects malformed email', async () => {
    const deps = mkDeps();
    deps.registry.get.mockResolvedValue(basePublisher);
    const svc = new PublisherEmailChangeService(deps);

    await expect(svc.initiate({
      publisherId: 'pub-1',
      oldEmail: 'old@e.com',
      newEmail: 'notanemail',
    })).rejects.toMatchObject({ code: 'invalid_email' });
  });

  it('rejects when newEmail belongs to another publisher (email_in_use)', async () => {
    const deps = mkDeps();
    deps.registry.get.mockResolvedValue(basePublisher);
    deps.registry.getByEmail.mockResolvedValue([
      { ...basePublisher, id: 'pub-other', contactEmail: 'new@e.com' },
    ]);
    const svc = new PublisherEmailChangeService(deps);

    await expect(svc.initiate({
      publisherId: 'pub-1',
      oldEmail: 'old@e.com',
      newEmail: 'new@e.com',
    })).rejects.toMatchObject({ code: 'email_in_use' });

    expect(deps.tokens.issueEmailChangePair).not.toHaveBeenCalled();
  });

  it('rejects when emailChangeLockedUntil is still in the future', async () => {
    const fixedNow = new Date('2026-05-05T12:00:00.000Z');
    const deps = mkDeps({ fixedNow });
    deps.registry.get.mockResolvedValue({
      ...basePublisher,
      emailChangeLockedUntil: '2026-05-05T13:00:00.000Z', // 1h in the future
    });
    const svc = new PublisherEmailChangeService(deps);

    await expect(svc.initiate({
      publisherId: 'pub-1',
      oldEmail: 'old@e.com',
      newEmail: 'new@e.com',
    })).rejects.toMatchObject({
      code: 'locked',
      details: { lockedUntil: '2026-05-05T13:00:00.000Z' },
    });
    expect(deps.tokens.issueEmailChangePair).not.toHaveBeenCalled();
  });

  it('passes through when emailChangeLockedUntil is in the past (auto-expired)', async () => {
    const fixedNow = new Date('2026-05-05T12:00:00.000Z');
    const deps = mkDeps({ fixedNow });
    deps.registry.get.mockResolvedValue({
      ...basePublisher,
      emailChangeLockedUntil: '2026-05-04T12:00:00.000Z', // 1d in the past
    });
    const svc = new PublisherEmailChangeService(deps);

    await svc.initiate({
      publisherId: 'pub-1',
      oldEmail: 'old@e.com',
      newEmail: 'new@e.com',
    });
    expect(deps.tokens.issueEmailChangePair).toHaveBeenCalled();
  });

  it('rejects when another publisher has a pending change targeting this email', async () => {
    const deps = mkDeps();
    deps.registry.get.mockResolvedValue(basePublisher);
    deps.tokens.queryActiveEmailChangeByNewEmail.mockResolvedValue({
      tokenHash: 'h',
      purpose: 'email_change_verify',
      email: 'new@e.com',
      publisherId: 'pub-other',
      emailChangePayload: {
        publisherId: 'pub-other',
        oldEmail: 'someoneelse@e.com',
        newEmail: 'new@e.com',
        requestedAt: '2026-05-04T00:00:00Z',
      },
      createdAt: 't',
      expiresAt: 9999999999,
    });
    const svc = new PublisherEmailChangeService(deps);

    await expect(svc.initiate({
      publisherId: 'pub-1',
      oldEmail: 'old@e.com',
      newEmail: 'new@e.com',
    })).rejects.toMatchObject({ code: 'email_in_use' });
  });

  it('supersedes a prior pending pair for THIS publisher (deletes before issuing)', async () => {
    const deps = mkDeps();
    deps.registry.get.mockResolvedValue(basePublisher);
    const svc = new PublisherEmailChangeService(deps);

    await svc.initiate({
      publisherId: 'pub-1',
      oldEmail: 'old@e.com',
      newEmail: 'new@e.com',
    });

    expect(deps.tokens.deleteEmailChangePairByPublisher).toHaveBeenCalledWith('pub-1');
    // Order matters: delete first, then issue.
    const deleteOrder = deps.tokens.deleteEmailChangePairByPublisher.mock.invocationCallOrder[0];
    const issueOrder = deps.tokens.issueEmailChangePair.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(issueOrder);
  });

  it('does not raise email_in_use when only this publisher is in the matching set', async () => {
    // getByEmail might surface our own row for the same address (would only
    // happen if newEmail equals oldEmail with weird normalization); we should
    // raise same_email, not email_in_use.
    const deps = mkDeps();
    deps.registry.get.mockResolvedValue(basePublisher);
    deps.registry.getByEmail.mockResolvedValue([basePublisher]);
    const svc = new PublisherEmailChangeService(deps);

    await expect(svc.initiate({
      publisherId: 'pub-1',
      oldEmail: 'old@e.com',
      newEmail: 'something-else@e.com', // doesn't equal oldEmail
    })).rejects.toMatchObject({ code: 'same_email' });
  });
});

describe('PublisherEmailChangeService.verifyByNewAddress', () => {
  function mkConsumeOk() {
    return {
      ok: true,
      row: {
        tokenHash: 'h',
        purpose: 'email_change_verify',
        email: 'new@e.com',
        publisherId: 'pub-1',
        emailChangePayload: {
          publisherId: 'pub-1',
          oldEmail: 'old@e.com',
          newEmail: 'new@e.com',
          requestedAt: '2026-05-05T00:00:00.000Z',
        },
        createdAt: 't',
        expiresAt: 9999999999,
      },
    };
  }

  it('happy path: commits registry, deletes pair, notifies both addresses', async () => {
    const deps = mkDeps();
    deps.tokens.consumeEmailChangeToken.mockResolvedValue(mkConsumeOk());
    deps.registry.getByEmail.mockResolvedValue([]); // race-clear
    const svc = new PublisherEmailChangeService(deps);

    const r = await svc.verifyByNewAddress('V_RAW');
    expect(r).toEqual({ kind: 'ok', publisherId: 'pub-1', newEmail: 'new@e.com' });

    expect(deps.registry.commitEmailChange).toHaveBeenCalledWith('pub-1', 'new@e.com');
    expect(deps.tokens.deleteEmailChangePairByPublisher).toHaveBeenCalledWith('pub-1');
    // Both addresses notified
    const tos = deps.mail.sendEmailChangeCommitted.mock.calls.map((c: any[]) => c[0].to);
    expect(tos).toEqual(expect.arrayContaining(['old@e.com', 'new@e.com']));
    expect(tos.length).toBe(2);
  });

  it('returns expired when token is expired', async () => {
    const deps = mkDeps();
    deps.tokens.consumeEmailChangeToken.mockResolvedValue({ ok: false, reason: 'expired' });
    const svc = new PublisherEmailChangeService(deps);
    const r = await svc.verifyByNewAddress('V_RAW');
    expect(r).toEqual({ kind: 'expired' });
    expect(deps.registry.commitEmailChange).not.toHaveBeenCalled();
  });

  it('returns already_used on not_found (double-click loser)', async () => {
    const deps = mkDeps();
    deps.tokens.consumeEmailChangeToken.mockResolvedValue({ ok: false, reason: 'not_found' });
    const svc = new PublisherEmailChangeService(deps);
    const r = await svc.verifyByNewAddress('V_RAW');
    expect(r).toEqual({ kind: 'already_used' });
  });

  it('returns already_used on wrong_purpose (cancel token at verify endpoint)', async () => {
    const deps = mkDeps();
    deps.tokens.consumeEmailChangeToken.mockResolvedValue({ ok: false, reason: 'wrong_purpose' });
    const svc = new PublisherEmailChangeService(deps);
    const r = await svc.verifyByNewAddress('V_RAW');
    expect(r).toEqual({ kind: 'already_used' });
  });

  it('returns email_taken when another publisher has the new email at commit time', async () => {
    const deps = mkDeps();
    deps.tokens.consumeEmailChangeToken.mockResolvedValue(mkConsumeOk());
    deps.registry.getByEmail.mockResolvedValue([
      { ...basePublisher, id: 'pub-someone-else', contactEmail: 'new@e.com' },
    ]);
    const svc = new PublisherEmailChangeService(deps);

    const r = await svc.verifyByNewAddress('V_RAW');
    expect(r).toEqual({ kind: 'email_taken' });
    expect(deps.registry.commitEmailChange).not.toHaveBeenCalled();
    // peers cleaned even on the lost-race path
    expect(deps.tokens.deleteEmailChangePairByPublisher).toHaveBeenCalledWith('pub-1');
  });

  it('returns ok even if peer-row cleanup throws after commit', async () => {
    // Post-commit cleanup is best-effort: a Scan failure on the magic-token
    // table must not turn an authoritative commit into a user-facing 500.
    const deps = mkDeps();
    deps.tokens.consumeEmailChangeToken.mockResolvedValue(mkConsumeOk());
    deps.registry.getByEmail.mockResolvedValue([]); // race-clear
    deps.tokens.deleteEmailChangePairByPublisher = jest.fn(async () => {
      throw new Error('simulated DDB scan failure');
    });
    const svc = new PublisherEmailChangeService(deps);

    const r = await svc.verifyByNewAddress('V_RAW');
    expect(r).toEqual({ kind: 'ok', publisherId: 'pub-1', newEmail: 'new@e.com' });
    expect(deps.registry.commitEmailChange).toHaveBeenCalledWith('pub-1', 'new@e.com');
    // Notifications should still have been attempted despite cleanup failure.
    expect(deps.mail.sendEmailChangeCommitted).toHaveBeenCalledTimes(2);
  });

  it('returns publisher_missing when commitEmailChange throws PublisherNotFoundError', async () => {
    // Race: the publisher row was deleted between pair issuance (24h ago) and
    // the new-address click. The registry helper's attribute_exists guard
    // catches it before we resurrect a partial row. We surface this as a
    // distinct kind so the verify landing page can render the correct error
    // (rather than "ok" when nothing actually committed).
    const deps = mkDeps();
    deps.tokens.consumeEmailChangeToken.mockResolvedValue(mkConsumeOk());
    deps.registry.getByEmail.mockResolvedValue([]); // race-clear
    deps.registry.commitEmailChange.mockRejectedValueOnce(
      new PublisherNotFoundError('pub-1', 'commitEmailChange'),
    );
    const svc = new PublisherEmailChangeService(deps);

    const r = await svc.verifyByNewAddress('V_RAW');
    expect(r).toEqual({ kind: 'publisher_missing' });
    // No "committed" notifications should fire on the failure path.
    expect(deps.mail.sendEmailChangeCommitted).not.toHaveBeenCalled();
    // Best-effort cleanup of orphan peer rows still happens.
    expect(deps.tokens.deleteEmailChangePairByPublisher).toHaveBeenCalledWith('pub-1');
  });

  it('returns ok even if confirmation emails throw', async () => {
    // Post-commit notification is best-effort: an SES outage must not turn
    // an authoritative commit into a user-facing 500.
    const deps = mkDeps();
    deps.tokens.consumeEmailChangeToken.mockResolvedValue(mkConsumeOk());
    deps.registry.getByEmail.mockResolvedValue([]); // race-clear
    deps.mail.sendEmailChangeCommitted = jest.fn(async () => {
      throw new Error('SES outage');
    });
    const svc = new PublisherEmailChangeService(deps);

    const r = await svc.verifyByNewAddress('V_RAW');
    expect(r.kind).toBe('ok');
    expect(deps.registry.commitEmailChange).toHaveBeenCalledWith('pub-1', 'new@e.com');
  });
});

describe('PublisherEmailChangeService.cancelByOldAddress', () => {
  function mkConsumeOk() {
    return {
      ok: true,
      row: {
        tokenHash: 'h',
        purpose: 'email_change_cancel',
        email: 'old@e.com',
        publisherId: 'pub-1',
        emailChangePayload: {
          publisherId: 'pub-1',
          oldEmail: 'old@e.com',
          newEmail: 'new@e.com',
          requestedAt: '2026-05-05T00:00:00.000Z',
        },
        createdAt: 't',
        expiresAt: 9999999999,
      },
    };
  }

  it('happy path: deletes pair, writes 24h lock, notifies both addresses', async () => {
    const fixedNow = new Date('2026-05-05T12:00:00.000Z');
    const deps = mkDeps({ fixedNow });
    deps.tokens.consumeEmailChangeToken.mockResolvedValue(mkConsumeOk());
    const svc = new PublisherEmailChangeService(deps);

    const r = await svc.cancelByOldAddress('C_RAW');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.lockedUntil).toBe('2026-05-06T12:00:00.000Z'); // +24h
    }

    expect(deps.tokens.deleteEmailChangePairByPublisher).toHaveBeenCalledWith('pub-1');
    expect(deps.registry.setEmailChangeLock).toHaveBeenCalledWith(
      'pub-1', '2026-05-06T12:00:00.000Z',
    );
    const tos = deps.mail.sendEmailChangeCancelled.mock.calls.map((c: any[]) => c[0].to);
    expect(tos).toEqual(expect.arrayContaining(['old@e.com', 'new@e.com']));
    expect(tos.length).toBe(2);
  });

  it('returns expired without writing lock when token expired', async () => {
    const deps = mkDeps();
    deps.tokens.consumeEmailChangeToken.mockResolvedValue({ ok: false, reason: 'expired' });
    const svc = new PublisherEmailChangeService(deps);
    const r = await svc.cancelByOldAddress('C_RAW');
    expect(r).toEqual({ kind: 'expired' });
    expect(deps.registry.setEmailChangeLock).not.toHaveBeenCalled();
  });

  it('returns already_used on double-click (loser)', async () => {
    const deps = mkDeps();
    deps.tokens.consumeEmailChangeToken.mockResolvedValue({ ok: false, reason: 'not_found' });
    const svc = new PublisherEmailChangeService(deps);
    const r = await svc.cancelByOldAddress('C_RAW');
    expect(r).toEqual({ kind: 'already_used' });
    expect(deps.registry.setEmailChangeLock).not.toHaveBeenCalled();
  });

  it('returns publisher_missing when setEmailChangeLock throws PublisherNotFoundError', async () => {
    // Race: row deleted between pair issuance and the cancel click. Pair was
    // already cleaned up; the lock helper's guard catches the resurrect risk
    // and we surface a distinct kind so the cancel landing page renders the
    // correct outcome.
    const deps = mkDeps();
    deps.tokens.consumeEmailChangeToken.mockResolvedValue(mkConsumeOk());
    deps.registry.setEmailChangeLock.mockRejectedValueOnce(
      new PublisherNotFoundError('pub-1', 'setEmailChangeLock'),
    );
    const svc = new PublisherEmailChangeService(deps);

    const r = await svc.cancelByOldAddress('C_RAW');
    expect(r).toEqual({ kind: 'publisher_missing' });
    expect(deps.mail.sendEmailChangeCancelled).not.toHaveBeenCalled();
  });
});

describe('PublisherEmailChangeService.cancelBySelf', () => {
  it('deletes pending pair without setting any lock', async () => {
    const deps = mkDeps();
    const svc = new PublisherEmailChangeService(deps);
    await svc.cancelBySelf({ publisherId: 'pub-1' });
    expect(deps.tokens.deleteEmailChangePairByPublisher).toHaveBeenCalledWith('pub-1');
    expect(deps.registry.setEmailChangeLock).not.toHaveBeenCalled();
  });

  it('is idempotent when no pending pair exists', async () => {
    const deps = mkDeps();
    deps.tokens.deleteEmailChangePairByPublisher.mockResolvedValue(0);
    const svc = new PublisherEmailChangeService(deps);
    await expect(svc.cancelBySelf({ publisherId: 'pub-1' })).resolves.toBeUndefined();
  });
});

describe('PublisherEmailChangeService.getPendingForPublisher', () => {
  it('returns the pending change as { newEmail, expiresAt } when one exists', async () => {
    const deps = mkDeps();
    deps.tokens.findActiveEmailChangeByPublisher.mockResolvedValue({
      tokenHash: 'h',
      purpose: 'email_change_verify',
      email: 'new@e.com',
      publisherId: 'pub-1',
      emailChangePayload: {
        publisherId: 'pub-1',
        oldEmail: 'old@e.com',
        newEmail: 'new@e.com',
        requestedAt: '2026-05-05T00:00:00.000Z',
      },
      createdAt: 't',
      expiresAt: 1717200000, // 2024-06-01 in epoch seconds — valid epoch ts
    });
    const svc = new PublisherEmailChangeService(deps);
    const r = await svc.getPendingForPublisher('pub-1');
    expect(r).toEqual({
      newEmail: 'new@e.com',
      expiresAt: new Date(1717200000 * 1000).toISOString(),
    });
  });

  it('returns null when no pending change exists', async () => {
    const deps = mkDeps();
    deps.tokens.findActiveEmailChangeByPublisher.mockResolvedValue(null);
    const svc = new PublisherEmailChangeService(deps);
    const r = await svc.getPendingForPublisher('pub-1');
    expect(r).toBeNull();
  });
});
