jest.mock('../services/publisherSecretCache', () => ({
  getPublisherJwtSecret: jest.fn(async () => 'test-secret-do-not-use-in-prod'),
  _resetPublisherSecretCacheForTests: jest.fn(),
}));

import { PublisherApplicationService } from '../services/publisherApplicationService';
import type { ApplyFormPayload, PublisherRecord } from '../types/publisher';

const mkDeps = () => {
  const registry = {
    get: jest.fn(),
    getByEmail: jest.fn(),
    upsert: jest.fn(),
  };
  const tokens = {
    issueToken: jest.fn(),
    consumeToken: jest.fn(),
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

  it('requestLogin returns ok but sends no email when only pending row matches', async () => {
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
    const svc = new PublisherApplicationService(deps);
    const r = await svc.requestLogin('a@b.com');
    expect(r).toEqual({ ok: true });
    expect(deps.mail.sendLoginMagicLink).not.toHaveBeenCalled();
    expect(deps.tokens.issueToken).not.toHaveBeenCalled();
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
