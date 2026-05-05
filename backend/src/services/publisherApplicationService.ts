// Publisher portal Phase B — orchestrator for the four magic-link flows:
//
//   apply/request → email magic link → apply/verify → publisher row + JWT
//   auth/request  → email magic link → auth/verify  →                   JWT
//
// Anti-enumeration: every "request" returns { ok: true } regardless of
// whether the email matches a known publisher. The email itself is the
// side-channel. The "verify" endpoints do return outcome-specific errors
// (token not found / expired / wrong purpose) — those are not enumeration
// vectors because they only confirm what the caller already knows.

import { v4 as uuidv4 } from 'uuid';
import type { ApplyFormPayload, PublisherRecord } from '../types/publisher';
import type { PublisherRegistryService } from './publisherRegistryService';
import type { MagicTokenService } from './magicTokenService';
import type { MailService } from './mailService';
import { signPublisherJwt } from './publisherAuthService';
import { validateUrlIsPublic } from './urlGuard';

export interface PublisherApplicationServiceDeps {
  registry: PublisherRegistryService;
  tokens: MagicTokenService;
  mail: MailService;
  siteBaseUrl: string; // e.g. 'https://www.chqcal.org'
  now?: () => Date;
}

export interface RequestApplyInput {
  payload: ApplyFormPayload;
}

export type RequestApplyResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_input'; field: string; message: string };

export type VerifyApplyResult =
  | { ok: true; jwt: string; publisherId: string; email: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'wrong_purpose' | 'malformed_payload' };

export type RequestLoginResult = { ok: true };

export type VerifyLoginResult =
  | { ok: true; jwt: string; publisherId: string; email: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'wrong_purpose' | 'publisher_missing' };

export class PublisherApplicationService {
  private readonly now: () => Date;

  constructor(private readonly deps: PublisherApplicationServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  // ─── Apply flow ────────────────────────────────────────────────────────

  async requestApply(input: RequestApplyInput): Promise<RequestApplyResult> {
    const v = validateApplyPayload(input.payload);
    if (!v.ok) return v;

    // Normalize email here; the magic-token service ALSO normalizes, but
    // doing it once at the boundary keeps downstream consumers simple.
    const normalizedEmail = input.payload.email.trim().toLowerCase();
    const payload: ApplyFormPayload = { ...input.payload, email: normalizedEmail };

    const issued = await this.deps.tokens.issueToken({
      purpose: 'apply',
      email: normalizedEmail,
      applyPayload: payload,
    });

    const url = this.buildVerifyUrl('apply', issued.rawToken);
    await this.deps.mail.sendApplyMagicLink(normalizedEmail, payload.name, url);

    return { ok: true };
  }

  async verifyApply(rawToken: string): Promise<VerifyApplyResult> {
    const r = await this.deps.tokens.consumeToken(rawToken, 'apply');
    if (r.ok === false) return { ok: false, reason: r.reason };

    const apply = r.row.applyPayload;
    if (!apply) {
      // Should never happen: apply tokens are always issued with a payload.
      return { ok: false, reason: 'malformed_payload' };
    }

    const publisherId = `pub-${uuidv4()}`;
    // One reading of the clock keeps createdAt and appliedAt aligned.
    const nowIso = this.now().toISOString();
    const rec: PublisherRecord = {
      id: publisherId,
      name: apply.name,
      contactEmail: apply.email.trim().toLowerCase(),
      sourceUrl: apply.sourceUrl,
      sourceType: apply.sourceType,
      trustLevel: 'review',
      // Disabled until admin approves — prevents the ingest pipeline from
      // pulling unreviewed feeds.
      enabled: false,
      createdAt: nowIso,
      applicationStatus: 'pending',
      appliedAt: nowIso,
      organization: apply.organization,
      applicantNotes: apply.notes,
    };
    await this.deps.registry.upsert(rec);

    const jwt = await signPublisherJwt({
      publisherId,
      email: rec.contactEmail,
      tokenVersion: rec.tokenVersion ?? 0,
    });
    return { ok: true, jwt, publisherId, email: rec.contactEmail };
  }

  // ─── Login flow ────────────────────────────────────────────────────────

  // Always returns { ok: true } — never reveals whether the email matches a
  // publisher. If the email DOES match ANY publisher row (pending, approved,
  // or rejected), a login link is sent. Pending and rejected applicants need
  // to be able to sign in to /publish/status/ to see their review state — if
  // we filtered to approved only, the status page would be unreachable for
  // them once their post-apply JWT expires (7 days).
  //
  // Phase B selected the first APPROVED row defensively; Phase C broadens
  // this to "first row of any status" since the status page now handles
  // pending and rejected explicitly.
  async requestLogin(email: string): Promise<RequestLoginResult> {
    const normalized = (email ?? '').trim().toLowerCase();
    if (!isValidEmail(normalized)) {
      // Even malformed emails get an "ok" response — the only signal is that
      // we don't send an email. This intentionally matches the success path.
      return { ok: true };
    }
    const matches = await this.deps.registry.getByEmail(normalized);
    // Prefer an approved (or legacy admin-created, no applicationStatus) row
    // if one exists — a publisher with both an old approved row and a new
    // pending re-application should still sign in to their approved account.
    // Otherwise fall back to whichever row matched (pending or rejected).
    const target = matches.find(
      p => p.applicationStatus === undefined || p.applicationStatus === 'approved',
    ) ?? matches[0];
    if (!target) return { ok: true };

    const issued = await this.deps.tokens.issueToken({
      purpose: 'login',
      email: normalized,
      publisherId: target.id,
    });
    const url = this.buildVerifyUrl('login', issued.rawToken);
    await this.deps.mail.sendLoginMagicLink(normalized, url);
    return { ok: true };
  }

  async verifyLogin(rawToken: string): Promise<VerifyLoginResult> {
    const r = await this.deps.tokens.consumeToken(rawToken, 'login');
    if (r.ok === false) return { ok: false, reason: r.reason };
    if (!r.row.publisherId) {
      // Defensive — login tokens always carry publisherId.
      return { ok: false, reason: 'publisher_missing' };
    }
    const pub = await this.deps.registry.get(r.row.publisherId);
    if (!pub) return { ok: false, reason: 'publisher_missing' };

    const jwt = await signPublisherJwt({
      publisherId: pub.id,
      email: pub.contactEmail,
      tokenVersion: pub.tokenVersion ?? 0,
    });
    return { ok: true, jwt, publisherId: pub.id, email: pub.contactEmail };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private buildVerifyUrl(purpose: 'apply' | 'login', rawToken: string): string {
    // Trim trailing slash to avoid `//publish/verify`.
    const base = this.deps.siteBaseUrl.replace(/\/+$/, '');
    const params = new URLSearchParams({ token: rawToken, purpose });
    return `${base}/publish/verify/?${params.toString()}`;
  }
}

// ─── Input validation ──────────────────────────────────────────────────

function isValidEmail(s: string): boolean {
  // Cheap RFC-shaped check; we don't attempt full RFC 5322. SES will reject
  // truly malformed addresses; this just catches obvious typos.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

type ValidationResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_input'; field: string; message: string };

function validateApplyPayload(p: ApplyFormPayload): ValidationResult {
  if (typeof p?.name !== 'string' || p.name.trim().length === 0) {
    return { ok: false, reason: 'invalid_input', field: 'name', message: 'name is required' };
  }
  if (p.name.length > 200) {
    return { ok: false, reason: 'invalid_input', field: 'name', message: 'name is too long' };
  }
  if (typeof p?.email !== 'string' || !isValidEmail(p.email.trim().toLowerCase())) {
    return { ok: false, reason: 'invalid_input', field: 'email', message: 'valid email is required' };
  }
  if (typeof p?.sourceUrl !== 'string' || p.sourceUrl.length === 0) {
    return { ok: false, reason: 'invalid_input', field: 'sourceUrl', message: 'source URL is required' };
  }
  const urlCheck = validateUrlIsPublic(p.sourceUrl);
  if (urlCheck.ok === false) {
    return { ok: false, reason: 'invalid_input', field: 'sourceUrl', message: urlCheck.reason };
  }
  if (p.sourceType !== 'json' && p.sourceType !== 'html') {
    return { ok: false, reason: 'invalid_input', field: 'sourceType', message: 'sourceType must be "json" or "html"' };
  }
  if (p.organization !== undefined && typeof p.organization !== 'string') {
    return { ok: false, reason: 'invalid_input', field: 'organization', message: 'organization must be a string' };
  }
  if (p.organization !== undefined && p.organization.length > 200) {
    return { ok: false, reason: 'invalid_input', field: 'organization', message: 'organization is too long (max 200 chars)' };
  }
  if (p.notes !== undefined && (typeof p.notes !== 'string' || p.notes.length > 2000)) {
    return { ok: false, reason: 'invalid_input', field: 'notes', message: 'notes must be a string under 2000 chars' };
  }
  return { ok: true };
}
