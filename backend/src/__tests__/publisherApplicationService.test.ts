jest.mock('../services/publisherSecretCache', () => ({
  getPublisherJwtSecret: jest.fn(async () => 'test-secret-do-not-use-in-prod'),
  _resetPublisherSecretCacheForTests: jest.fn(),
}));

import { PublisherApplicationService, EmailAlreadyInUseError } from '../services/publisherApplicationService';
import type { ApplyFormPayload, PublisherRecord } from '../types/publisher';

const mkDeps = () => {
  const registry = {
    get: jest.fn(),
    // Default to "no existing row" so the apply uniqueness gate (Phase 3)
    // is satisfied by default. Tests that exercise the gate explicitly
    // override this with the seeded rows they want.
    getByEmail: jest.fn().mockResolvedValue([]),
    upsert: jest.fn(),
  };
  const tokens = {
    issueToken: jest.fn(),
    consumeToken: jest.fn(),
    // Phase 4 — pending-email-change uniqueness gate. Default to "no
    // pending change" so existing tests are unaffected.
    queryActiveEmailChangeByNewEmail: jest.fn().mockResolvedValue(null),
  };
  const mail = {
    sendApplyMagicLink: jest.fn().mockResolvedValue({ messageId: 'mid' }),
    sendLoginMagicLink: jest.fn().mockResolvedValue({ messageId: 'mid' }),
  };
  return {
    registry: registry as any,
    tokens: tokens as any,
    mail: mail as any,
    siteBaseUrl: 'https://www.chqcal.test',
  };
};

const validPayload: ApplyFormPayload = {
  name: 'Acme Events',
  email: 'Pub@Example.COM',
  organization: 'Acme Corp',
  sourceUrl: 'https://acme.example.com/feed.json',
  sourceType: 'json',
  notes: 'Hi, please approve us',
};

describe('PublisherApplicationService — apply flow', () => {
  it('requestApply issues a token, sends email with verify URL, returns ok', async () => {
    const deps = mkDeps();
    deps.tokens.issueToken.mockResolvedValue({ rawToken: 'rawtok123', expiresAt: 9999 });
    const svc = new PublisherApplicationService(deps);

    const r = await svc.requestApply({ payload: validPayload });
    expect(r).toEqual({ ok: true });

    // Token issued with normalized email.
    expect(deps.tokens.issueToken).toHaveBeenCalledWith({
      purpose: 'apply',
      email: 'pub@example.com',
      applyPayload: { ...validPayload, email: 'pub@example.com' },
    });

    // Email sent with the magic-link URL.
    const [to, name, url] = deps.mail.sendApplyMagicLink.mock.calls[0];
    expect(to).toBe('pub@example.com');
    expect(name).toBe('Acme Events');
    expect(url).toBe('https://www.chqcal.test/publish/verify/?token=rawtok123&purpose=apply');
  });

  it('requestApply rejects missing name', async () => {
    const deps = mkDeps();
    const svc = new PublisherApplicationService(deps);
    const r = await svc.requestApply({ payload: { ...validPayload, name: '' } });
    expect(r).toEqual(expect.objectContaining({ ok: false, field: 'name' }));
    expect(deps.tokens.issueToken).not.toHaveBeenCalled();
  });

  it('requestApply rejects malformed email', async () => {
    const deps = mkDeps();
    const svc = new PublisherApplicationService(deps);
    const r = await svc.requestApply({ payload: { ...validPayload, email: 'notanemail' } });
    expect(r).toEqual(expect.objectContaining({ ok: false, field: 'email' }));
  });

  it('requestApply rejects localhost source URL via urlGuard', async () => {
    const deps = mkDeps();
    const svc = new PublisherApplicationService(deps);
    const r = await svc.requestApply({
      payload: { ...validPayload, sourceUrl: 'http://localhost/feed.json' },
    });
    expect(r).toEqual(expect.objectContaining({ ok: false, field: 'sourceUrl' }));
  });

  it('requestApply rejects invalid sourceType', async () => {
    const deps = mkDeps();
    const svc = new PublisherApplicationService(deps);
    const r = await svc.requestApply({
      payload: { ...validPayload, sourceType: 'xml' as any },
    });
    expect(r).toEqual(expect.objectContaining({ ok: false, field: 'sourceType' }));
  });

  it('verifyApply consumes token, creates pending publisher row, issues JWT', async () => {
    const deps = mkDeps();
    deps.tokens.consumeToken.mockResolvedValue({
      ok: true,
      row: {
        tokenHash: 'h',
        purpose: 'apply',
        email: 'pub@example.com',
        applyPayload: { ...validPayload, email: 'pub@example.com' },
        createdAt: 't',
        expiresAt: 999,
      },
    });
    deps.registry.upsert.mockResolvedValue(undefined);

    const svc = new PublisherApplicationService(deps);
    const r = await svc.verifyApply('rawtok123');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.publisherId).toMatch(/^pub-/);
      expect(r.email).toBe('pub@example.com');
      expect(typeof r.jwt).toBe('string');
      expect(r.jwt.split('.').length).toBe(3); // header.payload.signature
    }

    const upsertCall: PublisherRecord = deps.registry.upsert.mock.calls[0][0];
    expect(upsertCall.applicationStatus).toBe('pending');
    expect(upsertCall.enabled).toBe(false); // disabled until approved
    expect(upsertCall.contactEmail).toBe('pub@example.com');
    expect(upsertCall.organization).toBe('Acme Corp');
    expect(upsertCall.applicantNotes).toBe('Hi, please approve us');
  });

  it('verifyApply propagates token consume errors', async () => {
    const deps = mkDeps();
    deps.tokens.consumeToken.mockResolvedValue({ ok: false, reason: 'expired' });
    const svc = new PublisherApplicationService(deps);
    const r = await svc.verifyApply('rawtok');
    expect(r).toEqual({ ok: false, reason: 'expired' });
    expect(deps.registry.upsert).not.toHaveBeenCalled();
  });

  it('verifyApply returns malformed_payload if token row has no applyPayload', async () => {
    const deps = mkDeps();
    deps.tokens.consumeToken.mockResolvedValue({
      ok: true,
      row: { tokenHash: 'h', purpose: 'apply', email: 'a@b', createdAt: 't', expiresAt: 999 },
    });
    const svc = new PublisherApplicationService(deps);
    const r = await svc.verifyApply('rawtok');
    expect(r).toEqual({ ok: false, reason: 'malformed_payload' });
  });
});

describe('requestApply — email uniqueness', () => {
  // Phase 3 — apply submissions whose email already maps to ANY publisher
  // row (approved, pending, or rejected) must be rejected before any side
  // effect: no token issued, no email sent, no DB row written.
  // The handler converts this into a generic 400 to avoid leaking which
  // status the address holds.

  const seededRow = (overrides: Partial<PublisherRecord>): PublisherRecord => ({
    id: 'pub-existing',
    name: 'Existing',
    contactEmail: 'taken@e.com',
    sourceUrl: 'https://x.test/feed',
    sourceType: 'json',
    trustLevel: 'auto',
    enabled: true,
    createdAt: 't',
    ...overrides,
  });

  const apply = (email: string): { payload: ApplyFormPayload } => ({
    payload: { ...validPayload, email },
  });

  it('rejects when an approved publisher already uses this email', async () => {
    const deps = mkDeps();
    deps.registry.getByEmail.mockResolvedValue([
      seededRow({ applicationStatus: 'approved' }),
    ]);
    const svc = new PublisherApplicationService(deps);

    await expect(svc.requestApply(apply('taken@e.com')))
      .rejects.toBeInstanceOf(EmailAlreadyInUseError);

    // No side effects.
    expect(deps.tokens.issueToken).not.toHaveBeenCalled();
    expect(deps.mail.sendApplyMagicLink).not.toHaveBeenCalled();
    expect(deps.registry.upsert).not.toHaveBeenCalled();
  });

  it('rejects when a pending publisher already uses this email', async () => {
    const deps = mkDeps();
    deps.registry.getByEmail.mockResolvedValue([
      seededRow({ applicationStatus: 'pending', enabled: false, trustLevel: 'review' }),
    ]);
    const svc = new PublisherApplicationService(deps);

    await expect(svc.requestApply(apply('taken@e.com')))
      .rejects.toBeInstanceOf(EmailAlreadyInUseError);
    expect(deps.tokens.issueToken).not.toHaveBeenCalled();
    expect(deps.mail.sendApplyMagicLink).not.toHaveBeenCalled();
  });

  it('rejects when a rejected publisher already uses this email', async () => {
    const deps = mkDeps();
    deps.registry.getByEmail.mockResolvedValue([
      seededRow({
        applicationStatus: 'rejected',
        enabled: false,
        trustLevel: 'review',
        rejectionReason: 'spam-looking',
      }),
    ]);
    const svc = new PublisherApplicationService(deps);

    await expect(svc.requestApply(apply('taken@e.com')))
      .rejects.toBeInstanceOf(EmailAlreadyInUseError);
    expect(deps.tokens.issueToken).not.toHaveBeenCalled();
  });

  it('treats email comparison case-insensitively', async () => {
    const deps = mkDeps();
    // Registry stores normalized lowercase. The submission uses uppercase;
    // the service must normalize before lookup so the gate still fires.
    deps.registry.getByEmail.mockResolvedValue([
      seededRow({ applicationStatus: 'approved' }),
    ]);
    const svc = new PublisherApplicationService(deps);

    await expect(svc.requestApply(apply('TAKEN@E.COM')))
      .rejects.toBeInstanceOf(EmailAlreadyInUseError);

    // Lookup happened with the lowercased form.
    expect(deps.registry.getByEmail).toHaveBeenCalledWith('taken@e.com');
  });

  it('does NOT throw when the email is unused — happy path proceeds', async () => {
    const deps = mkDeps();
    deps.registry.getByEmail.mockResolvedValue([]);
    deps.tokens.issueToken.mockResolvedValue({ rawToken: 'rawtok', expiresAt: 9 });
    const svc = new PublisherApplicationService(deps);

    const r = await svc.requestApply(apply('fresh@e.com'));
    expect(r).toEqual({ ok: true });
    expect(deps.tokens.issueToken).toHaveBeenCalledTimes(1);
    expect(deps.mail.sendApplyMagicLink).toHaveBeenCalledTimes(1);
  });

  // Phase 4 — also reject when there's an in-flight email-change targeting
  // this address. Otherwise an applicant could race a publisher's verify
  // step for the same identity.
  it('rejects when a pending email_change_verify targets this address', async () => {
    const deps = mkDeps();
    deps.registry.getByEmail.mockResolvedValue([]); // registry clean
    deps.tokens.queryActiveEmailChangeByNewEmail.mockResolvedValue({
      tokenHash: 'h',
      purpose: 'email_change_verify',
      email: 'fresh@e.com',
      publisherId: 'pub-someone-else',
      emailChangePayload: {
        publisherId: 'pub-someone-else',
        oldEmail: 'old@e.com',
        newEmail: 'fresh@e.com',
        requestedAt: '2026-05-05T00:00:00Z',
      },
      createdAt: 't',
      expiresAt: 9999999999,
    });
    const svc = new PublisherApplicationService(deps);

    await expect(svc.requestApply(apply('fresh@e.com')))
      .rejects.toBeInstanceOf(EmailAlreadyInUseError);

    expect(deps.tokens.queryActiveEmailChangeByNewEmail).toHaveBeenCalledWith('fresh@e.com');
    expect(deps.tokens.issueToken).not.toHaveBeenCalled();
    expect(deps.mail.sendApplyMagicLink).not.toHaveBeenCalled();
  });
});

describe('PublisherApplicationService — login flow', () => {
  it('requestLogin sends email when an approved publisher exists for the email', async () => {
    const deps = mkDeps();
    const approvedPub: PublisherRecord = {
      id: 'pub-1',
      name: 'Approved',
      contactEmail: 'a@b.com',
      sourceUrl: 'https://x.test/feed',
      sourceType: 'json',
      trustLevel: 'auto',
      enabled: true,
      createdAt: 't',
      applicationStatus: 'approved',
    };
    deps.registry.getByEmail.mockResolvedValue([approvedPub]);
    deps.tokens.issueToken.mockResolvedValue({ rawToken: 'tok', expiresAt: 9 });
    const svc = new PublisherApplicationService(deps);

    const r = await svc.requestLogin('a@b.com');
    expect(r).toEqual({ ok: true });
    expect(deps.mail.sendLoginMagicLink).toHaveBeenCalledTimes(1);
    expect(deps.tokens.issueToken).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'login',
      publisherId: 'pub-1',
    }));
  });

  it('requestLogin treats existing publisher with no applicationStatus as approved', async () => {
    const deps = mkDeps();
    deps.registry.getByEmail.mockResolvedValue([{
      id: 'legacy',
      name: 'Legacy',
      contactEmail: 'a@b.com',
      sourceUrl: 'u',
      sourceType: 'json',
      trustLevel: 'auto',
      enabled: true,
      createdAt: 't',
      // no applicationStatus
    }]);
    deps.tokens.issueToken.mockResolvedValue({ rawToken: 'tok', expiresAt: 9 });
    const svc = new PublisherApplicationService(deps);
    await svc.requestLogin('a@b.com');
    expect(deps.mail.sendLoginMagicLink).toHaveBeenCalled();
  });

  it('requestLogin sends a magic link to a pending applicant (Phase C — pending applicants need to view their status)', async () => {
    const deps = mkDeps();
    deps.registry.getByEmail.mockResolvedValue([{
      id: 'pending',
      name: 'Pending',
      contactEmail: 'a@b.com',
      sourceUrl: 'u',
      sourceType: 'json',
      trustLevel: 'review',
      enabled: false,
      createdAt: 't',
      applicationStatus: 'pending',
    }]);
    deps.tokens.issueToken.mockResolvedValue({ rawToken: 'tok', expiresAt: 9 });
    const svc = new PublisherApplicationService(deps);
    const r = await svc.requestLogin('a@b.com');
    expect(r).toEqual({ ok: true });
    expect(deps.mail.sendLoginMagicLink).toHaveBeenCalledTimes(1);
    expect(deps.tokens.issueToken).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'login',
      publisherId: 'pending',
    }));
  });

  it('requestLogin sends a magic link to a rejected applicant so they can see the rejection reason', async () => {
    const deps = mkDeps();
    deps.registry.getByEmail.mockResolvedValue([{
      id: 'rejected',
      name: 'Rejected',
      contactEmail: 'a@b.com',
      sourceUrl: 'u',
      sourceType: 'json',
      trustLevel: 'review',
      enabled: false,
      createdAt: 't',
      applicationStatus: 'rejected',
      rejectionReason: 'spam-looking',
    }]);
    deps.tokens.issueToken.mockResolvedValue({ rawToken: 'tok', expiresAt: 9 });
    const svc = new PublisherApplicationService(deps);
    await svc.requestLogin('a@b.com');
    expect(deps.mail.sendLoginMagicLink).toHaveBeenCalledTimes(1);
  });

  it('requestLogin prefers an approved row when both approved and pending share an email', async () => {
    // Real-world scenario: a publisher reapplies (new pending row) while
    // their approved account is still active. Login should route them to
    // the approved account.
    const deps = mkDeps();
    deps.registry.getByEmail.mockResolvedValue([
      {
        id: 'pending-new',
        name: 'New App',
        contactEmail: 'a@b.com',
        sourceUrl: 'u', sourceType: 'json', trustLevel: 'review',
        enabled: false, createdAt: 't',
        applicationStatus: 'pending',
      },
      {
        id: 'approved-old',
        name: 'Old Account',
        contactEmail: 'a@b.com',
        sourceUrl: 'u', sourceType: 'json', trustLevel: 'auto',
        enabled: true, createdAt: 't',
        applicationStatus: 'approved',
      },
    ]);
    deps.tokens.issueToken.mockResolvedValue({ rawToken: 'tok', expiresAt: 9 });
    const svc = new PublisherApplicationService(deps);
    await svc.requestLogin('a@b.com');
    expect(deps.tokens.issueToken).toHaveBeenCalledWith(expect.objectContaining({
      publisherId: 'approved-old',
    }));
  });

  it('requestLogin returns ok but sends no email for unknown email (anti-enumeration)', async () => {
    const deps = mkDeps();
    deps.registry.getByEmail.mockResolvedValue([]);
    const svc = new PublisherApplicationService(deps);
    const r = await svc.requestLogin('nobody@example.com');
    expect(r).toEqual({ ok: true });
    expect(deps.mail.sendLoginMagicLink).not.toHaveBeenCalled();
  });

  it('requestLogin returns ok but sends no email for malformed email (anti-enumeration)', async () => {
    const deps = mkDeps();
    const svc = new PublisherApplicationService(deps);
    const r = await svc.requestLogin('notanemail');
    expect(r).toEqual({ ok: true });
    expect(deps.registry.getByEmail).not.toHaveBeenCalled();
    expect(deps.mail.sendLoginMagicLink).not.toHaveBeenCalled();
  });

  it('verifyLogin issues a JWT for an approved publisher', async () => {
    const deps = mkDeps();
    deps.tokens.consumeToken.mockResolvedValue({
      ok: true,
      row: { tokenHash: 'h', purpose: 'login', email: 'a@b', publisherId: 'pub-1', createdAt: 't', expiresAt: 9 },
    });
    deps.registry.get.mockResolvedValue({
      id: 'pub-1',
      name: 'X',
      contactEmail: 'a@b.com',
      sourceUrl: 'u',
      sourceType: 'json',
      trustLevel: 'auto',
      enabled: true,
      createdAt: 't',
      applicationStatus: 'approved',
    });
    const svc = new PublisherApplicationService(deps);
    const r = await svc.verifyLogin('rawtok');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.publisherId).toBe('pub-1');
      expect(typeof r.jwt).toBe('string');
    }
  });

  it('verifyLogin returns publisher_missing if registry lookup fails', async () => {
    const deps = mkDeps();
    deps.tokens.consumeToken.mockResolvedValue({
      ok: true,
      row: { tokenHash: 'h', purpose: 'login', email: 'a@b', publisherId: 'gone', createdAt: 't', expiresAt: 9 },
    });
    deps.registry.get.mockResolvedValue(null);
    const svc = new PublisherApplicationService(deps);
    const r = await svc.verifyLogin('rawtok');
    expect(r).toEqual({ ok: false, reason: 'publisher_missing' });
  });
});
