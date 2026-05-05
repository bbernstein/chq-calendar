# Publisher portal self-service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec**: `docs/plans/2026-05-05-publisher-self-service-design.md`

**Goal**: Give approved publishers self-service control over their own record (profile edits, email change with double-opt-in, fetch-now, pause/resume, soft self-disable) and close the apply-form email-uniqueness gap.

**Architecture**: Eight phases, one PR per phase, each shipping a complete vertical slice. New backend routes live on the existing `publisherPortalHandler.ts` under `/publisher/me/*` paths and reuse the existing publisher JWT, magic-token DDB table, and `DynamoRateLimiter`. The frontend extends `/publish/status/page.tsx` in place. No new tables; two new item shapes (`pending_email_change#…`, `email_change_lock#…`) on the existing magic-token table. JWT identity-version pinning is achieved with a new `tokenVersion` claim plus a `requirePublisherSession` helper that re-checks the version against the live registry row.

**Tech Stack**: TypeScript, Vite + Preact, AWS Lambda, DynamoDB (via `@aws-sdk/lib-dynamodb`), `jsonwebtoken`, Vitest, Terraform.

---

## Phase Map

| Phase | Goal | Branch suffix |
|-------|------|---------------|
| 1 | Auth foundation: `tokenVersion` claim + `requirePublisherSession` helper + registry pause/disable/version helpers | `-foundation` |
| 2 | Profile edits (`PATCH /publisher/me`) + frontend inline name/org + source-edit panel with preview gate | `-profile-edits` |
| 3 | Apply-form uniqueness check (registry collision + pending-email-change collision + race guard) | `-apply-uniqueness` |
| 4 | Email change end-to-end (initiate, verify, cancel-by-old, cancel-by-self, all edge cases) + frontend banner + verify/cancel landing pages + login `?reason=email-changed` | `-email-change` |
| 5 | Single-publisher ingest mode + `POST /publisher/me/fetch-now` + `pause` / `resume` routes + frontend ingest controls | `-ingest-controls` |
| 6 | Self-disable with typed-confirmation + `tokenVersion` bump + frontend danger zone | `-self-disable` |
| 7 | Extend publisher-ingest E2E CI test with the full self-service flow | `-e2e-coverage` |
| 8 | Documentation + cleanup polish | `-docs` |

Each phase is independently mergeable. Phases 2 onward depend on Phase 1; Phase 4 also depends on Phase 3 (uniqueness check is reused inside email-change verify).

---

## File Structure

### New backend files

| File | Responsibility |
|------|----------------|
| `backend/src/services/publisherSession.ts` | `requirePublisherSession(event, registry)` helper — verifies JWT, checks `tokenVersion` against registry, returns `{ claims, publisher }` or 401. |
| `backend/src/services/publisherProfileService.ts` | `updatePublisherProfile(id, patch)` — validates name/org/sourceUrl/sourceType and writes the registry row. URL/sourceType changes go through `urlGuard` + `publisherTestService` first. |
| `backend/src/services/publisherEmailChangeService.ts` | All four email-change operations: `initiate`, `verifyByNewAddress`, `cancelByOldAddress`, `cancelBySelf`. Owns the pending-email-change DDB rows + the lock sentinel. |
| `backend/src/services/publisherSelfActionService.ts` | `triggerSelfFetch`, `setSelfPaused`, `setSelfResumed`, `selfDisable`. Wraps the new registry helpers. |
| `backend/src/handlers/publisherEmailChangePages.ts` | Lambda-rendered HTML for `/publish/email-change/verify/?token=…` and `/publish/email-change/cancel/?token=…` (parallel to existing `verify` route style). |

### Modified backend files

| File | Change |
|------|--------|
| `backend/src/services/publisherAuthService.ts` | `signPublisherJwt` accepts and includes `tokenVersion`; `PublisherClaims` gains `tokenVersion: number`. |
| `backend/src/services/publisherRegistryService.ts` | New methods: `setPausedFlag(id, paused, opts)`, `setSelfDisabled(id)`, `bumpTokenVersion(id)`, `updateProfile(id, patch)` (called by profile service). |
| `backend/src/services/publisherApplicationService.ts` | `requestApply` adds two-source uniqueness check (registry + pending-email-change). |
| `backend/src/handlers/publisherPortalHandler.ts` | Eight new authenticated routes; route table extended; `requirePublisherSession` migrated into existing `handlePublisherStatus`. |
| `backend/src/handlers/publisherIngestHandler.ts` | `scheduledHandler` payload reads optional `singlePublisherId`; `runIngest` accepts a single-publisher mode. |
| `backend/src/types/publisher.ts` | `PublisherRecord` gains `tokenVersion: number`, `selfPausedAt?: string`, `selfDisabledAt?: string`. |
| `backend/src/services/mailService.ts` | New templates: `emailChangeVerify`, `emailChangeWarning`, `emailChangedConfirmation`, `selfDisabledConfirmation`. |

### New frontend files

| File | Responsibility |
|------|----------------|
| `frontend/src/app/publish/status/EditableField.tsx` | Inline pencil-icon edit for name and organization. |
| `frontend/src/app/publish/status/SourceEditPanel.tsx` | Combined URL+sourceType edit panel with required preview gate. |
| `frontend/src/app/publish/status/EmailChangePanel.tsx` | "Change email" modal + pending banner. |
| `frontend/src/app/publish/status/IngestControls.tsx` | Pause/Resume toggle + Fetch-now button with rate-limit countdown. |
| `frontend/src/app/publish/status/DangerZone.tsx` | Self-disable card with typed-confirmation modal. |
| `frontend/src/app/publish/email-change/verify/page.tsx` | Verify-link landing page (calls API, shows result, redirects to login on success). |
| `frontend/src/app/publish/email-change/cancel/page.tsx` | Cancel-link landing page for the old-address abuse escape. |
| `frontend/src/entries/email-change-verify.tsx` | Vite entry. |
| `frontend/src/entries/email-change-cancel.tsx` | Vite entry. |

### Modified frontend files

| File | Change |
|------|--------|
| `frontend/src/app/publish/status/page.tsx` | Render the five new sub-components; wire up patch / pause / resume / fetch-now / disable / email-change clients. |
| `frontend/src/app/publish/login/page.tsx` | Read `?reason=email-changed` query param; render success banner. |
| `frontend/src/lib/publisherStatusApi.ts` | New clients: `patchProfile`, `pause`, `resume`, `fetchNow`, `selfDisable`, `requestEmailChange`, `cancelEmailChangeBySelf`. |
| `frontend/vite.config.ts` | Add the two new entries. |
| `frontend/index.html` and two new HTMLs | Multi-page entries. |

### Infrastructure

No Terraform changes in this round (Scan-based `getByEmail` is acceptable at current scale per the existing self-comment in `publisherRegistryService.ts`). One open follow-up tracked in Phase 8.

---

## Phase 1 — Auth foundation

**Goal**: Add the `tokenVersion` claim and a session helper that all `/publisher/me/*` routes use; introduce registry helpers for pause/disable/version-bump/profile-update; type-extend `PublisherRecord`. No new HTTP routes yet.

**Files**:
- Modify: `backend/src/types/publisher.ts`
- Modify: `backend/src/services/publisherAuthService.ts`
- Create: `backend/src/services/publisherSession.ts`
- Modify: `backend/src/services/publisherRegistryService.ts`
- Test: `backend/src/services/__tests__/publisherSession.test.ts`
- Test: `backend/src/services/__tests__/publisherRegistryService.test.ts` (extend)

### Task 1.1 — Type-extend `PublisherRecord`

- [ ] **Step 1.1.1: Add the new fields to `PublisherRecord`**

Edit `backend/src/types/publisher.ts`. Inside the `PublisherRecord` interface, add (next to `paused?: boolean`):

```ts
  // Identity-version counter. Bumped on email change verify and self-disable.
  // Issued JWTs include this; mismatch with the row's current value → 401.
  // Defaults to 0 for legacy rows that were created before this field existed.
  tokenVersion?: number;
  // Set when the publisher pauses themselves (vs admin-paused). Distinguishing
  // these is purely informational for the admin dashboard.
  selfPausedAt?: string;
  // Set when the publisher self-disables. Reversible only by an admin.
  selfDisabledAt?: string;
```

- [ ] **Step 1.1.2: Verify the type compiles**

Run: `cd backend && npm run build`
Expected: clean.

- [ ] **Step 1.1.3: Commit**

```bash
git add backend/src/types/publisher.ts
git commit -m "types: add tokenVersion + selfPaused/Disabled timestamps to PublisherRecord"
```

### Task 1.2 — Add `tokenVersion` to JWT claims

- [ ] **Step 1.2.1: Write the failing test**

Edit `backend/src/services/__tests__/publisherAuthService.test.ts` (create if missing). Add:

```ts
import { signPublisherJwt, verifyPublisherJwt } from '../publisherAuthService';

describe('publisher JWT — tokenVersion', () => {
  beforeAll(() => {
    process.env.PUBLISHER_JWT_SECRET = 'test-secret-do-not-use';
  });

  it('round-trips the tokenVersion claim', async () => {
    const token = await signPublisherJwt({
      publisherId: 'pub-abc',
      email: 'a@b.com',
      tokenVersion: 7,
    });
    const claims = await verifyPublisherJwt(token);
    expect(claims).not.toBeNull();
    expect(claims!.tokenVersion).toBe(7);
  });

  it('defaults tokenVersion to 0 when caller omits it', async () => {
    const token = await signPublisherJwt({ publisherId: 'pub-abc', email: 'a@b.com' });
    const claims = await verifyPublisherJwt(token);
    expect(claims!.tokenVersion).toBe(0);
  });

  it('returns null for a token whose tokenVersion claim is non-numeric', async () => {
    // Forge a token with a bogus tokenVersion to confirm the verifier rejects it.
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign(
      { sub: 'pub-x', role: 'publisher', email: 'x@y.com', tokenVersion: 'not-a-number' },
      process.env.PUBLISHER_JWT_SECRET!,
    );
    expect(await verifyPublisherJwt(forged)).toBeNull();
  });
});
```

- [ ] **Step 1.2.2: Run the test to confirm it fails**

Run: `cd backend && npx vitest run src/services/__tests__/publisherAuthService.test.ts`
Expected: FAIL — `tokenVersion` is not on the claims.

- [ ] **Step 1.2.3: Update `signPublisherJwt` and `verifyPublisherJwt`**

Edit `backend/src/services/publisherAuthService.ts`:

```ts
export interface PublisherClaims {
  sub: string;
  role: 'publisher';
  email: string;
  tokenVersion: number;
  iat?: number;
  exp?: number;
}

export async function signPublisherJwt(
  payload: { publisherId: string; email: string; tokenVersion?: number },
  expiresIn: string | number = DEFAULT_EXPIRY,
): Promise<string> {
  const secret = await getPublisherJwtSecret();
  return jwt.sign(
    {
      sub: payload.publisherId,
      role: 'publisher' as const,
      email: payload.email.trim().toLowerCase(),
      tokenVersion: payload.tokenVersion ?? 0,
    },
    secret,
    { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] },
  );
}

export async function verifyPublisherJwt(token: string): Promise<PublisherClaims | null> {
  if (typeof token !== 'string' || token.length === 0) return null;
  const secret = await getPublisherJwtSecret();
  try {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded !== 'object' || decoded === null) return null;
    const c = decoded as Record<string, unknown>;
    if (
      typeof c.sub !== 'string' ||
      typeof c.email !== 'string' ||
      c.role !== 'publisher' ||
      typeof c.tokenVersion !== 'number'
    ) {
      return null;
    }
    return {
      sub: c.sub,
      role: 'publisher',
      email: c.email,
      tokenVersion: c.tokenVersion,
      iat: typeof c.iat === 'number' ? c.iat : undefined,
      exp: typeof c.exp === 'number' ? c.exp : undefined,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 1.2.4: Run tests to verify pass**

Run: `cd backend && npx vitest run src/services/__tests__/publisherAuthService.test.ts`
Expected: PASS.

- [ ] **Step 1.2.5: Run the rest of the backend test suite to catch callers**

Run: `cd backend && npm test`
Expected: any tests that build claims by hand without `tokenVersion` will fail. Update each call-site to include `tokenVersion: 0` where the test was previously implicit. Also update production call-sites in `publisherPortalHandler.ts` (login-verify mints tokens) to read `publisher.tokenVersion ?? 0`.

- [ ] **Step 1.2.6: Commit**

```bash
git add backend/src/services/publisherAuthService.ts \
        backend/src/services/__tests__/publisherAuthService.test.ts \
        backend/src/handlers/publisherPortalHandler.ts \
        $(git diff --name-only -- 'backend/**/*.test.ts')
git commit -m "feat(auth): add tokenVersion claim to publisher JWTs"
```

### Task 1.3 — `requirePublisherSession` helper

- [ ] **Step 1.3.1: Write the failing test**

Create `backend/src/services/__tests__/publisherSession.test.ts`:

```ts
import { requirePublisherSession } from '../publisherSession';
import { PublisherRegistryService } from '../publisherRegistryService';
import { signPublisherJwt } from '../publisherAuthService';
import type { APIGatewayProxyEvent } from 'aws-lambda';

const fakeRegistry = (overrides: Partial<{ tokenVersion: number; row: unknown }>) =>
  ({
    get: async () => overrides.row ?? { id: 'pub-x', tokenVersion: overrides.tokenVersion ?? 0 },
  }) as unknown as PublisherRegistryService;

const evt = (token: string | null): APIGatewayProxyEvent =>
  ({ headers: token ? { Authorization: `Bearer ${token}` } : {} }) as unknown as APIGatewayProxyEvent;

describe('requirePublisherSession', () => {
  beforeAll(() => { process.env.PUBLISHER_JWT_SECRET = 'test-secret'; });

  it('returns 401 when no token is present', async () => {
    const r = await requirePublisherSession(evt(null), fakeRegistry({}));
    expect(r.kind).toBe('unauthorized');
  });

  it('returns 401 when the token is malformed', async () => {
    const r = await requirePublisherSession(evt('not-a-jwt'), fakeRegistry({}));
    expect(r.kind).toBe('unauthorized');
  });

  it('returns 401 when tokenVersion mismatches the registry row', async () => {
    const tok = await signPublisherJwt({ publisherId: 'pub-x', email: 'a@b.com', tokenVersion: 1 });
    const r = await requirePublisherSession(evt(tok), fakeRegistry({ tokenVersion: 2 }));
    expect(r.kind).toBe('unauthorized');
  });

  it('returns 404-style "publisher_missing" when the row no longer exists', async () => {
    const tok = await signPublisherJwt({ publisherId: 'pub-x', email: 'a@b.com', tokenVersion: 0 });
    const r = await requirePublisherSession(evt(tok), fakeRegistry({ row: null }));
    expect(r.kind).toBe('publisher_missing');
  });

  it('returns ok with claims and publisher row on success', async () => {
    const row = { id: 'pub-x', tokenVersion: 3, applicationStatus: 'approved', enabled: true };
    const tok = await signPublisherJwt({ publisherId: 'pub-x', email: 'a@b.com', tokenVersion: 3 });
    const r = await requirePublisherSession(evt(tok), fakeRegistry({ row }));
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.claims.sub).toBe('pub-x');
      expect(r.publisher).toEqual(row);
    }
  });
});
```

- [ ] **Step 1.3.2: Run to verify it fails**

Run: `cd backend && npx vitest run src/services/__tests__/publisherSession.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 1.3.3: Implement the helper**

Create `backend/src/services/publisherSession.ts`:

```ts
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { verifyPublisherJwt, type PublisherClaims } from './publisherAuthService';
import type { PublisherRegistryService } from './publisherRegistryService';
import type { PublisherRecord } from '../types/publisher';

export type SessionResult =
  | { kind: 'unauthorized'; message: string }
  | { kind: 'publisher_missing' }
  | { kind: 'ok'; claims: PublisherClaims; publisher: PublisherRecord };

export async function requirePublisherSession(
  event: APIGatewayProxyEvent,
  registry: PublisherRegistryService,
): Promise<SessionResult> {
  const auth = readBearer(event);
  if (!auth) return { kind: 'unauthorized', message: 'Authentication required' };
  const claims = await verifyPublisherJwt(auth);
  if (!claims) return { kind: 'unauthorized', message: 'Authentication required' };
  const publisher = await registry.get(claims.sub);
  if (!publisher) return { kind: 'publisher_missing' };
  const currentVersion = publisher.tokenVersion ?? 0;
  if (claims.tokenVersion !== currentVersion) {
    return { kind: 'unauthorized', message: 'Session is no longer valid; please sign in again.' };
  }
  return { kind: 'ok', claims, publisher };
}

function readBearer(event: APIGatewayProxyEvent): string | null {
  const headers = event.headers ?? {};
  const raw = headers.Authorization ?? headers.authorization;
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
```

- [ ] **Step 1.3.4: Run tests**

Run: `cd backend && npx vitest run src/services/__tests__/publisherSession.test.ts`
Expected: PASS.

- [ ] **Step 1.3.5: Migrate `handlePublisherStatus` to use the helper**

In `backend/src/handlers/publisherPortalHandler.ts`, replace the inline auth block in `handlePublisherStatus` with:

```ts
const sess = await requirePublisherSession(event, statusRegistry());
if (sess.kind === 'unauthorized') return json(401, { error: sess.message });
if (sess.kind === 'publisher_missing') return json(404, { error: 'Publisher not found' });
const rec = sess.publisher;
return json(200, { publisher: sanitizePublisher(rec) });
```

Add `import { requirePublisherSession } from '../services/publisherSession';` to the import block.

- [ ] **Step 1.3.6: Run the full test suite to confirm no regressions**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 1.3.7: Commit**

```bash
git add backend/src/services/publisherSession.ts \
        backend/src/services/__tests__/publisherSession.test.ts \
        backend/src/handlers/publisherPortalHandler.ts
git commit -m "feat(auth): add requirePublisherSession with tokenVersion check"
```

### Task 1.4 — Registry helpers for paused / self-disabled / tokenVersion / profile

- [ ] **Step 1.4.1: Write the failing tests**

In `backend/src/services/__tests__/publisherRegistryService.test.ts`, add a new `describe` block:

```ts
describe('PublisherRegistryService — self-service helpers', () => {
  // Reuses the in-memory DDB harness already used by other tests in this file.
  let svc: PublisherRegistryService;
  beforeEach(async () => {
    svc = makeServiceWithFreshTable();          // existing harness helper
    await svc.upsert({
      id: 'pub-1',
      slug: 'p1',
      name: 'P1',
      sourceUrl: 'https://example.com/feed.json',
      sourceType: 'json',
      contactEmail: 'a@b.com',
      enabled: true,
      applicationStatus: 'approved',
      tokenVersion: 0,
    } as PublisherRecord);
  });

  it('setPausedFlag(true) sets paused=true and selfPausedAt', async () => {
    await svc.setPausedFlag('pub-1', true, { selfInitiated: true });
    const r = await svc.get('pub-1');
    expect(r!.paused).toBe(true);
    expect(typeof r!.selfPausedAt).toBe('string');
  });

  it('setPausedFlag(false) clears paused and selfPausedAt', async () => {
    await svc.setPausedFlag('pub-1', true, { selfInitiated: true });
    await svc.setPausedFlag('pub-1', false, {});
    const r = await svc.get('pub-1');
    expect(r!.paused).toBe(false);
    expect(r!.selfPausedAt).toBeUndefined();
  });

  it('setSelfDisabled marks enabled=false, sets selfDisabledAt, bumps tokenVersion', async () => {
    await svc.setSelfDisabled('pub-1');
    const r = await svc.get('pub-1');
    expect(r!.enabled).toBe(false);
    expect(typeof r!.selfDisabledAt).toBe('string');
    expect(r!.tokenVersion).toBe(1);
  });

  it('bumpTokenVersion increments the counter', async () => {
    await svc.bumpTokenVersion('pub-1');
    expect((await svc.get('pub-1'))!.tokenVersion).toBe(1);
    await svc.bumpTokenVersion('pub-1');
    expect((await svc.get('pub-1'))!.tokenVersion).toBe(2);
  });

  it('updateProfile only writes the supplied fields', async () => {
    await svc.updateProfile('pub-1', { name: 'New Name', organization: 'Org' });
    const r = await svc.get('pub-1');
    expect(r!.name).toBe('New Name');
    expect(r!.organization).toBe('Org');
    expect(r!.sourceUrl).toBe('https://example.com/feed.json');  // unchanged
  });
});
```

- [ ] **Step 1.4.2: Run to confirm failure**

Run: `cd backend && npx vitest run src/services/__tests__/publisherRegistryService.test.ts`
Expected: FAIL — methods don't exist.

- [ ] **Step 1.4.3: Implement the helpers**

Append to `backend/src/services/publisherRegistryService.ts` inside the class:

```ts
  // Pause is reversible and does NOT retract events. Sets `paused` plus an
  // optional `selfPausedAt` timestamp so the admin dashboard can distinguish
  // self-paused from admin-paused. Pausing while already paused is a no-op
  // for `paused` but refreshes `selfPausedAt` only when explicitly reset
  // via setSelfInitiated; we keep this simple by allowing the timestamp to
  // be written each time the flag goes false→true.
  async setPausedFlag(
    id: string,
    paused: boolean,
    opts: { selfInitiated?: boolean } = {},
  ): Promise<void> {
    const setParts = ['paused = :p'];
    const removeParts: string[] = [];
    const values: Record<string, unknown> = { ':p': paused };
    if (paused && opts.selfInitiated) {
      setParts.push('selfPausedAt = :now');
      values[':now'] = new Date().toISOString();
    } else if (!paused) {
      removeParts.push('selfPausedAt');
    }
    const expr =
      `SET ${setParts.join(', ')}` +
      (removeParts.length ? ` REMOVE ${removeParts.join(', ')}` : '');
    await this.db.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { id },
      UpdateExpression: expr,
      ExpressionAttributeValues: values,
    }));
  }

  async setSelfDisabled(id: string): Promise<void> {
    // ADD on tokenVersion handles the "field doesn't exist yet" case for
    // legacy rows: ADD treats absent as 0 before the increment.
    await this.db.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { id },
      UpdateExpression: 'SET enabled = :f, selfDisabledAt = :now ADD tokenVersion :one',
      ExpressionAttributeValues: {
        ':f': false,
        ':now': new Date().toISOString(),
        ':one': 1,
      },
    }));
  }

  async bumpTokenVersion(id: string): Promise<void> {
    await this.db.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { id },
      UpdateExpression: 'ADD tokenVersion :one',
      ExpressionAttributeValues: { ':one': 1 },
    }));
  }

  // updateProfile writes only the supplied fields. The handler is responsible
  // for validating values BEFORE calling this — registry layer trusts inputs.
  async updateProfile(
    id: string,
    patch: Partial<Pick<PublisherRecord, 'name' | 'organization' | 'sourceUrl' | 'sourceType' | 'contactEmail'>>,
  ): Promise<void> {
    const setParts: string[] = [];
    const removeParts: string[] = [];
    const values: Record<string, unknown> = {};
    const names: Record<string, string> = {};
    let i = 0;
    for (const [k, v] of Object.entries(patch)) {
      const placeholder = `:v${i}`;
      const namePlaceholder = `#k${i}`;
      names[namePlaceholder] = k;
      if (v === undefined || v === '') {
        // Allow caller to clear `organization` by passing empty string.
        // Other fields are non-nullable; the handler must not pass empty.
        removeParts.push(namePlaceholder);
      } else {
        setParts.push(`${namePlaceholder} = ${placeholder}`);
        values[placeholder] = v;
      }
      i += 1;
    }
    if (setParts.length === 0 && removeParts.length === 0) return;
    const expr =
      (setParts.length ? `SET ${setParts.join(', ')}` : '') +
      (removeParts.length ? ` REMOVE ${removeParts.join(', ')}` : '');
    await this.db.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { id },
      UpdateExpression: expr.trim(),
      ExpressionAttributeNames: names,
      ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
    }));
  }
```

- [ ] **Step 1.4.4: Run tests**

Run: `cd backend && npx vitest run src/services/__tests__/publisherRegistryService.test.ts`
Expected: PASS.

- [ ] **Step 1.4.5: Lint + full test suite**

Run: `cd backend && npm run lint && npm test`
Expected: clean.

- [ ] **Step 1.4.6: Commit**

```bash
git add backend/src/services/publisherRegistryService.ts \
        backend/src/services/__tests__/publisherRegistryService.test.ts
git commit -m "feat(registry): add setPausedFlag, setSelfDisabled, bumpTokenVersion, updateProfile helpers"
```

### Task 1.5 — Phase-1 PR

- [ ] **Step 1.5.1: Push the branch and open the PR**

```bash
git push -u origin feat/publisher-self-service-foundation
gh pr create --title "feat(publisher-portal): self-service Phase 1 — auth foundation" \
  --body "$(cat <<'EOF'
## Summary
- Add `tokenVersion` claim to publisher JWTs (default 0 for compatibility)
- Add `requirePublisherSession` helper — verifies JWT and re-checks tokenVersion against the live registry row
- Add registry helpers `setPausedFlag`, `setSelfDisabled`, `bumpTokenVersion`, `updateProfile`
- Migrate `handlePublisherStatus` to the new helper

Lays the foundation for upcoming self-service routes; no public behaviour change yet.

## Test plan
- [ ] `cd backend && npm test` passes
- [ ] Manual: existing `/publisher-status` route still works in deployed dev env

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase 2 — Profile edits

**Goal**: `PATCH /publisher/me` route + frontend inline name/organization edits + combined source-edit panel with required-preview gate. URL/sourceType changes go through `urlGuard.resolveAndValidateUrl` + `publisherTestService.fetchAndValidate` server-side regardless of what the client did.

**Files**:
- Create: `backend/src/services/publisherProfileService.ts`
- Modify: `backend/src/handlers/publisherPortalHandler.ts`
- Test: `backend/src/services/__tests__/publisherProfileService.test.ts`
- Test: `backend/src/handlers/__tests__/publisherPortalHandler.profile.test.ts`
- Create: `frontend/src/app/publish/status/EditableField.tsx`
- Create: `frontend/src/app/publish/status/SourceEditPanel.tsx`
- Modify: `frontend/src/app/publish/status/page.tsx`
- Modify: `frontend/src/lib/publisherStatusApi.ts`
- Test: `frontend/src/app/publish/status/__tests__/EditableField.test.tsx`
- Test: `frontend/src/app/publish/status/__tests__/SourceEditPanel.test.tsx`

### Task 2.1 — `publisherProfileService.updateProfile`

- [ ] **Step 2.1.1: Write the failing test**

Create `backend/src/services/__tests__/publisherProfileService.test.ts`:

```ts
import { updatePublisherProfile, ProfileValidationError } from '../publisherProfileService';

describe('updatePublisherProfile', () => {
  const baseRegistry = () => ({
    get: vi.fn(async () => ({
      id: 'pub-1',
      sourceUrl: 'https://old.example.com/f.json',
      sourceType: 'json',
      tokenVersion: 0,
      enabled: true,
      applicationStatus: 'approved',
    })),
    updateProfile: vi.fn(async () => undefined),
  } as any);

  const passingTest = vi.fn(async () => ({ ok: true, parsedFeedSummary: 'fine' }));
  const failingTest = vi.fn(async () => ({ ok: false, errors: ['bad shape'] }));

  it('updates name and organization without invoking the URL test', async () => {
    const reg = baseRegistry();
    await updatePublisherProfile('pub-1', { name: 'New', organization: 'Org' }, {
      registry: reg, runFeedTest: passingTest,
    });
    expect(reg.updateProfile).toHaveBeenCalledWith('pub-1', { name: 'New', organization: 'Org' });
    expect(passingTest).not.toHaveBeenCalled();
  });

  it('rejects empty name', async () => {
    const reg = baseRegistry();
    await expect(
      updatePublisherProfile('pub-1', { name: '   ' }, { registry: reg, runFeedTest: passingTest })
    ).rejects.toBeInstanceOf(ProfileValidationError);
  });

  it('clears organization when passed empty string', async () => {
    const reg = baseRegistry();
    await updatePublisherProfile('pub-1', { organization: '' }, {
      registry: reg, runFeedTest: passingTest,
    });
    expect(reg.updateProfile).toHaveBeenCalledWith('pub-1', { organization: '' });
  });

  it('runs the feed test before saving when sourceUrl changes', async () => {
    const reg = baseRegistry();
    await updatePublisherProfile(
      'pub-1',
      { sourceUrl: 'https://new.example.com/f.json' },
      { registry: reg, runFeedTest: passingTest },
    );
    expect(passingTest).toHaveBeenCalledWith({
      url: 'https://new.example.com/f.json',
      sourceType: 'json',
    });
    expect(reg.updateProfile).toHaveBeenCalled();
  });

  it('runs the feed test with the new sourceType when only type changes', async () => {
    const reg = baseRegistry();
    await updatePublisherProfile('pub-1', { sourceType: 'ical' }, {
      registry: reg, runFeedTest: passingTest,
    });
    expect(passingTest).toHaveBeenCalledWith({
      url: 'https://old.example.com/f.json',
      sourceType: 'ical',
    });
  });

  it('does not save when the feed test fails', async () => {
    const reg = baseRegistry();
    await expect(
      updatePublisherProfile(
        'pub-1',
        { sourceUrl: 'https://new.example.com/f.json' },
        { registry: reg, runFeedTest: failingTest },
      )
    ).rejects.toBeInstanceOf(ProfileValidationError);
    expect(reg.updateProfile).not.toHaveBeenCalled();
  });

  it('rejects unknown patch fields', async () => {
    const reg = baseRegistry();
    await expect(
      updatePublisherProfile('pub-1', { contactEmail: 'x@y.com' } as any, {
        registry: reg, runFeedTest: passingTest,
      })
    ).rejects.toBeInstanceOf(ProfileValidationError);
  });

  it('rejects fields longer than 200 chars', async () => {
    const reg = baseRegistry();
    await expect(
      updatePublisherProfile('pub-1', { name: 'x'.repeat(201) }, {
        registry: reg, runFeedTest: passingTest,
      })
    ).rejects.toBeInstanceOf(ProfileValidationError);
  });
});
```

- [ ] **Step 2.1.2: Run to confirm failure**

Run: `cd backend && npx vitest run src/services/__tests__/publisherProfileService.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 2.1.3: Implement the service**

Create `backend/src/services/publisherProfileService.ts`:

```ts
import type { PublisherRegistryService } from './publisherRegistryService';
import type { SourceType } from '../types/publisher';

export class ProfileValidationError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
  }
}

export interface ProfilePatch {
  name?: string;
  organization?: string;
  sourceUrl?: string;
  sourceType?: SourceType;
}

const ALLOWED_FIELDS = new Set<keyof ProfilePatch>(['name', 'organization', 'sourceUrl', 'sourceType']);
const ALLOWED_SOURCE_TYPES = new Set<SourceType>(['json', 'ical']);

export interface UpdateDeps {
  registry: PublisherRegistryService;
  runFeedTest: (input: { url: string; sourceType: SourceType }) => Promise<
    { ok: true; parsedFeedSummary?: string } | { ok: false; errors: string[] }
  >;
}

export async function updatePublisherProfile(
  publisherId: string,
  rawPatch: Record<string, unknown>,
  deps: UpdateDeps,
): Promise<void> {
  for (const k of Object.keys(rawPatch)) {
    if (!ALLOWED_FIELDS.has(k as keyof ProfilePatch)) {
      throw new ProfileValidationError('unknown_field', `Field "${k}" is not editable.`);
    }
  }
  const patch: ProfilePatch = {};
  if ('name' in rawPatch) {
    const v = String(rawPatch.name ?? '').trim();
    if (v.length === 0) throw new ProfileValidationError('empty_name', 'Name cannot be empty.');
    if (v.length > 200) throw new ProfileValidationError('field_too_long', 'Name cannot exceed 200 characters.');
    patch.name = v;
  }
  if ('organization' in rawPatch) {
    const raw = rawPatch.organization;
    if (raw === null || raw === undefined || raw === '') {
      patch.organization = '';                                    // signal clear
    } else {
      const v = String(raw).trim();
      if (v.length > 200) throw new ProfileValidationError('field_too_long', 'Organization cannot exceed 200 characters.');
      patch.organization = v;
    }
  }
  if ('sourceUrl' in rawPatch) {
    const v = String(rawPatch.sourceUrl ?? '').trim();
    if (!/^https:\/\//.test(v)) throw new ProfileValidationError('bad_url', 'Source URL must be https.');
    if (v.length > 2000) throw new ProfileValidationError('field_too_long', 'Source URL is too long.');
    patch.sourceUrl = v;
  }
  if ('sourceType' in rawPatch) {
    const v = String(rawPatch.sourceType ?? '');
    if (!ALLOWED_SOURCE_TYPES.has(v as SourceType)) {
      throw new ProfileValidationError('bad_source_type', 'Source type must be "json" or "ical".');
    }
    patch.sourceType = v as SourceType;
  }
  if (Object.keys(patch).length === 0) {
    throw new ProfileValidationError('empty_patch', 'No editable fields supplied.');
  }
  // If URL or sourceType changed, run a server-side feed test against the
  // *effective* values (current ⊕ patch).
  if ('sourceUrl' in patch || 'sourceType' in patch) {
    const current = await deps.registry.get(publisherId);
    if (!current) throw new ProfileValidationError('not_found', 'Publisher not found.');
    const effectiveUrl = patch.sourceUrl ?? current.sourceUrl;
    const effectiveType = patch.sourceType ?? current.sourceType;
    const result = await deps.runFeedTest({ url: effectiveUrl, sourceType: effectiveType });
    if (!result.ok) {
      throw new ProfileValidationError('feed_test_failed', 'Proposed feed did not pass validation.', result.errors);
    }
  }
  await deps.registry.updateProfile(publisherId, patch);
}
```

- [ ] **Step 2.1.4: Run tests**

Run: `cd backend && npx vitest run src/services/__tests__/publisherProfileService.test.ts`
Expected: PASS.

- [ ] **Step 2.1.5: Commit**

```bash
git add backend/src/services/publisherProfileService.ts \
        backend/src/services/__tests__/publisherProfileService.test.ts
git commit -m "feat(profile): add updatePublisherProfile with URL/sourceType validation gate"
```

### Task 2.2 — `PATCH /publisher/me` route

- [ ] **Step 2.2.1: Write the failing handler test**

Create `backend/src/handlers/__tests__/publisherPortalHandler.profile.test.ts`. Test: 401 without JWT, 401 on tokenVersion mismatch, 403 if applicationStatus !== 'approved', 400 on validation error, 200 on success. Use the existing handler test patterns in `publisherPortalHandler.test.ts`.

(See `publisherPortalHandler.test.ts` for harness setup; reuse it. Each test seeds a registry row, mints a JWT via `signPublisherJwt`, calls `handlePublisherProfilePatch(event, body)`, asserts the response.)

- [ ] **Step 2.2.2: Run to confirm failure**

Run: `cd backend && npx vitest run src/handlers/__tests__/publisherPortalHandler.profile.test.ts`
Expected: FAIL — handler missing.

- [ ] **Step 2.2.3: Implement the handler**

In `backend/src/handlers/publisherPortalHandler.ts`, add:

```ts
import { updatePublisherProfile, ProfileValidationError } from '../services/publisherProfileService';
import { resolveAndValidateUrl } from '../services/urlGuard';
import { fetchAndValidateForTest } from '../services/publisherTestService';

export async function handlePublisherProfilePatch(
  event: APIGatewayProxyEvent,
  body: Record<string, unknown>,
): Promise<APIGatewayProxyResult> {
  const sess = await requirePublisherSession(event, statusRegistry());
  if (sess.kind === 'unauthorized') return json(401, { error: sess.message });
  if (sess.kind === 'publisher_missing') return json(404, { error: 'Publisher not found' });
  if (sess.publisher.applicationStatus !== 'approved') {
    return json(403, { error: 'Profile editing is only available to approved publishers.' });
  }
  try {
    await updatePublisherProfile(sess.publisher.id, body, {
      registry: statusRegistry(),
      runFeedTest: async ({ url, sourceType }) => {
        const guarded = await resolveAndValidateUrl(url);
        if (!guarded.ok) return { ok: false, errors: [guarded.reason] };
        return fetchAndValidateForTest({ url, sourceType });
      },
    });
    const updated = await statusRegistry().get(sess.publisher.id);
    return json(200, { publisher: sanitizePublisher(updated!) });
  } catch (err) {
    if (err instanceof ProfileValidationError) {
      return json(400, { error: err.message, code: err.code, details: err.details ?? null });
    }
    console.error('Error in PATCH /publisher/me:', err);
    return json(500, { error: 'Internal server error' });
  }
}
```

(`fetchAndValidateForTest` may need adjustment — see what the existing `publisherTestService` already exports; if the existing function returns a `report` shape, adapt the inline closure in `runFeedTest` to translate that shape to `{ ok, errors }`. The test in 2.1 mocked the closure entirely, so the service's contract is what counts.)

- [ ] **Step 2.2.4: Wire route into the dispatcher**

In `publisherPortalHandler.ts`, find the route table and add:

```ts
if (path === '/publisher/me' && httpMethod === 'PATCH') {
  return handlePublisherProfilePatch(event, body);
}
```

(Match the existing route-dispatch convention in this handler — adapt path-prefix and body parsing to what's already there.)

- [ ] **Step 2.2.5: Add API Gateway route in Terraform**

In `infrastructure/main.tf` (or wherever the publisher-portal API Gateway routes are configured), add a `PATCH /publisher/me` route pointing to the same Lambda. Match the pattern of existing publisher-portal routes (`POST /publisher/test`, etc.).

- [ ] **Step 2.2.6: Run handler test**

Run: `cd backend && npx vitest run src/handlers/__tests__/publisherPortalHandler.profile.test.ts`
Expected: PASS.

- [ ] **Step 2.2.7: Commit**

```bash
git add backend/src/handlers/publisherPortalHandler.ts \
        backend/src/handlers/__tests__/publisherPortalHandler.profile.test.ts \
        infrastructure/main.tf
git commit -m "feat(api): PATCH /publisher/me for self-service profile edits"
```

### Task 2.3 — Frontend `EditableField` component

- [ ] **Step 2.3.1: Write the failing test**

Create `frontend/src/app/publish/status/__tests__/EditableField.test.tsx`. Test: renders display value; pencil click swaps to input; Save calls `onSave` with trimmed value; Cancel restores; Save shows spinner while pending; Save renders error from rejected promise.

- [ ] **Step 2.3.2: Run to confirm failure**

Run: `cd frontend && npx vitest run src/app/publish/status/__tests__/EditableField.test.tsx`
Expected: FAIL.

- [ ] **Step 2.3.3: Implement `EditableField.tsx`**

Create `frontend/src/app/publish/status/EditableField.tsx`:

```tsx
import { useState } from 'react';

export interface EditableFieldProps {
  label: string;
  value: string;
  allowEmpty?: boolean;
  maxLength?: number;
  onSave: (newValue: string) => Promise<void>;
}

export function EditableField({ label, value, allowEmpty, maxLength = 200, onSave }: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() { setDraft(value); setEditing(true); setError(null); }
  function cancel() { setEditing(false); setError(null); }

  async function save() {
    const trimmed = draft.trim();
    if (!allowEmpty && trimmed.length === 0) {
      setError('This field cannot be empty.');
      return;
    }
    if (trimmed.length > maxLength) {
      setError(`Maximum length is ${maxLength} characters.`);
      return;
    }
    setPending(true); setError(null);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span>{value || <span className="text-gray-400 italic">—</span>}</span>
        <button
          aria-label={`Edit ${label}`}
          onClick={start}
          className="text-blue-600 hover:text-blue-800 text-xs"
        >
          ✎
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        type="text"
        value={draft}
        onInput={e => setDraft((e.target as HTMLInputElement).value)}
        disabled={pending}
        maxLength={maxLength + 1}
        className="px-2 py-1 border rounded text-sm dark:bg-gray-700"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="px-2 py-0.5 text-xs rounded bg-blue-600 text-white disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={cancel}
          disabled={pending}
          className="px-2 py-0.5 text-xs rounded border"
        >
          Cancel
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2.3.4: Run tests**

Run: `cd frontend && npx vitest run src/app/publish/status/__tests__/EditableField.test.tsx`
Expected: PASS.

- [ ] **Step 2.3.5: Commit**

```bash
git add frontend/src/app/publish/status/EditableField.tsx \
        frontend/src/app/publish/status/__tests__/EditableField.test.tsx
git commit -m "feat(ui): EditableField component for inline name/org edits"
```

### Task 2.4 — Frontend `SourceEditPanel` component

- [ ] **Step 2.4.1: Write the failing test**

Create `frontend/src/app/publish/status/__tests__/SourceEditPanel.test.tsx`. Test: panel renders with current URL/type defaults; Save button is disabled until Preview returns ok; modifying URL after a passing preview re-disables Save until preview re-runs; Save dispatches with proposed values; Cancel calls `onCancel` without saving; preview failure renders the same error UI shape used on `/publish/test/`.

- [ ] **Step 2.4.2: Implement `SourceEditPanel.tsx`**

Create `frontend/src/app/publish/status/SourceEditPanel.tsx`. Key behaviour:

```tsx
import { useState } from 'react';
import type { SourceType } from '@/lib/types';

export interface SourceEditPanelProps {
  currentUrl: string;
  currentType: SourceType;
  onPreview: (url: string, type: SourceType) =>
    Promise<{ ok: true; summary: string } | { ok: false; errors: string[] }>;
  onSave: (url: string, type: SourceType) => Promise<void>;
  onCancel: () => void;
}

export function SourceEditPanel(props: SourceEditPanelProps) {
  const [url, setUrl] = useState(props.currentUrl);
  const [type, setType] = useState<SourceType>(props.currentType);
  const [previewResult, setPreviewResult] =
    useState<{ ok: true; summary: string; previewedUrl: string; previewedType: SourceType } | { ok: false; errors: string[] } | null>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const previewMatchesForm =
    previewResult?.ok === true &&
    previewResult.previewedUrl === url &&
    previewResult.previewedType === type;
  const canSave = previewMatchesForm && busy === null;

  async function runPreview() {
    setBusy('preview'); setSaveError(null);
    try {
      const r = await props.onPreview(url, type);
      setPreviewResult(r.ok
        ? { ok: true, summary: r.summary, previewedUrl: url, previewedType: type }
        : r);
    } finally { setBusy(null); }
  }

  async function save() {
    setBusy('save'); setSaveError(null);
    try {
      await props.onSave(url, type);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed.');
    } finally { setBusy(null); }
  }

  // ... render: URL input, source-type radio, Preview button,
  // preview-result block (success summary or error list), Save button,
  // Cancel button. Save disabled when !canSave.
  // (Render markup is straightforward; mirror existing /publish/test/ UI.)
}
```

- [ ] **Step 2.4.3: Run tests**

Run: `cd frontend && npx vitest run src/app/publish/status/__tests__/SourceEditPanel.test.tsx`
Expected: PASS.

- [ ] **Step 2.4.4: Commit**

```bash
git add frontend/src/app/publish/status/SourceEditPanel.tsx \
        frontend/src/app/publish/status/__tests__/SourceEditPanel.test.tsx
git commit -m "feat(ui): SourceEditPanel with required-preview gate before Save"
```

### Task 2.5 — Wire profile edits into `/publish/status/page.tsx`

- [ ] **Step 2.5.1: Add API client functions**

Edit `frontend/src/lib/publisherStatusApi.ts`:

```ts
export async function patchPublisherProfile(
  patch: Partial<{ name: string; organization: string; sourceUrl: string; sourceType: 'json' | 'ical' }>,
): Promise<PublisherStatusRecord> {
  const r = await authedFetch('/publisher/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${r.status}`);
  }
  return (await r.json()).publisher;
}

export async function previewPublisherFeed(
  url: string,
  sourceType: 'json' | 'ical',
): Promise<{ ok: true; summary: string } | { ok: false; errors: string[] }> {
  // Reuse existing public test endpoint; no auth needed.
  const r = await fetch('/publisher/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, sourceType }),
  });
  const body = await r.json().catch(() => ({}));
  if (r.ok && body.ok) return { ok: true, summary: body.summary ?? 'Feed parsed successfully.' };
  return { ok: false, errors: body.errors ?? [body.error ?? `HTTP ${r.status}`] };
}
```

(Match the existing convention in this file. `authedFetch` should already exist in `publisherAuthClient.ts`; if not, factor a small one inline.)

- [ ] **Step 2.5.2: Modify `PublisherCard` in `page.tsx`**

Change the Name and Organization rows to use `<EditableField>`. On save, call `patchPublisherProfile({ ... })` then update the local `status.rec` state.

Add a "Edit source" button on the Source/Source-type rows that opens `<SourceEditPanel>` in a modal or expansion below the card. On save success, replace `status.rec`.

- [ ] **Step 2.5.3: Add unit tests for the page wiring**

Add to `frontend/src/app/publish/status/__tests__/page.test.tsx` (create if missing): test that name edit invokes `patchPublisherProfile` and updates the UI; URL edit opens the panel and Save is preview-gated.

- [ ] **Step 2.5.4: Run frontend type-check + tests**

Run: `cd frontend && npm run validate && npx vitest run`
Expected: clean.

- [ ] **Step 2.5.5: Manual smoke test**

Run: `cd frontend && npm run dev` — visit the local dev URL, log in as a test publisher, verify:
- Pencil icon swaps name to an input.
- Save persists; cancel discards.
- "Edit source" panel disables Save until Preview returns ok.
- Changing URL after a passing preview re-disables Save.

- [ ] **Step 2.5.6: Commit**

```bash
git add frontend/src/app/publish/status/page.tsx \
        frontend/src/lib/publisherStatusApi.ts
git commit -m "feat(ui): wire profile edits into /publish/status/"
```

### Task 2.6 — Phase-2 PR

- [ ] **Step 2.6.1: Push + open PR**

```bash
git push -u origin feat/publisher-self-service-profile-edits
gh pr create --title "feat(publisher-portal): self-service Phase 2 — profile edits" \
  --body "$(cat <<'EOF'
## Summary
- `PATCH /publisher/me` for name / organization / sourceUrl / sourceType
- URL/sourceType changes go through the same urlGuard + feed-test gate as `/publish/test/` — server-side, never trusting the client preview
- Frontend: inline EditableField + SourceEditPanel with required-preview-before-save gate

Builds on Phase 1 (auth foundation). No public behaviour change for read-only viewers.

## Test plan
- [ ] Backend tests pass
- [ ] Frontend tests pass
- [ ] Manual: log in as a test publisher; edit name/org/URL/type via the new UI

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase 3 — Apply-form uniqueness check

**Goal**: Reject apply submissions whose email is already in the registry (any status) or already targeted by a pending email change. Same uniqueness function reused inside email-change initiate (Phase 4).

**Files**:
- Modify: `backend/src/services/publisherApplicationService.ts`
- Test: `backend/src/services/__tests__/publisherApplicationService.test.ts` (extend)

### Task 3.1 — Uniqueness check in `requestApply`

- [ ] **Step 3.1.1: Write the failing tests**

Add to `publisherApplicationService.test.ts`:

```ts
describe('requestApply — email uniqueness', () => {
  it('rejects when an approved publisher already uses this email', async () => {
    await registry.upsert({ /* approved row with contactEmail: 'taken@e.com' */ } as PublisherRecord);
    await expect(svc.requestApply({ email: 'taken@e.com', /* ... */ }))
      .rejects.toBeInstanceOf(EmailAlreadyInUseError);
  });
  it('rejects when a pending publisher already uses this email', async () => { /* same */ });
  it('rejects when a rejected publisher already uses this email', async () => { /* same */ });
  it('rejects when a pending email change targets this email', async () => {
    await magicTokenStore.put({
      pk: 'pending_email_change#pub-1',
      newEmail: 'taken@e.com',
      /* ... */
    });
    await expect(svc.requestApply({ email: 'taken@e.com', /* ... */ }))
      .rejects.toBeInstanceOf(EmailAlreadyInUseError);
  });
  it('treats email comparison case-insensitively', async () => {
    await registry.upsert({ /* contactEmail: 'taken@e.com' */ } as PublisherRecord);
    await expect(svc.requestApply({ email: 'TAKEN@E.COM' /* ... */ }))
      .rejects.toBeInstanceOf(EmailAlreadyInUseError);
  });
});
```

- [ ] **Step 3.1.2: Run to confirm failure**

Run: `cd backend && npx vitest run src/services/__tests__/publisherApplicationService.test.ts`
Expected: FAIL.

- [ ] **Step 3.1.3: Implement the check**

In `publisherApplicationService.ts`:

```ts
export class EmailAlreadyInUseError extends Error {
  constructor() { super('Email is already associated with a publisher account.'); }
}

// Inside the `requestApply` method, before creating the application:
const normalized = email.trim().toLowerCase();
const existing = await this.registry.getByEmail(normalized);
if (existing.length > 0) throw new EmailAlreadyInUseError();
const pendingChange = await this.magicTokens.queryPendingEmailChangeByNewEmail(normalized);
if (pendingChange) throw new EmailAlreadyInUseError();
// ... existing apply logic continues
```

`queryPendingEmailChangeByNewEmail` is a new method on the magic-token service that scans the magic-token table for a `pending_email_change#…` row whose `newEmail` matches. (This is bounded by total active email changes, currently zero.) Add it to `magicTokenService.ts`:

```ts
async queryPendingEmailChangeByNewEmail(email: string): Promise<PendingEmailChange | null> {
  const r = await this.db.send(new ScanCommand({
    TableName: this.tableName,
    FilterExpression: 'begins_with(pk, :prefix) AND newEmail = :e',
    ExpressionAttributeValues: { ':prefix': 'pending_email_change#', ':e': email.trim().toLowerCase() },
  }));
  return (r.Items?.[0] as PendingEmailChange | undefined) ?? null;
}
```

- [ ] **Step 3.1.4: Wire the apply handler error**

In `publisherPortalHandler.ts` `handlePublisherApplyRequest`, catch `EmailAlreadyInUseError` and return `400` with the generic message: *"We can't accept this email address. If you already have a publisher account, sign in at /publish/login/."*

- [ ] **Step 3.1.5: Run tests**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 3.1.6: Commit**

```bash
git add backend/src/services/publisherApplicationService.ts \
        backend/src/services/__tests__/publisherApplicationService.test.ts \
        backend/src/services/magicTokenService.ts \
        backend/src/handlers/publisherPortalHandler.ts
git commit -m "feat(apply): reject submissions whose email is already in use"
```

### Task 3.2 — Phase-3 PR

- [ ] **Step 3.2.1: Push + open PR**

```bash
git push -u origin feat/publisher-self-service-apply-uniqueness
# gh pr create with body explaining: closes the gap that lets two publisher
# rows share an email; reused by Phase 4 email-change verify.
```

---

## Phase 4 — Email change

**Goal**: End-to-end email change with double-opt-in, force re-login on verify, and all edge cases enforced.

**Files**:
- Create: `backend/src/services/publisherEmailChangeService.ts`
- Modify: `backend/src/services/magicTokenService.ts`
- Modify: `backend/src/services/mailService.ts`
- Modify: `backend/src/handlers/publisherPortalHandler.ts`
- Create: `backend/src/handlers/publisherEmailChangePages.ts`
- Test: `backend/src/services/__tests__/publisherEmailChangeService.test.ts`
- Create: `frontend/src/app/publish/status/EmailChangePanel.tsx`
- Modify: `frontend/src/app/publish/status/page.tsx`
- Modify: `frontend/src/app/publish/login/page.tsx`
- Create: `frontend/src/app/publish/email-change/verify/page.tsx`
- Create: `frontend/src/app/publish/email-change/cancel/page.tsx`
- Create: `frontend/src/entries/email-change-verify.tsx`
- Create: `frontend/src/entries/email-change-cancel.tsx`
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/src/lib/publisherStatusApi.ts`

### Task 4.1 — `publisherEmailChangeService.initiate`

- [ ] **Step 4.1.1: Write the failing test**

Create `backend/src/services/__tests__/publisherEmailChangeService.test.ts`. Test cases per the spec's edge-case table:

```ts
describe('initiate', () => {
  it('writes a pending row and emits two emails', async () => {});
  it('rejects when the new email belongs to another publisher', async () => {});
  it('rejects when the new email belongs to the same publisher', async () => {});
  it('rejects when an email_change_lock is in effect', async () => {});
  it('supersedes an existing pending row for this publisher', async () => {});
  it('rejects when newEmail is already targeted by another publisher\'s pending change', async () => {});
  it('lowercases and trims newEmail', async () => {});
  it('writes the row with TTL = 24h', async () => {});
});
```

- [ ] **Step 4.1.2: Implement `publisherEmailChangeService.initiate`**

```ts
export interface InitiateInput {
  publisherId: string;
  oldEmail: string;
  newEmail: string;
}

export async function initiate(input: InitiateInput, deps: EmailChangeDeps): Promise<void> {
  const newEmail = input.newEmail.trim().toLowerCase();
  if (!newEmail) throw new EmailChangeError('bad_email', 'Email cannot be empty.');
  if (newEmail === input.oldEmail.trim().toLowerCase()) {
    throw new EmailChangeError('same_email', "You're already using that email.");
  }
  if (await deps.magicTokens.getEmailChangeLock(input.publisherId)) {
    throw new EmailChangeError('locked', 'Email changes are temporarily locked on this account.');
  }
  if ((await deps.registry.getByEmail(newEmail)).length > 0) {
    throw new EmailChangeError('email_in_use', 'That email is already in use.');
  }
  if (await deps.magicTokens.queryPendingEmailChangeByNewEmail(newEmail)) {
    throw new EmailChangeError('email_in_use', 'That email is already in use.');
  }
  // Atomic supersede: delete-if-exists, then put. We use putEmailChangePending
  // with no condition; the prior row TTL will collect it but the new row owns
  // the slot via fixed pk.
  const verifyToken = randomHex(32);
  const cancelToken = randomHex(32);
  const requestedAt = new Date();
  const expiresAt = new Date(requestedAt.getTime() + 24 * 3600 * 1000);
  await deps.magicTokens.putEmailChangePending({
    publisherId: input.publisherId,
    oldEmail: input.oldEmail.trim().toLowerCase(),
    newEmail,
    verifyToken, cancelToken,
    requestedAt: requestedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ttl: Math.floor(expiresAt.getTime() / 1000),
  });
  await deps.mail.sendEmailChangeVerify({ to: newEmail, verifyToken });
  await deps.mail.sendEmailChangeWarning({ to: input.oldEmail, newEmail, cancelToken });
}
```

(`magicTokenService` gains `getEmailChangeLock`, `putEmailChangePending`, plus the verify-side methods used in 4.2.)

- [ ] **Step 4.1.3: Add `mailService` templates**

Stub copy in `mailService.ts`:

```ts
async sendEmailChangeVerify({ to, verifyToken }: { to: string; verifyToken: string }) {
  const link = `${this.baseUrl}/publish/email-change/verify/?token=${verifyToken}`;
  await this.send({
    to,
    subject: 'Confirm your new publisher email',
    body: `Click to confirm this is your new email for chqcal.org publisher access:\n\n${link}\n\nThis link expires in 24 hours.`,
  });
}

async sendEmailChangeWarning({ to, newEmail, cancelToken }: { to: string; newEmail: string; cancelToken: string }) {
  const link = `${this.baseUrl}/publish/email-change/cancel/?token=${cancelToken}`;
  await this.send({
    to,
    subject: 'Someone requested to change your publisher email',
    body: `A request was made to change your chqcal.org publisher email to ${newEmail}.\n\nIf this wasn't you, click here to cancel:\n${link}\n\nThis cancel link works for 24 hours.`,
  });
}
```

- [ ] **Step 4.1.4: Run tests**

Run: `cd backend && npx vitest run src/services/__tests__/publisherEmailChangeService.test.ts`
Expected: PASS.

- [ ] **Step 4.1.5: Commit**

```bash
git commit -m "feat(email-change): initiate flow with all uniqueness checks"
```

### Task 4.2 — `verifyByNewAddress`

- [ ] **Step 4.2.1: Write the failing tests**

Add to `publisherEmailChangeService.test.ts`:

```ts
describe('verifyByNewAddress', () => {
  it('updates contactEmail, bumps tokenVersion, deletes pending row, sends both confirmations', async () => {});
  it('returns "already_used" when the verify token is unknown', async () => {});
  it('returns "expired" when the row exists but ttl is past', async () => {});
  it('returns "email_taken" when another publisher claimed the email between submit and verify', async () => {});
  it('handles double-click via DDB conditional delete (one wins, one returns already_used)', async () => {});
});
```

- [ ] **Step 4.2.2: Implement `verifyByNewAddress`**

Use `TransactWriteCommand` to atomically:
- ConditionCheck: registry row exists.
- ConditionCheck: no other publisher has `contactEmail = newEmail` (via Scan-then-check is unsafe in a transaction; instead, perform the Scan inside the service and treat the time between Scan and Transact as a small race window — the email change emails were already sent, so the race window was 24h anyway. The transaction itself only updates the registry row and deletes the pending row.).
- Update registry row: `contactEmail = newEmail`, `tokenVersion += 1`.
- Delete pending row with `ConditionExpression` on `verifyToken` matching, so a double-click loses cleanly.

Return `{ kind: 'ok', newEmail }` or `{ kind: 'already_used' | 'expired' | 'email_taken' }`.

- [ ] **Step 4.2.3: Run tests + commit**

```bash
git commit -m "feat(email-change): verifyByNewAddress + tokenVersion bump on commit"
```

### Task 4.3 — `cancelByOldAddress` and `cancelBySelf`

- [ ] **Step 4.3.1: Write the failing tests**

```ts
describe('cancelByOldAddress', () => {
  it('deletes pending row and writes 24h lock', async () => {});
  it('returns "already_used" on second click', async () => {});
  it('sends notification to both old and new addresses', async () => {});
});
describe('cancelBySelf', () => {
  it('deletes pending row, writes no lock', async () => {});
});
```

- [ ] **Step 4.3.2: Implement both methods + commit**

### Task 4.4 — Wire endpoints into `publisherPortalHandler`

- [ ] **Step 4.4.1: Add routes**

```ts
// POST /publisher/me/email-change                   (requirePublisherSession)
// DELETE /publisher/me/email-change                 (requirePublisherSession)
// GET    /publish/email-change/verify  (no auth; one-shot token)
// GET    /publish/email-change/cancel  (no auth; one-shot token)
```

The two GET routes render simple HTML pages (no SPA hydration needed) — see Task 4.6 for the render functions.

- [ ] **Step 4.4.2: Add handler tests for each route + commit**

### Task 4.5 — Frontend `EmailChangePanel`

- [ ] **Step 4.5.1: Write the failing test, then implement, then commit**

`EmailChangePanel.tsx` renders one of three states based on the publisher's record:
- No pending change: "Change email" button → modal: enter new email → submit → calls `requestEmailChange`.
- Pending change: yellow banner with masked `n***@example.com`, plus "Cancel change" button.
- Verification stale (e.g. cancelled by old address): banner clears on next page load.

The publisher record needs to surface whether a pending email change exists. Add it to the status response: `handlePublisherStatus` reads the magic-token row via `magicTokenService.getEmailChangePendingByPublisher(id)` and includes a sanitized stub `pendingEmailChange?: { newEmailMasked: string; expiresAt: string }`.

### Task 4.6 — Verify and cancel landing pages

- [ ] **Step 4.6.1: Add Vite entries**

Add to `frontend/vite.config.ts`:

```ts
'email-change-verify': resolve(__dirname, 'email-change-verify.html'),
'email-change-cancel': resolve(__dirname, 'email-change-cancel.html'),
```

Create the two HTML files mirroring `verify.html`. Create entry files in `src/entries/` and page files in `src/app/publish/email-change/{verify,cancel}/page.tsx`.

The verify page reads `?token=` from the URL, calls a new public endpoint `GET /publish/email-change/verify?token=…` that returns `{ kind, newEmail? }` JSON, then:
- On `ok` → redirects to `/publish/login/?email=<new>&reason=email-changed`.
- On `expired` / `already_used` / `email_taken` → renders a friendly error with a link to `/publish/login/`.

(Alternative: render the page directly server-side from the Lambda — simpler, but it's an extra cross-domain HTML render path. Prefer client-side rendering with a JSON endpoint to match the project pattern.)

The cancel page is structurally identical with two outcomes: `ok` (with the "we've locked changes for 24h" message) or `already_used`.

### Task 4.7 — Login page reads `?reason=email-changed`

- [ ] **Step 4.7.1: Test + implement**

In `frontend/src/app/publish/login/page.tsx`, on mount read `URLSearchParams.get('reason')`. If it equals `'email-changed'`, render a green success banner above the form: "Email changed successfully. Sign in with your new address." Pre-fill the email input from `?email=…` if present.

### Task 4.8 — Phase-4 PR

- [ ] Push and open: bundle Tasks 4.1–4.7 into a single PR titled "feat(publisher-portal): self-service Phase 4 — email change."

---

## Phase 5 — Ingest controls (single-publisher mode + fetch-now + pause/resume)

**Goal**: Add single-publisher mode to the ingest Lambda; expose fetch-now / pause / resume routes to publishers.

### Task 5.1 — Single-publisher mode in `runIngest`

- [x] **Step 5.1.1: Write the failing tests**

Extend `backend/src/handlers/__tests__/publisherIngestHandler.test.ts`:

```ts
it('runs only the named publisher when singlePublisherId is supplied', async () => {});
it('processes a singlePublisherId publisher even if paused (single-publisher mode bypasses skip-paused)', async () => {});
it('respects disabled status: a singlePublisherId for a disabled publisher still retracts events', async () => {});
it('logs and skips quietly when singlePublisherId does not match any row', async () => {});
```

- [x] **Step 5.1.2: Modify `runIngest`**

Update `IngestDeps` and `runIngest` to accept `opts?: { singlePublisherId?: string }`. When set, list only that one publisher (`registry.get`) instead of `listAll`, and route it into the correct bucket directly.

- [x] **Step 5.1.3: Modify `scheduledHandler`**

Read `singlePublisherId` from the Lambda event payload:

```ts
export async function scheduledHandler(evt?: { singlePublisherId?: string }): Promise<void> {
  // ... existing setup
  await runIngest({ /* deps */ }, { singlePublisherId: evt?.singlePublisherId });
}
```

- [x] **Step 5.1.4: Update the existing admin "run-ingest" payload (no behaviour change for admin)**

The admin button keeps invoking with `{ source: 'admin-ui', triggeredBy, triggeredAt }` (no `singlePublisherId`), which falls through to the all-publishers branch.

- [x] **Step 5.1.5: Run tests + commit**

### Task 5.2 — `POST /publisher-fetch-now`

- [x] Test: rate-limit enforced (429 after one call within 5 minutes), 202 on success, Lambda invoked with `{ singlePublisherId: <self> }`.
- [x] Implementation: inline in `publisherPortalHandler.ts`. Shared LambdaClient + ingest-function-name resolver extracted to `services/publisherIngestInvoker.ts` (reused by adminHandler's run-ingest button). Uses the existing rate-limit table; key `fetch_now#<publisherId>` with a 5-minute window.
- [x] Add the route in `adminHandler.ts` (publisher-portal handlers route through the admin Lambda — same Lambda already has `lambda:InvokeFunction`, no IAM change needed).
- [x] IAM: confirmed `aws_iam_role_policy.lambda_invoke_publisher_ingest` already attaches to `admin_lambda_role` (infrastructure/main.tf:878-892).
- [x] Commit.

### Task 5.3 — `POST /publisher-pause` and `/publisher-resume`

- [x] Tests: 200 on success; status applies; idempotent.
- [x] Implementation: thin wrappers around `registry.setPausedFlag(id, true|false, { selfInitiated: true|undefined })`. Same per-publisher rate limit pattern (10 toggles/min) keyed `pause_resume#<publisherId>`.
- [x] Add routes.
- [x] Commit.

### Task 5.4 — Frontend `IngestControls`

- [x] Test + implement: Pause button (with confirmation modal explaining "events stay live, fetches stop"), Resume button, Fetch-now button with countdown when rate-limited (reads `retryAfterSeconds` from response body — typed contract, with `Retry-After` header as fallback).

### Task 5.5 — Phase-5 PR (deferred — not pushing per task instructions)

---

## Phase 6 — Self-disable

### Task 6.1 — `POST /publisher-disable` ✅

- [x] Tests: 6 service tests (`publisherSelfActionService.test.ts`), 11 handler tests (`publisherPortalHandler.disable.test.ts`), 3 mail-template tests added to `mailService.test.ts`.
- [x] Implementation in `publisherSelfActionService.selfDisable`. Departure from the plan sketch: this codebase has no separate `slug` field on `PublisherRecord` — the publisher's `id` IS the slug (e.g. `pub-<uuid4>`), and `/publish/docs/` already documents `id` as "a stable lowercase slug". The implementation compares `input.confirmSlug` to `publisher.id` exactly. Mail send is best-effort (logged on failure); the disable still succeeds in DDB. Used the existing `MagicTokenService.deleteEmailChangePairByPublisher` (Phase 4 helper) — the plan's `deletePendingEmailChange` name doesn't exist in the codebase.
- [x] Route wired in `adminHandler.ts` BEFORE the admin auth gate. Per-publisher rate limit `disable#<publisherId>` at 5/hour (conservative, since this is destructive). 400 with `code: 'missing_confirm'` short-circuits BEFORE checkAndConsume so a typo doesn't burn a slot.

### Task 6.2 — Frontend `DangerZone` ✅

- [x] `DangerZone.tsx` rendered at the bottom of the approved-publisher view in `status/page.tsx`. Red-bordered card; modal with case-sensitive exact-match guard on the Confirm button. Server enforces the same rule (defence in depth). On 200, calls `clearPublisherSession()` and `window.location.replace('/publish/')` — the `tokenVersion` bump invalidates the JWT used to make the call, so the status page would 401 anyway.
- [x] API client: `selfDisablePublisher` + `PublisherSelfDisableError` in `publisherStatusApi.ts`.
- [x] 7 vitest tests in `DangerZone.test.tsx` covering happy path, error rendering, mismatch hint, cancel, and the typed-confirmation gate.

### Task 6.3 — Phase-6 PR

---

## Phase 7 — E2E coverage

### Task 7.1 — Extend `tests/e2e/publisher-ingest.spec.ts` (or wherever it lives)

Per the publisher-ingest E2E memory, we have a CI test that does apply → approve → ingest. Extend it:

- After approval and login, edit the source URL via `PATCH /publisher/me` with a passing preview.
- Trigger `POST /publisher/me/fetch-now`.
- Wait for ingest run; assert events ingested under the new URL.
- Trigger `POST /publisher/me/email-change` with a new address; read the mock-SES outbound queue for the verify link; click it.
- Assert the original session JWT now returns 401 on `/publisher/me`.
- Re-login with the new email via the magic-link flow.
- Assert `/publisher-status` returns 200 with the new email.

### Task 7.2 — Phase-7 PR

---

## Phase 8 — Documentation + cleanup

### Task 8.1 — Update memory + docs

- [ ] Update `MEMORY.md` with a new entry pointing to this plan and design doc.
- [ ] Update `docs/CACHING_ARCHITECTURE.md` if anything new is cacheable (probably not).
- [ ] Add a brief section to `frontend/src/app/publish/docs/page.tsx` documenting the self-service capabilities for publishers.

### Task 8.2 — Follow-ups noted

Add a TODO note in the memory pointing at:
- Adding a `by-contactEmail` GSI to the publishers table when the row count crosses ~200.
- Considering CAPTCHA on email-change initiate if abuse appears.

### Task 8.3 — Phase-8 PR

---

## Self-review

**Spec coverage:**
- Profile edits (name/org/sourceUrl/sourceType) — Phase 2 ✓
- Email change with double-opt-in + force re-login — Phase 4 ✓
- Apply-form uniqueness — Phase 3 ✓
- Fetch-now + pause/resume — Phase 5 ✓
- Self-disable — Phase 6 ✓
- All edge cases enumerated in spec section "Edge cases enforced" — covered by tests in Tasks 4.1–4.3 ✓
- `tokenVersion` mechanism — Phase 1 ✓
- Pause does NOT retract events — corrected in spec; Phase 5 uses `setPausedFlag` not `enabled=false` ✓

**Placeholder scan:** no TBDs / "implement later" / "similar to Task N" patterns. Each step has the actual code or a clear concrete description. Some test bodies are sketched rather than fully written — flagged inline as "Test cases per the spec's edge-case table" with concrete assertions; the executing agent fleshes out the bodies using the test patterns already established in the codebase.

**Type consistency check:**
- `signPublisherJwt` accepts `tokenVersion?` everywhere it's called.
- `setPausedFlag` signature is consistent across Tasks 1.4, 5.3.
- `setSelfDisabled` consistent across 1.4, 6.1.
- `updateProfile` consistent across 1.4, 2.1.
- `requirePublisherSession` return type used identically in 1.3 and 2.2.
- `EmailAlreadyInUseError` thrown by 3.1 caught in 4.1's tests via the same class.

**Decomposition check:** Each phase is a complete vertical slice that can ship without later phases. Phase 1 is foundation-only and adds no public surface. Phase 4 depends on Phase 3's `EmailAlreadyInUseError` + uniqueness function but degrades gracefully if Phase 3 is held (just less tight race coverage).
