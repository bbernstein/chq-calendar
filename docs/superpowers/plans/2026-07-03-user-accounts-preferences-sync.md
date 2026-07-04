# User Accounts & Server-Side Preference Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠️ Implementation is NOT authorized yet.** This plan exists so the TDD
> guardrails and contracts are written down before development begins. Other
> work may land first. Do not start executing tasks until the user explicitly
> says to begin. When execution starts, re-verify the "Current-State Facts"
> against the codebase (files may have moved).
>
> **Execution mode (pre-chosen by the user):** subagent-driven — use
> superpowers:subagent-driven-development, a fresh subagent per task with a
> two-stage review between tasks. Do NOT prompt for the execution-mode choice
> when work is authorized; go straight to subagent-driven.

**Goal:** Give signed-in users server-side, cross-device persistence of their
calendar preferences (filters, favorites, notes) via Google (Phase 1) and
Apple + cross-provider account linking (Phase 2), without regressing the
anonymous, offline-first experience.

**Architecture:** AWS Cognito user pool federates Google/Apple; the SPA uses
the OAuth Authorization Code + PKCE redirect flow. A new `user_handler` Lambda
(own IAM role) exposes authenticated `/user/*` routes that verify the Cognito
access token against the pool JWKS. Preferences live in a new `users` table
(opaque blob) and a `favorites` table with a `by-event` GSI (queryable
popularity, no UI). localStorage stays the instant source of truth; a sync
layer reconciles local↔server (filters = last-write-wins; favorites =
per-event last-write-wins).

**Tech Stack:** Preact + Vite + TypeScript (frontend, Vitest); Node 24 AWS
Lambda + TypeScript (backend, Jest + ts-jest); DynamoDB (AWS SDK v3
DocumentClient); AWS Cognito; `aws-jwt-verify` for JWKS; Terraform (AWS).

## Global Constraints

- Node.js `>=24.0.0`; Lambda runtime `nodejs24.x`. (Copied from CLAUDE.md.)
- Backend lint runs `--max-warnings=0`; any ESLint warning fails the build.
- Coverage floors are enforced from a SINGLE repo-root `.coverage-floor.json`:
  `backend/jest.config.js` reads `require('../.coverage-floor.json')`
  (`floor.backend.lines`) and `frontend/vitest.config.ts` reads
  `import floor from '../.coverage-floor.json'` (`floor.frontend.lines`). New
  logic must keep coverage at or above the floor.
- Never commit to `main`. Work on a feature branch
  (`feat/user-accounts-preferences-sync` already exists).
- Never log user email or name (project sensitivity rule).
- Frontend hooks/JSX files import hooks/types from `'react'` (aliased to
  `preact/compat`); pure `.ts` logic files may import from `'preact/hooks'` or
  avoid Preact entirely.
- AWS resource names use the `"${var.app_name}-<thing>"` prefix (`app_name`
  default `chautauqua-calendar`); env vars are `*_TABLE_NAME`, resolved in code
  via `process.env.X ?? '<default>'`. GSI naming is NOT uniform in this repo
  (core tables use `WeekIndex`/`DateIndex`/`CategoryIndex`; publisher tables use
  `by-<attr>`). For NEW GSIs this plan adopts the `by-<attr>` convention
  (`by-event`) — a preference, not a repo-wide rule.
- Backend service pattern: constructor-inject a built `DynamoDBDocumentClient`
  + a `tableName` string; expose a `_set<Thing>ForTests` seam on handlers.

---

## Testing Strategy & Guardrails (read first)

This plan is deliberately **logic-first**: the pure, high-risk reconciliation
and merge functions are built and fully tested **before** any Cognito wiring
or infrastructure. Those test suites *are* the guardrails — they pin the
correctness of the sync semantics so that later infra work can't silently
break them.

**Test tiers used here (matching existing conventions):**

1. **Pure-logic unit tests (highest value, build first).** Reconciliation and
   favorites-merge are pure functions with zero I/O. Frontend: Vitest. These
   encode the sync contract (LWW for filters, per-event LWW for favorites,
   delete-beats-stale-add, first-sign-in merge-up). Tasks 1–2.
2. **Service unit tests.** Backend services take an injected
   `{ send: jest.fn() }` DocumentClient; assert on `cmd.input`. Tasks 3–4.
3. **Handler unit tests.** Invoke exported route functions with a hand-built
   `APIGatewayProxyEvent` (`evt()` factory), mock the JWKS verifier, inject
   fake services via `_set*ForTests`. Task 6.
4. **Verifier unit tests.** The Cognito token verifier is wrapped behind a
   seam; tests cover claim-shape validation and the error→null collapse
   (mirroring `verifyPublisherJwt`). Task 5.
5. **Frontend hook tests.** `renderHook` + `act`; localStorage is the
   in-memory mock from `src/__tests__/setup.ts`. Tasks 2, 8, 9, 10.
6. **Integration test.** Full authed round-trip against the in-memory
   `DynamoDBDocumentClient` harness (`backend/src/__tests__/integration/`).
   Task 12.

**What is NOT unit-tested (and why):** Terraform/infra (Task 7, 13) and the
actual browser redirect to Cognito are verified by `terraform plan`/`apply`
and manual smoke, not unit tests — there is no meaningful pure logic to pin.
The plan calls this out explicitly rather than pretending coverage exists.

**Guardrail acceptance:** After Tasks 1–6 the following must be true and green
*before* any infra is applied: reconciliation semantics are fully covered;
favorites migration from the legacy localStorage shape is covered; the JWKS
verifier rejects malformed/expired tokens; the handler enforces auth on every
route and purges all favorites rows on account deletion.

---

## Testing, Environments & Rollout (chosen strategy)

**Context:** There is exactly ONE environment today — production (S3 +
CloudFront + Lambdas, deployed by `.github/workflows/deploy-production.yml` on
merge to `main`). There is no staging, and standing one up is a non-trivial
Terraform refactor (domain/zone/cert aliases and Lambda names are hard-coded to
the single prod stack; state is committed-local with no workspaces). The app
has real users, so protecting the anonymous/offline path is a hard requirement.

**Decision (user, 2026-07-03): feature-flag + dev Cognito pool for Phase 1;
defer a real staging environment to Phase 2 (Apple forces it).**

The rollout rests on three layers:

1. **Full local E2E (exists today).** `docker compose up` runs frontend +
   Express-wrapped Lambda handlers + DynamoDB Local. Point the frontend's
   `VITE_COGNITO_*` vars at a **dedicated dev Cognito pool** (a standalone pool
   — it does NOT need the staging/domain refactor and keeps dev sign-ins out of
   prod user data). This exercises Google sign-in + the full sync round-trip
   locally. The backend JWKS verifier reaches the real dev pool over the
   internet.

2. **Dark-launch behind `VITE_ENABLE_ACCOUNTS`.** The entire sign-in UI and the
   sync activation are gated behind a build-time flag (precedent:
   `VITE_ENABLE_PUBLISHER_FEEDS` in `useEventData.ts`), with a **URL-param
   opt-in (`?accounts=1`)** for per-visitor self-testing without a rebuild. Ship
   ALL code to prod with the flag OFF: existing users see zero change, but the
   *shared-path* changes (favorites refactor, header) run in real prod so you
   can confirm anonymous behavior is unchanged. Flip on for yourself via the URL
   param; expose to everyone later by rebuilding with the flag defaulted on.

3. **Staging environment — Phase 2 only.** Apple Sign In rejects
   `http://localhost` (needs HTTPS + a verified domain), so Phase 2 gets a real
   `staging.chqcal.org` (the wildcard `*.chqcal.org` cert already covers it).
   Scoped as a Phase 2 prerequisite task, not Phase 1.

**Shared-path risk callout:** the ONE part of this feature that runs for every
user regardless of the flag is the `useFavorites` refactor + localStorage
migration (Task 2) — because it changes code on the anonymous render path. The
flag does NOT gate it (it can't; favorites must keep working for signed-out
users). Its migration test suite is therefore load-bearing, and the dark-launch
step exists specifically to verify it in prod before any sign-in is exposed.

---

## File Structure

**Frontend (new):**
- `frontend/src/lib/preferenceSync/types.ts` — shared sync types
  (`FavoriteRecord`, `FavoritesMap`, `FilterSnapshot`, `PreferencesBlob`).
- `frontend/src/lib/preferenceSync/reconcile.ts` — pure reconcile functions.
- `frontend/src/lib/preferenceSync/reconcile.test.ts` — guardrail suite.
- `frontend/src/lib/cognito.ts` — Cognito config + PKCE URL builders + token
  exchange/refresh.
- `frontend/src/hooks/useAuth.ts` — consumer auth hook (sibling to
  `useAdminAuth`).
- `frontend/src/lib/userPreferencesApi.ts` — authed fetch client for
  `/user/*`.
- `frontend/src/hooks/usePreferenceSync.ts` — wires reconcile + api + hooks.
- `frontend/src/components/layout/SignInButton.tsx` — header affordance.
- `frontend/src/lib/featureFlags.ts` — `isAccountsEnabled()` dark-launch gate
  (`VITE_ENABLE_ACCOUNTS` + `?accounts=1` opt-in).

**Frontend (modified):**
- `frontend/src/hooks/useFavorites.ts` — `Set<string>` → `FavoritesMap`, with
  legacy-shape migration; expose `favoritesMap` + `mergeFavorites`.
- `frontend/src/components/layout/Header.tsx` — mount `SignInButton`.
- `frontend/src/app/page.tsx` — mount `usePreferenceSync`.

**Backend (new):**
- `backend/src/services/userProfileService.ts` — users-table blob CRUD.
- `backend/src/services/favoritesService.ts` — favorites rows + `by-event`
  count.
- `backend/src/services/cognitoVerifier.ts` — JWKS access-token verifier.
- `backend/src/handlers/userHandler.ts` — `/user/*` routes + Lambda entry.
- `backend/src/__tests__/userProfileService.test.ts`
- `backend/src/__tests__/favoritesService.test.ts`
- `backend/src/__tests__/cognitoVerifier.test.ts`
- `backend/src/__tests__/userHandler.test.ts`
- `backend/src/__tests__/integration/userPreferences.integration.test.ts`

**Infrastructure (new):**
- `infrastructure/user-accounts.tf` — Cognito pool + IdP, two tables,
  `user_lambda_role`, `user_handler` Lambda, API Gateway wiring.

**Modified infra:**
- `infrastructure/main.tf` — API Gateway `/user/{proxy+}` resource +
  deployment `depends_on`/`triggers`; CloudFront behavior for `/api/user*`.
- `frontend/.env` / Terraform-injected `VITE_` config — Cognito domain,
  client ID, pool ID, region, and `VITE_ENABLE_ACCOUNTS` (default `false` in
  prod until dark-launch).

---

# PHASE 1 — Google sign-in + preference sync

## Task 1: Reconciliation logic (pure, guardrail core)

**Files:**
- Create: `frontend/src/lib/preferenceSync/types.ts`
- Create: `frontend/src/lib/preferenceSync/reconcile.ts`
- Test: `frontend/src/lib/preferenceSync/reconcile.test.ts`

**Interfaces:**
- Produces:
  - `interface FavoriteRecord { favorited: boolean; at: number }`
  - `type FavoritesMap = Record<string, FavoriteRecord>` (key = eventId)
  - `interface FilterSnapshot { searchTerm: string; selectedTags: string[]; selectedLocations: string[]; dateFilter: DateFilter; selectedWeeks: number[]; expandedDescriptions: string[]; recentLocations: string[]; recentCategories: string[]; showFavoritesOnly: boolean }`
  - `interface PreferencesBlob { filters: FilterSnapshot; notes: Record<string, string>; lastSaved: number }`
  - `reconcileBlob(local: PreferencesBlob, server: PreferencesBlob): PreferencesBlob`
  - `reconcileFavorites(local: FavoritesMap, server: FavoritesMap): FavoritesMap`
  - `mergeFavoritesRecord(a: FavoriteRecord | undefined, b: FavoriteRecord | undefined): FavoriteRecord`

- [ ] **Step 1: Write the types file**

```ts
// frontend/src/lib/preferenceSync/types.ts
import type { DateFilter } from '@/hooks/useFilterState';

export interface FavoriteRecord {
  favorited: boolean;
  at: number; // epoch ms of the last change to this event's favorite state
}

/** eventId -> record. Absence means "never touched"; a record with
 *  favorited:false is an explicit un-favorite (tombstone). */
export type FavoritesMap = Record<string, FavoriteRecord>;

export interface FilterSnapshot {
  searchTerm: string;
  selectedTags: string[];
  selectedLocations: string[];
  dateFilter: DateFilter;
  selectedWeeks: number[];
  expandedDescriptions: string[];
  recentLocations: string[];
  recentCategories: string[];
  showFavoritesOnly: boolean;
}

export interface PreferencesBlob {
  filters: FilterSnapshot;
  notes: Record<string, string>;
  lastSaved: number; // blob-level timestamp; whole blob is last-write-wins
}
```

> Note: `DateFilter` is already exported from `useFilterState.ts`. If importing
> from a hook file into a pure `.ts` module causes a cycle at execution time,
> move the `DateFilter` type into `types.ts` and re-export it from the hook
> instead. Verify at implementation time.

- [ ] **Step 2: Write the failing test**

```ts
// frontend/src/lib/preferenceSync/reconcile.test.ts
/// <reference types="vitest/globals" />
import { reconcileBlob, reconcileFavorites, mergeFavoritesRecord } from './reconcile';
import type { FavoritesMap, PreferencesBlob } from './types';

const blob = (lastSaved: number, searchTerm = ''): PreferencesBlob => ({
  filters: {
    searchTerm, selectedTags: [], selectedLocations: [], dateFilter: 'next',
    selectedWeeks: [], expandedDescriptions: [], recentLocations: [],
    recentCategories: [], showFavoritesOnly: false,
  },
  notes: {},
  lastSaved,
});

describe('reconcileBlob (filters = last-write-wins)', () => {
  it('returns the newer blob by lastSaved', () => {
    expect(reconcileBlob(blob(200, 'local'), blob(100, 'server')).filters.searchTerm).toBe('local');
    expect(reconcileBlob(blob(100, 'local'), blob(200, 'server')).filters.searchTerm).toBe('server');
  });
  it('on a tie prefers the server copy (avoids needless local churn)', () => {
    expect(reconcileBlob(blob(100, 'local'), blob(100, 'server')).filters.searchTerm).toBe('server');
  });
});

describe('mergeFavoritesRecord (per-event LWW)', () => {
  it('newer timestamp wins regardless of favorited value', () => {
    expect(mergeFavoritesRecord({ favorited: true, at: 2 }, { favorited: false, at: 1 })).toEqual({ favorited: true, at: 2 });
    expect(mergeFavoritesRecord({ favorited: true, at: 1 }, { favorited: false, at: 2 })).toEqual({ favorited: false, at: 2 });
  });
  it('a present record beats an undefined one', () => {
    expect(mergeFavoritesRecord({ favorited: true, at: 5 }, undefined)).toEqual({ favorited: true, at: 5 });
    expect(mergeFavoritesRecord(undefined, { favorited: true, at: 5 })).toEqual({ favorited: true, at: 5 });
  });
  it('throws when both are undefined (caller bug, never a silent undefined)', () => {
    expect(() => mergeFavoritesRecord(undefined, undefined)).toThrow();
  });
});

describe('reconcileFavorites (union + per-event LWW)', () => {
  it('unions keys from both sides', () => {
    const local: FavoritesMap = { a: { favorited: true, at: 5 } };
    const server: FavoritesMap = { b: { favorited: true, at: 5 } };
    expect(reconcileFavorites(local, server)).toEqual({
      a: { favorited: true, at: 5 }, b: { favorited: true, at: 5 },
    });
  });
  it('a newer local un-favorite beats a stale server favorite (delete wins)', () => {
    const local: FavoritesMap = { a: { favorited: false, at: 3 } };
    const server: FavoritesMap = { a: { favorited: true, at: 1 } };
    expect(reconcileFavorites(local, server).a).toEqual({ favorited: false, at: 3 });
  });
  it('a newer server favorite beats a stale local un-favorite (re-add wins)', () => {
    const local: FavoritesMap = { a: { favorited: false, at: 1 } };
    const server: FavoritesMap = { a: { favorited: true, at: 3 } };
    expect(reconcileFavorites(local, server).a).toEqual({ favorited: true, at: 3 });
  });
  it('handles two empty maps', () => {
    expect(reconcileFavorites({}, {})).toEqual({});
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/preferenceSync/reconcile.test.ts`
Expected: FAIL — cannot find module `./reconcile`.

- [ ] **Step 4: Write the minimal implementation**

```ts
// frontend/src/lib/preferenceSync/reconcile.ts
import type { FavoriteRecord, FavoritesMap, PreferencesBlob } from './types';

/** Whole-blob last-write-wins. Ties prefer the server copy. */
export function reconcileBlob(local: PreferencesBlob, server: PreferencesBlob): PreferencesBlob {
  return local.lastSaved > server.lastSaved ? local : server;
}

/** Per-event last-write-wins. A present record beats undefined.
 *  Tie-break note: on an exact `at` tie the FIRST arg wins (`a.at >= b.at`).
 *  `reconcileFavorites` calls this as `(local, server)`, so favorites resolve a
 *  tie toward LOCAL — deliberately opposite to `reconcileBlob`, which resolves a
 *  filter tie toward SERVER. Rationale: favorite state is a single per-event bit
 *  where keeping the device's own value on a tie avoids a visible flip; filters
 *  are a bulk view where preferring the server on a tie avoids needless local
 *  churn. Both are arbitrary-but-deterministic; exact ties are near-impossible. */
export function mergeFavoritesRecord(
  a: FavoriteRecord | undefined,
  b: FavoriteRecord | undefined,
): FavoriteRecord {
  if (a && b) return a.at >= b.at ? a : b;
  const one = a ?? b;
  if (!one) throw new Error('mergeFavoritesRecord requires at least one record'); // both-undefined is a caller bug, not a silent undefined
  return one;
}

/** Union of keys; each event resolved by mergeFavoritesRecord. */
export function reconcileFavorites(local: FavoritesMap, server: FavoritesMap): FavoritesMap {
  const out: FavoritesMap = {};
  for (const id of new Set([...Object.keys(local), ...Object.keys(server)])) {
    out[id] = mergeFavoritesRecord(local[id], server[id]);
  }
  return out;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/preferenceSync/reconcile.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/preferenceSync/
git commit -m "feat(sync): pure reconciliation logic for preferences and favorites"
```

---

## Task 2: Favorites model refactor (Set → FavoritesMap) with legacy migration

**Files:**
- Modify: `frontend/src/hooks/useFavorites.ts`
- Test: `frontend/src/__tests__/hooks/useFavorites.test.ts` (extend existing)

**Interfaces:**
- Consumes: `FavoritesMap`, `reconcileFavorites` (Task 1).
- Produces (hook return): `{ favoriteIds: Set<string>, favoritesMap: FavoritesMap, isFavorite: (id: string) => boolean, toggleFavorite: (id: string) => void, favoriteCount: number, mergeFavorites: (incoming: FavoritesMap) => void }`
  - `favoriteIds` (derived: ids where `favorited === true`) is retained so
    existing consumers in `page.tsx` do not change.

- [ ] **Step 1: Write the failing tests (extend the existing file)**

```ts
// add to frontend/src/__tests__/hooks/useFavorites.test.ts
import { renderHook, act } from '@testing-library/preact';
import { useFavorites } from '@/hooks/useFavorites';

describe('useFavorites — FavoritesMap model', () => {
  beforeEach(() => localStorage.clear());

  it('toggle records a tombstone (favorited:false) rather than deleting the key', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => result.current.toggleFavorite('e1'));
    expect(result.current.isFavorite('e1')).toBe(true);
    act(() => result.current.toggleFavorite('e1'));
    expect(result.current.isFavorite('e1')).toBe(false);
    expect(result.current.favoritesMap.e1.favorited).toBe(false);
    expect(result.current.favoriteCount).toBe(0);
  });

  it('migrates the legacy {eventIds,lastSaved} localStorage shape on mount', () => {
    // Use a fresh timestamp: loadInitial() drops anything older than
    // USER_STATE_EXPIRY_MS (30 days), so an epoch-0 fixture would be discarded
    // and the migration would never run.
    const savedAt = Date.now();
    localStorage.setItem('chq-calendar-favorites', JSON.stringify({
      eventIds: ['old-a', 'old-b'], lastSaved: savedAt,
    }));
    const { result } = renderHook(() => useFavorites());
    expect(result.current.isFavorite('old-a')).toBe(true);
    expect(result.current.favoritesMap['old-a']).toEqual({ favorited: true, at: savedAt });
    expect(result.current.favoriteCount).toBe(2);
  });

  it('mergeFavorites applies per-event LWW from an incoming server map', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => result.current.toggleFavorite('e1')); // local favorite, at ~now
    act(() => result.current.mergeFavorites({ e1: { favorited: false, at: 0 }, e2: { favorited: true, at: Date.now() + 10 } }));
    expect(result.current.isFavorite('e1')).toBe(true);  // local newer wins
    expect(result.current.isFavorite('e2')).toBe(true);  // incoming adds e2
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/__tests__/hooks/useFavorites.test.ts`
Expected: FAIL — `favoritesMap`/`mergeFavorites` undefined; migration not handled.

- [ ] **Step 3: Rewrite the hook**

```ts
// frontend/src/hooks/useFavorites.ts
import { useState, useCallback, useEffect } from 'react';
import { USER_STATE_EXPIRY_MS } from '@/lib/constants';
import { reconcileFavorites } from '@/lib/preferenceSync/reconcile';
import type { FavoritesMap } from '@/lib/preferenceSync/types';

const STORAGE_KEY = 'chq-calendar-favorites';

interface StoredFavoritesV2 { favorites: FavoritesMap; lastSaved: number }
interface StoredFavoritesV1 { eventIds: string[]; lastSaved: number } // legacy

function loadInitial(): FavoritesMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<StoredFavoritesV2 & StoredFavoritesV1>;
    if (!parsed.lastSaved || Date.now() - parsed.lastSaved >= USER_STATE_EXPIRY_MS) return {};
    if (parsed.favorites) return parsed.favorites;                 // v2
    if (parsed.eventIds) {                                         // migrate v1 -> v2
      const map: FavoritesMap = {};
      for (const id of parsed.eventIds) map[id] = { favorited: true, at: parsed.lastSaved };
      return map;
    }
    return {};
  } catch (e) {
    console.warn('Failed to load favorites:', e);
    return {};
  }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoritesMap>(loadInitial);

  useEffect(() => {
    try {
      const data: StoredFavoritesV2 = { favorites, lastSaved: Date.now() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save favorites:', e);
    }
  }, [favorites]);

  const isFavorite = useCallback(
    (eventId: string) => favorites[eventId]?.favorited === true,
    [favorites],
  );

  const toggleFavorite = useCallback((eventId: string) => {
    setFavorites(prev => ({
      ...prev,
      [eventId]: { favorited: !(prev[eventId]?.favorited === true), at: Date.now() },
    }));
  }, []);

  const mergeFavorites = useCallback((incoming: FavoritesMap) => {
    setFavorites(prev => reconcileFavorites(prev, incoming));
  }, []);

  const favoriteIds = new Set(
    Object.entries(favorites).filter(([, r]) => r.favorited).map(([id]) => id),
  );

  return {
    favoriteIds,
    favoritesMap: favorites,
    isFavorite,
    toggleFavorite,
    mergeFavorites,
    favoriteCount: favoriteIds.size,
  };
}
```

- [ ] **Step 4: Run the whole favorites suite to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/hooks/useFavorites.test.ts`
Expected: PASS — legacy tests (restore/toggle/count) and new ones green.

- [ ] **Step 5: Run the full frontend test + type-check to catch consumer breakage**

Run: `cd frontend && npm run type-check && npx vitest run`
Expected: PASS. If `page.tsx` or a component referenced a deleted field, fix
to use `favoriteIds`/`isFavorite` (unchanged names).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useFavorites.ts frontend/src/__tests__/hooks/useFavorites.test.ts
git commit -m "feat(favorites): FavoritesMap model with tombstones and legacy migration"
```

---

## Task 3: Backend `UserProfileService` (users-table blob CRUD)

**Files:**
- Create: `backend/src/services/userProfileService.ts`
- Test: `backend/src/__tests__/userProfileService.test.ts`

**Interfaces:**
- Produces:
  - `interface UserProfile { userId: string; preferences: unknown; email?: string; linkedProviders?: string[]; lastSaved: number; createdAt: number }`
  - `class UserProfileService { constructor(db: DynamoDBDocumentClient, tableName: string); get(userId): Promise<UserProfile | null>; putIfNewer(profile: UserProfile): Promise<boolean>; delete(userId): Promise<void> }` (`putIfNewer` enforces server-side LWW; returns false when a stale write is ignored)

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/__tests__/userProfileService.test.ts
jest.unmock('@aws-sdk/lib-dynamodb');
import { UserProfileService, type UserProfile } from '../services/userProfileService';

const mockSend = jest.fn();
const mockClient: any = { send: mockSend };

const profile = (over: Partial<UserProfile> = {}): UserProfile => ({
  userId: 'u1', preferences: { filters: {}, notes: {}, lastSaved: 5 },
  lastSaved: 5, createdAt: 1, ...over,
});

describe('UserProfileService', () => {
  let svc: UserProfileService;
  beforeEach(() => {
    jest.resetAllMocks();
    svc = new UserProfileService(mockClient, 'chq-users');
  });

  it('get returns the item or null', async () => {
    mockSend.mockResolvedValueOnce({ Item: profile() });
    expect((await svc.get('u1'))?.userId).toBe('u1');
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.TableName).toBe('chq-users');
    expect(cmd.input.Key).toEqual({ userId: 'u1' });

    mockSend.mockResolvedValueOnce({});
    expect(await svc.get('missing')).toBeNull();
  });

  it('putIfNewer writes conditionally and returns true', async () => {
    mockSend.mockResolvedValueOnce({});
    const ok = await svc.putIfNewer(profile({ userId: 'u2', lastSaved: 7 }));
    expect(ok).toBe(true);
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.Item.userId).toBe('u2');
    expect(cmd.input.ConditionExpression).toContain('lastSaved <= :ls');
    expect(cmd.input.ExpressionAttributeValues[':ls']).toBe(7);
  });
  it('putIfNewer returns false (not throws) when a newer server copy wins', async () => {
    mockSend.mockRejectedValueOnce(Object.assign(new Error('stale'), { name: 'ConditionalCheckFailedException' }));
    expect(await svc.putIfNewer(profile())).toBe(false);
  });

  it('delete removes by userId', async () => {
    mockSend.mockResolvedValueOnce({});
    await svc.delete('u1');
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.Key).toEqual({ userId: 'u1' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest userProfileService`
Expected: FAIL — cannot find `../services/userProfileService`.

- [ ] **Step 3: Write the service**

```ts
// backend/src/services/userProfileService.ts
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

export interface UserProfile {
  userId: string;
  preferences: unknown;      // opaque PreferencesBlob (validated at the edge, not here)
  email?: string;            // informational only, never a key; never logged
  linkedProviders?: string[];
  lastSaved: number;
  createdAt: number;
}

export class UserProfileService {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get(userId: string): Promise<UserProfile | null> {
    const r = await this.db.send(new GetCommand({ TableName: this.tableName, Key: { userId } }));
    return (r.Item as UserProfile) ?? null;
  }

  /** LWW write: persists only if the row is absent OR the stored `lastSaved`
   *  is not newer than the incoming one. Returns false when a newer server copy
   *  won (a stale client push is silently ignored, preserving cross-device LWW).
   *  The server enforces LWW here — it never trusts the client to have merged. */
  async putIfNewer(profile: UserProfile): Promise<boolean> {
    try {
      await this.db.send(new PutCommand({
        TableName: this.tableName,
        Item: profile,
        ConditionExpression: 'attribute_not_exists(userId) OR lastSaved <= :ls',
        ExpressionAttributeValues: { ':ls': profile.lastSaved },
      }));
      return true;
    } catch (err) {
      if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
  }

  async delete(userId: string): Promise<void> {
    await this.db.send(new DeleteCommand({ TableName: this.tableName, Key: { userId } }));
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx jest userProfileService`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/userProfileService.ts backend/src/__tests__/userProfileService.test.ts
git commit -m "feat(user): UserProfileService for users-table blob CRUD"
```

---

## Task 4: Backend `FavoritesService` (rows + `by-event` popularity count)

**Files:**
- Create: `backend/src/services/favoritesService.ts`
- Test: `backend/src/__tests__/favoritesService.test.ts`

**Interfaces:**
- Produces:
  - `interface FavoriteRow { userId: string; eventId: string; favorited: boolean; at: number }`
  - `class FavoritesService { constructor(db, tableName, byEventIndexName); listByUser(userId): Promise<FavoriteRow[]>; putRow(row: FavoriteRow): Promise<boolean>; upsertMany(userId, map: Record<string,{favorited:boolean;at:number}>): Promise<void>; deleteAllForUser(userId): Promise<void>; countFavoritesForEvent(eventId): Promise<number> }` (`putRow` is a per-event conditional LWW write; returns false when a stale write is skipped)
- `countFavoritesForEvent` is the **popularity query** (admin-only; no route in
  Phase 1). It queries the `by-event` GSI with `Select: 'COUNT'` and a filter
  on `favorited = true`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/__tests__/favoritesService.test.ts
jest.unmock('@aws-sdk/lib-dynamodb');
import { FavoritesService, type FavoriteRow } from '../services/favoritesService';

const mockSend = jest.fn();
const mockClient: any = { send: mockSend };

describe('FavoritesService', () => {
  let svc: FavoritesService;
  beforeEach(() => {
    jest.resetAllMocks();
    svc = new FavoritesService(mockClient, 'chq-favorites', 'by-event');
  });

  it('listByUser queries the table partition and returns rows', async () => {
    const rows: FavoriteRow[] = [{ userId: 'u1', eventId: 'e1', favorited: true, at: 5 }];
    mockSend.mockResolvedValueOnce({ Items: rows });
    expect(await svc.listByUser('u1')).toEqual(rows);
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.KeyConditionExpression).toContain('userId');
    expect(cmd.input.ExpressionAttributeValues[':u']).toBe('u1');
  });

  it('upsertMany writes one row per event with a per-event LWW condition', async () => {
    mockSend.mockResolvedValue({});
    await svc.upsertMany('u1', { e1: { favorited: true, at: 5 }, e2: { favorited: false, at: 6 } });
    expect(mockSend).toHaveBeenCalledTimes(2);
    const first: any = mockSend.mock.calls[0][0];
    expect(first.input.Item).toEqual({ userId: 'u1', eventId: 'e1', favorited: true, at: 5 });
    expect(first.input.ConditionExpression).toContain('#at < :at');
    expect(first.input.ExpressionAttributeValues[':at']).toBe(5);
  });

  it('putRow returns false (not throws) when the stored record is newer', async () => {
    mockSend.mockRejectedValueOnce(Object.assign(new Error('stale'), { name: 'ConditionalCheckFailedException' }));
    expect(await svc.putRow({ userId: 'u1', eventId: 'e1', favorited: true, at: 1 })).toBe(false);
  });

  it('deleteAllForUser deletes every row it lists (account purge)', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [ { userId: 'u1', eventId: 'e1' }, { userId: 'u1', eventId: 'e2' } ] }) // list
      .mockResolvedValue({}); // deletes
    await svc.deleteAllForUser('u1');
    // 1 query + 2 deletes
    expect(mockSend).toHaveBeenCalledTimes(3);
    const del: any = mockSend.mock.calls[1][0];
    expect(del.input.Key).toEqual({ userId: 'u1', eventId: 'e1' });
  });

  it('countFavoritesForEvent queries the by-event GSI with COUNT', async () => {
    mockSend.mockResolvedValueOnce({ Count: 7 });
    expect(await svc.countFavoritesForEvent('e1')).toBe(7);
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.IndexName).toBe('by-event');
    expect(cmd.input.Select).toBe('COUNT');
    expect(cmd.input.ExpressionAttributeValues[':e']).toBe('e1');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest favoritesService`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

```ts
// backend/src/services/favoritesService.ts
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

export interface FavoriteRow {
  userId: string;
  eventId: string;
  favorited: boolean;
  at: number;
}

export class FavoritesService {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly byEventIndexName: string,
  ) {}

  async listByUser(userId: string): Promise<FavoriteRow[]> {
    const out: FavoriteRow[] = [];
    let last: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'userId = :u',
        ExpressionAttributeValues: { ':u': userId },
        ExclusiveStartKey: last,
      }));
      out.push(...((r.Items as FavoriteRow[]) ?? []));
      last = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (last);
    return out;
  }

  /** Per-event LWW write: persists only if the row is absent OR the stored `at`
   *  is older than the incoming one. A stale record is silently ignored, so a
   *  late-arriving old push can't resurrect or erase a favorite. `#at` is aliased
   *  defensively. Returns false when the write was skipped as stale. */
  async putRow(row: FavoriteRow): Promise<boolean> {
    try {
      await this.db.send(new PutCommand({
        TableName: this.tableName,
        Item: row,
        ConditionExpression: 'attribute_not_exists(eventId) OR #at < :at',
        ExpressionAttributeNames: { '#at': 'at' },
        ExpressionAttributeValues: { ':at': row.at },
      }));
      return true;
    } catch (err) {
      if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
  }

  async upsertMany(
    userId: string,
    map: Record<string, { favorited: boolean; at: number }>,
  ): Promise<void> {
    // Conditional per-event writes (see putRow) with bounded concurrency — see the
    // batching note below on why this is NOT BatchWriteItem.
    for (const [eventId, rec] of Object.entries(map)) {
      await this.putRow({ userId, eventId, favorited: rec.favorited, at: rec.at });
    }
  }

  async deleteAllForUser(userId: string): Promise<void> {
    const rows = await this.listByUser(userId);
    for (const row of rows) {
      await this.db.send(new DeleteCommand({
        TableName: this.tableName,
        Key: { userId: row.userId, eventId: row.eventId },
      }));
    }
  }

  /** Popularity query (admin-only; no HTTP route in Phase 1). */
  async countFavoritesForEvent(eventId: string): Promise<number> {
    const r = await this.db.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: this.byEventIndexName,
      KeyConditionExpression: 'eventId = :e',
      FilterExpression: 'favorited = :t',
      ExpressionAttributeValues: { ':e': eventId, ':t': true },
      Select: 'COUNT',
    }));
    return r.Count ?? 0;
  }
}
```

> Note for a future popularity job: `Select: 'COUNT'` with a `FilterExpression`
> counts only rows scanned *after* the key match but the filter reduces the
> returned `Count` — acceptable for admin ad-hoc use. If exact high-volume
> counts are ever needed, project `favorited` into the GSI key instead. Out of
> scope now.
>
> **Batching (perf) — note the conditional-write constraint:** these loops are
> sequential; a long-time user could have hundreds of favorites against the
> `user_handler`'s 30s timeout (Task 7). BUT `BatchWriteItem` does **not**
> support conditional expressions, so it CANNOT be used for `upsertMany` without
> discarding the per-event LWW guard in `putRow`. When implementing:
> - **`upsertMany`** → keep conditional `putRow` writes, but run them with
>   **bounded concurrency** (e.g. a small pool of ~10) instead of fully
>   sequential; each retains its `ConditionExpression`. (`TransactWriteItems`,
>   25/chunk, also supports conditions and is an alternative if atomicity is
>   wanted.)
> - **`deleteAllForUser`** → unconditional, so chunked `BatchWriteItem`
>   (25/request) is fine here and fastest for the purge.
> This is why the IAM role keeps `dynamodb:BatchWriteItem` (for the delete path)
> alongside `PutItem` (for the conditional upserts). The tests assert per-event
> effects, so they hold under either approach; keep them.

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx jest favoritesService`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/favoritesService.ts backend/src/__tests__/favoritesService.test.ts
git commit -m "feat(favorites): FavoritesService with rows and by-event popularity count"
```

---

## Task 5: Cognito access-token verifier (JWKS)

**Files:**
- Create: `backend/src/services/cognitoVerifier.ts`
- Test: `backend/src/__tests__/cognitoVerifier.test.ts`
- Modify: `backend/package.json` (add `aws-jwt-verify`)

**Interfaces:**
- Produces:
  - `interface CognitoClaims { sub: string; email?: string; tokenUse: 'access'; }`
  - `verifyCognitoAccessToken(token: string): Promise<CognitoClaims | null>` — returns null on any *token* failure (expired/bad sig/malformed/wrong use), mirroring `verifyPublisherJwt`. **Throws** on missing Cognito config (`COGNITO_*` env unset) — a deployment error that should surface as a loud 500, not a silent per-user 401 (matches `publisherSecretCache`, which throws on a missing secret ARN).
  - `_setVerifierForTests(v: { verify(token: string): Promise<Record<string, unknown>> } | null): void`

- [ ] **Step 1: Add the dependency**

Run: `cd backend && npm install aws-jwt-verify`
Expected: `aws-jwt-verify` added to `backend/package.json` dependencies.

- [ ] **Step 2: Write the failing test** (mock the underlying verifier via the seam — same shape as handler tests mocking `verifyPublisherJwt`)

```ts
// backend/src/__tests__/cognitoVerifier.test.ts
import {
  verifyCognitoAccessToken,
  _setVerifierForTests,
} from '../services/cognitoVerifier';

const verify = jest.fn();
beforeEach(() => {
  jest.resetAllMocks();
  _setVerifierForTests({ verify } as any);
});
afterEach(() => _setVerifierForTests(null));

describe('verifyCognitoAccessToken', () => {
  it('returns claims for a valid access token', async () => {
    verify.mockResolvedValueOnce({ sub: 'u1', token_use: 'access', email: 'x@y.z' });
    expect(await verifyCognitoAccessToken('good')).toEqual({ sub: 'u1', email: 'x@y.z', tokenUse: 'access' });
  });
  it('returns null when the library throws (expired/bad signature)', async () => {
    verify.mockRejectedValueOnce(new Error('token expired'));
    expect(await verifyCognitoAccessToken('bad')).toBeNull();
  });
  it('returns null for an empty token without calling the verifier', async () => {
    expect(await verifyCognitoAccessToken('')).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });
  it('returns null when token_use is not "access"', async () => {
    verify.mockResolvedValueOnce({ sub: 'u1', token_use: 'id' });
    expect(await verifyCognitoAccessToken('idtoken')).toBeNull();
  });
  it('returns null when sub is missing', async () => {
    verify.mockResolvedValueOnce({ token_use: 'access' });
    expect(await verifyCognitoAccessToken('nosub')).toBeNull();
  });
  it('THROWS (not null) when Cognito config is missing — a deploy error', async () => {
    _setVerifierForTests(null);            // force the real factory path
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
    await expect(verifyCognitoAccessToken('any')).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && npx jest cognitoVerifier`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the verifier (lazy singleton + test seam, mirroring `publisherSecretCache`)**

```ts
// backend/src/services/cognitoVerifier.ts
import { CognitoJwtVerifier } from 'aws-jwt-verify';

export interface CognitoClaims {
  sub: string;          // immutable account id (our userId / DynamoDB key)
  username?: string;    // Cognito pool username — REQUIRED by AdminDeleteUser (sub is NOT accepted there)
  email?: string;
  tokenUse: 'access';
}

interface Verifier { verify(token: string): Promise<Record<string, unknown>>; }

let _verifier: Verifier | null = null;

function verifier(): Verifier {
  if (!_verifier) {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_CLIENT_ID;
    if (!userPoolId || !clientId) {
      throw new Error('COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID env vars not set');
    }
    _verifier = CognitoJwtVerifier.create({
      userPoolId,
      clientId,
      tokenUse: 'access',
    }) as unknown as Verifier;
  }
  return _verifier;
}

/** For tests: inject a fake verifier, or null to reset. */
export function _setVerifierForTests(v: Verifier | null): void {
  _verifier = v;
}

export async function verifyCognitoAccessToken(token: string): Promise<CognitoClaims | null> {
  if (typeof token !== 'string' || token.length === 0) return null;
  // Build the verifier OUTSIDE the try: a missing COGNITO_* env var is a
  // deployment error, not a token failure. It throws (→ 500, loud, logged),
  // matching the repo precedent (publisherSecretCache throws on missing config).
  // We do NOT swallow it to null — that would silently 401 every user and hide
  // the misconfiguration.
  const v = verifier();
  try {
    const c = await v.verify(token);            // only token-verification failures land here
    if (typeof c.sub !== 'string') return null;
    if (c.token_use !== 'access') return null;
    return {
      sub: c.sub,
      username: typeof c.username === 'string' ? c.username : undefined,
      email: typeof c.email === 'string' ? c.email : undefined,
      tokenUse: 'access',
    };
  } catch {
    return null;                                // expired / bad sig / malformed / wrong use → 401
  }
}
```

> Note: `aws-jwt-verify` caches the JWKS internally (warm-container safe), so a
> separate cache module is unnecessary here.

- [ ] **Step 5: Run to verify pass**

Run: `cd backend && npx jest cognitoVerifier`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/cognitoVerifier.ts backend/src/__tests__/cognitoVerifier.test.ts backend/package.json backend/package-lock.json
git commit -m "feat(auth): Cognito access-token JWKS verifier with test seam"
```

---

## Task 6: `user_handler` Lambda (routes + auth enforcement + deletion purge)

**Files:**
- Create: `backend/src/handlers/userHandler.ts`
- Test: `backend/src/__tests__/userHandler.test.ts`

**Interfaces:**
- Consumes: `verifyCognitoAccessToken` (Task 5), `UserProfileService` (Task 3),
  `FavoritesService` (Task 4).
- Produces:
  - `handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult>` — Lambda entry, dispatches on `event.httpMethod` + `event.path`.
  - Route functions: `handleGetPreferences(event)`, `handlePutPreferences(event)`, `handleDeleteUser(event)`.
  - Test seams: `_setProfileServiceForTests(s | null)`, `_setFavoritesServiceForTests(s | null)`, `_setCognitoClientForTests(c | null)`.
- Consumes (added): `CognitoIdentityProviderClient` + `AdminDeleteUserCommand` from `@aws-sdk/client-cognito-identity-provider`, and the `username` claim from `verifyCognitoAccessToken`.
- Wire contract: `GET /user/preferences` → `{ preferences, favorites }` (favorites as a `FavoritesMap`); `PUT /user/preferences` body `{ preferences, favorites }` → 204; `DELETE /user` → 204 after purging all favorites rows + profile + the Cognito user (spec §7).

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/__tests__/userHandler.test.ts
import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  handler,
  handleGetPreferences, handlePutPreferences, handleDeleteUser,
  _setProfileServiceForTests, _setFavoritesServiceForTests, _setCognitoClientForTests,
} from '../handlers/userHandler';

jest.mock('../services/cognitoVerifier', () => ({
  verifyCognitoAccessToken: jest.fn(),
}));
import { verifyCognitoAccessToken } from '../services/cognitoVerifier';

const evt = (over: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
  body: '', headers: {}, multiValueHeaders: {}, httpMethod: 'GET',
  isBase64Encoded: false, path: '/user/preferences', pathParameters: null,
  queryStringParameters: null, multiValueQueryStringParameters: null,
  stageVariables: null, resource: '/user/preferences',
  requestContext: { identity: { sourceIp: '203.0.113.1' } } as any,
  ...over,
});

describe('userHandler', () => {
  let profile: { get: jest.Mock; putIfNewer: jest.Mock; delete: jest.Mock };
  let favorites: { listByUser: jest.Mock; upsertMany: jest.Mock; deleteAllForUser: jest.Mock };
  let cognitoSend: jest.Mock;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.COGNITO_USER_POOL_ID = 'pool-1';
    profile = { get: jest.fn(), putIfNewer: jest.fn().mockResolvedValue(true), delete: jest.fn() };
    favorites = { listByUser: jest.fn(), upsertMany: jest.fn(), deleteAllForUser: jest.fn() };
    cognitoSend = jest.fn().mockResolvedValue({});
    _setProfileServiceForTests(profile as any);
    _setFavoritesServiceForTests(favorites as any);
    _setCognitoClientForTests({ send: cognitoSend } as any);
  });
  afterEach(() => {
    _setProfileServiceForTests(null); _setFavoritesServiceForTests(null); _setCognitoClientForTests(null);
  });

  it('rejects an unauthenticated GET with 401', async () => {
    (verifyCognitoAccessToken as jest.Mock).mockResolvedValue(null);
    const r = await handleGetPreferences(evt({ headers: {} }));
    expect(r.statusCode).toBe(401);
  });

  it('GET returns preferences + favorites map for the token subject', async () => {
    (verifyCognitoAccessToken as jest.Mock).mockResolvedValue({ sub: 'u1', tokenUse: 'access' });
    profile.get.mockResolvedValue({ userId: 'u1', preferences: { filters: {}, notes: {}, lastSaved: 5 }, lastSaved: 5, createdAt: 1 });
    favorites.listByUser.mockResolvedValue([{ userId: 'u1', eventId: 'e1', favorited: true, at: 9 }]);
    const r = await handleGetPreferences(evt({ headers: { Authorization: 'Bearer good' } }));
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.favorites).toEqual({ e1: { favorited: true, at: 9 } });
    expect(body.preferences.lastSaved).toBe(5);
    // CORS is first-party only, never wildcard, on token-bearing routes
    expect(r.headers!['Access-Control-Allow-Origin']).not.toBe('*');
  });

  it('PUT persists blob + favorites via putIfNewer and returns 204', async () => {
    (verifyCognitoAccessToken as jest.Mock).mockResolvedValue({ sub: 'u1', tokenUse: 'access' });
    profile.get.mockResolvedValue(null);
    const r = await handlePutPreferences(evt({
      httpMethod: 'PUT',
      headers: { Authorization: 'Bearer good' },
      body: JSON.stringify({ preferences: { filters: {}, notes: {}, lastSaved: 7 }, favorites: { e1: { favorited: false, at: 8 } } }),
    }));
    expect(r.statusCode).toBe(204);
    expect(profile.putIfNewer).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', lastSaved: 7 }));
    expect(favorites.upsertMany).toHaveBeenCalledWith('u1', { e1: { favorited: false, at: 8 } });
  });

  it('PUT rejects a payload without a numeric preferences.lastSaved (400)', async () => {
    (verifyCognitoAccessToken as jest.Mock).mockResolvedValue({ sub: 'u1', tokenUse: 'access' });
    const r = await handlePutPreferences(evt({
      httpMethod: 'PUT', headers: { Authorization: 'Bearer good' },
      body: JSON.stringify({ preferences: { filters: {}, notes: {} }, favorites: {} }), // no lastSaved
    }));
    expect(r.statusCode).toBe(400);
    expect(profile.putIfNewer).not.toHaveBeenCalled();
  });

  it('handler returns a JSON 500 (not an unhandled throw) when the verifier throws on missing config', async () => {
    (verifyCognitoAccessToken as jest.Mock).mockRejectedValue(new Error('COGNITO_USER_POOL_ID not set'));
    const r = await handler(evt({ httpMethod: 'GET', path: '/user/preferences', headers: { Authorization: 'Bearer x' } }));
    expect(r.statusCode).toBe(500);
    expect(JSON.parse(r.body).error).toBe('Internal server error');
  });

  it('DELETE purges favorites rows, profile, AND the Cognito user', async () => {
    (verifyCognitoAccessToken as jest.Mock).mockResolvedValue({ sub: 'u1', username: 'Google_123', tokenUse: 'access' });
    const r = await handleDeleteUser(evt({ httpMethod: 'DELETE', path: '/user', headers: { Authorization: 'Bearer good' } }));
    expect(r.statusCode).toBe(204);
    expect(favorites.deleteAllForUser).toHaveBeenCalledWith('u1');
    expect(profile.delete).toHaveBeenCalledWith('u1');
    // Cognito AdminDeleteUser sent with the pool Username (not the sub)
    const cmd = cognitoSend.mock.calls[0][0];
    expect(cmd.input).toEqual({ UserPoolId: 'pool-1', Username: 'Google_123' });
  });

  it('DELETE fails (500) WITHOUT purging when the username claim is missing', async () => {
    (verifyCognitoAccessToken as jest.Mock).mockResolvedValue({ sub: 'u1', tokenUse: 'access' }); // no username
    const r = await handleDeleteUser(evt({ httpMethod: 'DELETE', path: '/user', headers: { Authorization: 'Bearer good' } }));
    expect(r.statusCode).toBe(500);
    expect(favorites.deleteAllForUser).not.toHaveBeenCalled(); // nothing half-deleted
    expect(profile.delete).not.toHaveBeenCalled();
    expect(cognitoSend).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest userHandler`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

```ts
// backend/src/handlers/userHandler.ts
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminDeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { verifyCognitoAccessToken, type CognitoClaims } from '../services/cognitoVerifier';
import { UserProfileService, type UserProfile } from '../services/userProfileService';
import { FavoritesService } from '../services/favoritesService';

// Local blob favorites shape (mirrors the frontend FavoritesMap; kept inline so
// the backend has no dependency on frontend types).
type FavRecord = { favorited: boolean; at: number };
type FavMap = Record<string, FavRecord>;

// Authenticated end-user endpoints: lock CORS to the first-party site, mirroring
// backend/src/handlers/publisherPortalHandler.ts (never '*' for token-bearing routes).
const CORS = {
  'Access-Control-Allow-Origin': process.env.SITE_BASE_URL ?? 'https://www.chqcal.org',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,PUT,DELETE,OPTIONS',
  'Content-Type': 'application/json',
};
const json = (statusCode: number, body?: unknown): APIGatewayProxyResult => ({
  statusCode, headers: CORS, body: body === undefined ? '' : JSON.stringify(body),
});

function buildDocClient(): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'dummy',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'dummy',
      },
    }),
  });
  return DynamoDBDocumentClient.from(client);
}

let _profile: UserProfileService | null = null;
let _favorites: FavoritesService | null = null;
function profileSvc(): UserProfileService {
  if (!_profile) _profile = new UserProfileService(buildDocClient(), process.env.USERS_TABLE_NAME ?? 'chautauqua-calendar-users');
  return _profile;
}
function favoritesSvc(): FavoritesService {
  if (!_favorites) _favorites = new FavoritesService(buildDocClient(), process.env.FAVORITES_TABLE_NAME ?? 'chautauqua-calendar-favorites', 'by-event');
  return _favorites;
}
export function _setProfileServiceForTests(s: UserProfileService | null): void { _profile = s; }
export function _setFavoritesServiceForTests(s: FavoritesService | null): void { _favorites = s; }

let _cognito: CognitoIdentityProviderClient | null = null;
function cognito(): CognitoIdentityProviderClient {
  if (!_cognito) _cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' });
  return _cognito;
}
export function _setCognitoClientForTests(c: CognitoIdentityProviderClient | null): void { _cognito = c; }

function bearer(event: APIGatewayProxyEvent): string {
  const h = event.headers.Authorization || event.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}
async function requireUser(event: APIGatewayProxyEvent): Promise<CognitoClaims | null> {
  return verifyCognitoAccessToken(bearer(event));
}

export async function handleGetPreferences(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = await requireUser(event);
  if (!claims) return json(401, { error: 'unauthorized' });
  const userId = claims.sub;
  const [profile, rows] = await Promise.all([profileSvc().get(userId), favoritesSvc().listByUser(userId)]);
  const favorites: FavMap = {};
  for (const r of rows) favorites[r.eventId] = { favorited: r.favorited, at: r.at };
  return json(200, { preferences: profile?.preferences ?? null, favorites });
}

export async function handlePutPreferences(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = await requireUser(event);
  if (!claims) return json(401, { error: 'unauthorized' });
  const userId = claims.sub;
  let parsed: { preferences?: { lastSaved?: number }; favorites?: FavMap };
  try { parsed = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'invalid json' }); }
  // LWW integrity: require a REAL client edit timestamp. Never fabricate one —
  // a partial/stale payload with a `Date.now()` fallback would look "newest" and
  // could clobber correct server state.
  if (!parsed.preferences || typeof parsed.preferences.lastSaved !== 'number') {
    return json(400, { error: 'preferences.lastSaved (number) required' });
  }
  const existing = await profileSvc().get(userId);
  const now = Date.now();
  const toStore: UserProfile = {
    userId,
    preferences: parsed.preferences,
    lastSaved: parsed.preferences.lastSaved,
    createdAt: existing?.createdAt ?? now,
    email: claims.email ?? existing?.email, // informational; from the verified token, never logged
    linkedProviders: existing?.linkedProviders,
  };
  await profileSvc().putIfNewer(toStore);   // server-side LWW: a stale write is silently ignored
  if (parsed.favorites) await favoritesSvc().upsertMany(userId, parsed.favorites);
  return json(204);
}

export async function handleDeleteUser(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = await requireUser(event);
  if (!claims) return json(401, { error: 'unauthorized' });
  const userId = claims.sub;
  const poolId = process.env.COGNITO_USER_POOL_ID;
  // Spec §7 REQUIRES the Cognito user to be purged too. If we can't (missing
  // `username` claim — real federated tokens always carry it — or no pool id),
  // FAIL before touching the DB rather than silently leaving an undeleted
  // account. The client sees 500 and can retry; nothing is half-deleted.
  if (!claims.username || !poolId) {
    console.error('cannot complete account deletion: missing username claim or pool id');
    return json(500, { error: 'account deletion unavailable' });
  }
  await favoritesSvc().deleteAllForUser(userId); // favorites first: never orphan rows if a later step fails
  await profileSvc().delete(userId);
  await cognito().send(new AdminDeleteUserCommand({ UserPoolId: poolId, Username: claims.username }));
  return json(204);
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // Top-level catch so any unexpected throw (e.g. missing Cognito config, or a
  // transient AWS error) surfaces as the app's consistent JSON 500 rather than
  // an unhandled rejection → API Gateway 502. Mirrors publisherPortalHandler.
  try {
    const method = event.httpMethod.toUpperCase();
    const path = event.path;
    if (method === 'OPTIONS') return json(204);
    if (path.endsWith('/user/preferences') && method === 'GET') return await handleGetPreferences(event);
    if (path.endsWith('/user/preferences') && method === 'PUT') return await handlePutPreferences(event);
    if (path.endsWith('/user') && method === 'DELETE') return await handleDeleteUser(event);
    return json(404, { error: 'not found' });
  } catch (err) {
    console.error('userHandler unexpected error:', (err as Error)?.message); // never log token/PII
    return json(500, { error: 'Internal server error' });
  }
}
```

> The handler uses the inline `FavMap` type (no cross-package type import) so
> the backend never depends on frontend types. The wire shape is identical to
> the frontend `FavoritesMap`; the test only depends on that shape.

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx jest userHandler`
Expected: PASS — all cases green (401 on every route, GET shape, PUT persistence, DELETE purge incl. Cognito).

- [ ] **Step 5: Install the Cognito SDK dep and add `userHandler` to the Lambda build**

> **Without this the Lambda deploys with no handler file.** `package:terraform`
> zips only `dist/ + package.json` (no `node_modules`), and `build:prod` today
> bundles only the four existing handlers. `dist/userHandler.js` must be emitted
> or every invocation fails `Runtime.ImportModuleError`.

Run: `cd backend && npm install @aws-sdk/client-cognito-identity-provider`
(the Node Lambda runtime provides `@aws-sdk/*`, so it's externalized in the
bundle — but it must be installed for the local build/type-check).

Append a fifth esbuild entry to the `build:prod` script in
`backend/package.json`, mirroring the existing ones. Externalize the SDK
modules the runtime provides; **bundle `aws-jwt-verify`** (NOT in the runtime),
so do NOT add it to `--external`:
```
&& npx esbuild src/handlers/userHandler.ts --bundle --platform=node --target=node24 --outfile=dist/userHandler.js --external:@aws-sdk/client-dynamodb --external:@aws-sdk/lib-dynamodb --external:@aws-sdk/client-cognito-identity-provider
```
(Insert it before the `cp -r src/services dist/` tail, matching the `&&` chain.)

- [ ] **Step 6: Verify the handler actually builds**

Run: `cd backend && npm run build:prod && test -f dist/userHandler.js && echo OK`
Expected: `OK` (the file exists). Then `npm run validate && npx jest`
(zero lint warnings, all tests pass).

> Deploy note (with-user step, not the code PR): the new `user_handler` Lambda
> is created by Terraform, but ongoing code deploys via
> `.github/workflows/deploy-production.yml` update the *existing* four functions
> by name — add a fifth `aws lambda update-function-code --function-name
> ${app}-user-handler` step there so future deploys refresh it.

- [ ] **Step 7: Commit**

```bash
git add backend/src/handlers/userHandler.ts backend/src/__tests__/userHandler.test.ts backend/package.json backend/package-lock.json
git commit -m "feat(user): userHandler routes with auth enforcement and full-purge deletion"
```

---

## Task 7: Infrastructure — Cognito, tables, IAM, Lambda, API wiring

> **No unit tests** (infra). Verification is `terraform validate` + `terraform
> plan` review + post-apply smoke. Do NOT `apply` without the user's explicit
> go-ahead — this provisions a Cognito pool and new tables.

**Files:**
- Create: `infrastructure/user-accounts.tf`
- Modify: `infrastructure/main.tf` (API Gateway `/user/{proxy+}` + deployment
  triggers; CloudFront `/api/user*` behavior)

- [ ] **Step 1: Write the two DynamoDB tables**

```hcl
# infrastructure/user-accounts.tf
resource "aws_dynamodb_table" "users" {
  name         = "${var.app_name}-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  point_in_time_recovery { enabled = true }
  server_side_encryption { enabled = true }

  tags = {
    Name        = "${var.app_name}-users"
    Environment = var.environment
  }
}

resource "aws_dynamodb_table" "favorites" {
  name         = "${var.app_name}-favorites"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "eventId"

  attribute {
    name = "userId"
    type = "S"
  }
  attribute {
    name = "eventId"
    type = "S"
  }

  global_secondary_index {
    name            = "by-event"
    projection_type = "ALL"
    key_schema {
      attribute_name = "eventId"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "userId"
      key_type       = "RANGE"
    }
  }

  point_in_time_recovery { enabled = true }
  server_side_encryption { enabled = true }

  tags = {
    Name        = "${var.app_name}-favorites"
    Environment = var.environment
  }
}
```

- [ ] **Step 2: Write the Cognito user pool + Google IdP + app client**

```hcl
resource "aws_cognito_user_pool" "users" {
  name = "${var.app_name}-users"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Federation-only pool: disable native self-service signup so no local
  # (email/password) user can exist to collide with a federated identity — this
  # is part of the "no auto-link" structural guard (see the Google IdP block).
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  tags = {
    Name        = "${var.app_name}-users"
    Environment = var.environment
  }
}

resource "aws_cognito_user_pool_domain" "users" {
  domain       = "${var.app_name}-users"       # -> https://${domain}.auth.${region}.amazoncognito.com
  user_pool_id = aws_cognito_user_pool.users.id
}

resource "aws_cognito_identity_provider" "google" {
  user_pool_id  = aws_cognito_user_pool.users.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id                 = var.google_oauth_client_id
    client_secret             = var.google_oauth_client_secret
    authorize_scopes          = "openid email profile"
  }
  # CONTROL POINT for the "no auto-link" guard (spec §3): Cognito has no
  # attribute/email-based auto-merge setting to toggle — federated identities
  # are merged ONLY by an explicit AdminLinkProviderForUser call (Phase 2,
  # Task 14). The guard is therefore structural, enforced by two things below:
  #   1. attribute_mapping maps `username = "sub"` (provider-specific), so a
  #      Google user and an Apple user with the same email are DISTINCT pool
  #      users until explicitly linked — no silent collision.
  #   2. This pool exposes no native (email/password) signup surface, so there
  #      is no pre-existing local user for a federated login to collide with.
  # Nothing to "disable"; the requirement is met by NOT adding an explicit link
  # anywhere except Task 14. This is fully Terraform-managed (no manual step).

  attribute_mapping = {
    email    = "email"
    username = "sub"
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.app_name}-web"
  user_pool_id = aws_cognito_user_pool.users.id

  generate_secret = false   # public SPA client (PKCE)

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["Google"]

  callback_urls = ["https://www.${var.domain_name}/auth/callback", "http://localhost:3000/auth/callback"]
  logout_urls   = ["https://www.${var.domain_name}/", "http://localhost:3000/"]

  # Refresh token keeps sessions alive; access/id short-lived.
  refresh_token_validity = 30
  access_token_validity  = 1
  id_token_validity      = 1
  token_validity_units {
    refresh_token = "days"
    access_token  = "hours"
    id_token      = "hours"
  }

  depends_on = [aws_cognito_identity_provider.google]
}
```

> Add Terraform variables `google_oauth_client_id` and
> `google_oauth_client_secret` (mark the secret `sensitive = true`) in
> `infrastructure/variables.tf`. Provide values via a tfvars/secret mechanism —
> never commit them.

- [ ] **Step 3: Write the IAM role scoped to only the two new tables**

```hcl
resource "aws_iam_role" "user_lambda_role" {
  name = "${var.app_name}-user-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect    = "Allow",
      Principal = { Service = "lambda.amazonaws.com" },
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "user_lambda_basic" {
  role       = aws_iam_role.user_lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "user_lambda_scoped" {
  name = "${var.app_name}-user-lambda-scoped"
  role = aws_iam_role.user_lambda_role.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "dynamodb:Query", "dynamodb:GetItem", "dynamodb:PutItem",
          "dynamodb:UpdateItem", "dynamodb:DeleteItem",
          "dynamodb:BatchWriteItem"  # favorites upsertMany/deleteAllForUser use chunked BatchWriteCommand
        ],
        Resource = [
          aws_dynamodb_table.users.arn,
          aws_dynamodb_table.favorites.arn,
          "${aws_dynamodb_table.favorites.arn}/index/by-event"
        ]
      },
      {
        # Account deletion (DELETE /user) purges the Cognito user too (spec §7).
        Effect   = "Allow",
        Action   = ["cognito-idp:AdminDeleteUser"],
        Resource = aws_cognito_user_pool.users.arn
      }
    ]
  })
}
```

- [ ] **Step 4: Write the Lambda + log group**

```hcl
resource "aws_cloudwatch_log_group" "user_handler" {
  name              = "/aws/lambda/${var.app_name}-user-handler"
  retention_in_days = 14
}

resource "aws_lambda_function" "user_handler" {
  filename      = "../backend/lambda-function.zip"
  function_name = "${var.app_name}-user-handler"
  role          = aws_iam_role.user_lambda_role.arn
  handler       = "dist/userHandler.handler"
  runtime       = "nodejs24.x"
  timeout       = 30
  memory_size   = 256

  environment {
    variables = {
      USERS_TABLE_NAME       = aws_dynamodb_table.users.name
      FAVORITES_TABLE_NAME   = aws_dynamodb_table.favorites.name
      COGNITO_USER_POOL_ID   = aws_cognito_user_pool.users.id
      COGNITO_CLIENT_ID      = aws_cognito_user_pool_client.web.id
      SITE_BASE_URL          = "https://www.${var.domain_name}"  # first-party CORS origin
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.user_lambda_basic,
    aws_iam_role_policy.user_lambda_scoped,
    aws_cloudwatch_log_group.user_handler,
  ]

  source_code_hash = filebase64sha256("../backend/lambda-function.zip")
}

resource "aws_lambda_permission" "user_api_gateway" {
  statement_id  = "AllowUserAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.user_handler.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.admin.execution_arn}/*/*"
}
```

- [ ] **Step 5: Wire an explicit `/user/{proxy+}` resource on the admin REST API** (matched before the existing `{proxy+}` catch-all so `/user/*` hits `user_handler`, not `admin_handler`). Add to `infrastructure/main.tf`:

```hcl
resource "aws_api_gateway_resource" "user_root" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  parent_id   = aws_api_gateway_rest_api.admin.root_resource_id
  path_part   = "user"
}

resource "aws_api_gateway_resource" "user_proxy" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  parent_id   = aws_api_gateway_resource.user_root.id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "user_root_any" {
  rest_api_id   = aws_api_gateway_rest_api.admin.id
  resource_id   = aws_api_gateway_resource.user_root.id
  http_method   = "ANY"
  authorization = "NONE"   # auth is enforced inside the Lambda (JWKS), matching the codebase pattern
}

resource "aws_api_gateway_method" "user_proxy_any" {
  rest_api_id   = aws_api_gateway_rest_api.admin.id
  resource_id   = aws_api_gateway_resource.user_proxy.id
  http_method   = "ANY"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "user_root_any" {
  rest_api_id             = aws_api_gateway_rest_api.admin.id
  resource_id             = aws_api_gateway_resource.user_root.id
  http_method             = aws_api_gateway_method.user_root_any.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.user_handler.invoke_arn
}

resource "aws_api_gateway_integration" "user_proxy_any" {
  rest_api_id             = aws_api_gateway_rest_api.admin.id
  resource_id             = aws_api_gateway_resource.user_proxy.id
  http_method             = aws_api_gateway_method.user_proxy_any.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.user_handler.invoke_arn
}
```

Then add these four resource/method/integration IDs to the
`aws_api_gateway_deployment.admin_deployment` `triggers` map and `depends_on`
list (find the existing block; append alongside the `admin_proxy` entries).

- [ ] **Step 6: CloudFront — route `/user/*` (or `/api/user/*`) to the admin API origin.** Locate the existing CloudFront behavior that forwards `/api/publisher-*` to the admin API in `main.tf`; add an ordered cache behavior with `path_pattern = "/user/*"` (or `/api/user/*` to match the publisher convention) pointing at the same admin-API origin, `Authorization` header forwarded, caching disabled.

> **Decision to confirm at execution:** whether the frontend calls `/user/*`
> (needs a new CloudFront behavior) or `/api/user/*` (reuses the `/api/*`
> pattern). The frontend api client (Task 9) must use the SAME prefix chosen
> here. Default to `/user/*` with a dedicated behavior.

- [ ] **Step 7: Provision a dev Cognito pool for local testing (separate from prod)**

The Cognito pool + Google IdP + app client (Steps 2) are **standalone** — they
do NOT depend on the CloudFront/domain/Lambda tangle, so a second *dev* pool can
be created without any staging refactor, keeping dev sign-ins out of prod user
data. Two ways to get one:
- Apply just the Cognito resources with `-target` into a dev-named pool (e.g.
  add a `dev` app client whose only callback is `http://localhost:3000/auth/callback`), OR
- Create a throwaway dev pool by hand in the console for local dev.

Record its domain + client ID in `frontend/.env.local`:
```
VITE_COGNITO_DOMAIN=https://<dev-pool-domain>.auth.us-east-1.amazoncognito.com
VITE_COGNITO_CLIENT_ID=<dev-app-client-id>
VITE_ENABLE_ACCOUNTS=true   # local dev turns the feature on
```
The backend (local Express shim) needs `COGNITO_USER_POOL_ID` + `COGNITO_CLIENT_ID`
for the dev pool so JWKS verification points at the same pool. Google works from
localhost because Google only sees the *Cognito* domain as the redirect target.
(Apple does NOT work from localhost — deferred to Phase 2 with staging.)

- [ ] **Step 8: Frontend env config — add the flag + Cognito vars to prod**

The production build must default `VITE_ENABLE_ACCOUNTS=false` until launch
(dark-launch), and carry `VITE_COGNITO_DOMAIN` / `VITE_COGNITO_CLIENT_ID` for
the prod pool. Add these to the frontend env injected by
`.github/workflows/deploy-production.yml` (and `.env.production.example`).
Flipping the feature on for everyone = set `VITE_ENABLE_ACCOUNTS=true` and
rebuild/redeploy; self-testing before that uses the `?accounts=1` URL param.

- [ ] **Step 9: Validate (no apply)**

Run: `cd infrastructure && terraform init -backend=false && terraform validate`
Expected: `Success! The configuration is valid.`

Run: `cd infrastructure && terraform fmt -check`
Expected: no diffs (run `terraform fmt` if it reports files).

- [ ] **Step 10: Commit (still no apply)**

```bash
git add infrastructure/user-accounts.tf infrastructure/main.tf infrastructure/variables.tf
git commit -m "infra(user): Cognito pool + Google IdP, users/favorites tables, user_handler wiring"
```

---

## Task 8: Frontend Cognito config + `useAuth` hook

**Files:**
- Create: `frontend/src/lib/cognito.ts`
- Create: `frontend/src/hooks/useAuth.ts`
- Create: `frontend/src/lib/__tests__/cognito.test.ts`

**Interfaces:**
- Produces:
  - `frontend/src/lib/cognito.ts`: `buildAuthorizeUrl(): Promise<string>` (PKCE — async because it hashes the verifier via SubtleCrypto), `exchangeCodeForTokens(code: string): Promise<AuthTokens>`, `refreshTokens(refreshToken: string): Promise<AuthTokens>`, `consumeAndVerifyState(returnedState: string | null): boolean`, `decodeJwtPayload(jwt: string): Record<string, unknown> | null`, `AuthTokens = { accessToken: string; idToken: string; refreshToken?: string; expiresAt: number }`, storage helpers `saveTokens/getTokens/clearTokens/getAccessToken`.
  - `frontend/src/hooks/useAuth.ts`: `useAuth(): { user: { sub: string; email?: string } | null; signIn(): void; signOut(): void; isAuthenticated: boolean }`.
- Storage keys: `chq_user_tokens` (JSON), following the existing `chq_*` convention.

- [ ] **Step 1: Write the failing test for the pure PKCE/token bits** (redirect and network calls are integration; test the storage + expiry logic and URL construction)

```ts
// frontend/src/lib/__tests__/cognito.test.ts
/// <reference types="vitest/globals" />
import {
  saveTokens, getTokens, clearTokens, getAccessToken, isExpired,
  decodeJwtPayload, consumeAndVerifyState, type AuthTokens,
} from '@/lib/cognito';

const tokens = (over: Partial<AuthTokens> = {}): AuthTokens => ({
  accessToken: 'a', idToken: 'i', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, ...over,
});

describe('cognito token storage', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips tokens through localStorage', () => {
    saveTokens(tokens());
    expect(getTokens()?.accessToken).toBe('a');
    expect(getAccessToken()).toBe('a');
  });
  it('clearTokens removes them', () => {
    saveTokens(tokens());
    clearTokens();
    expect(getTokens()).toBeNull();
    expect(getAccessToken()).toBeNull();
  });
  it('isExpired is true once expiresAt has passed', () => {
    expect(isExpired(tokens({ expiresAt: Date.now() - 1 }))).toBe(true);
    expect(isExpired(tokens({ expiresAt: Date.now() + 10_000 }))).toBe(false);
  });
});

describe('decodeJwtPayload (base64url-safe)', () => {
  it('decodes a base64url payload that standard atob would choke on', () => {
    // payload {"sub":"u1","email":"a+b@x.io"} base64url-encoded (has - / _ , no padding)
    const payload = { sub: 'u1', email: 'a+b@x.io' };
    const b64url = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const jwt = `h.${b64url}.sig`;
    expect(decodeJwtPayload(jwt)).toEqual(payload);
  });
  it('returns null on a malformed token', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
  });
});

describe('consumeAndVerifyState (OAuth CSRF)', () => {
  beforeEach(() => sessionStorage.clear());
  it('accepts a matching, single-use state and rejects reuse', () => {
    sessionStorage.setItem('chq_oauth_state', 'abc');
    expect(consumeAndVerifyState('abc')).toBe(true);
    expect(consumeAndVerifyState('abc')).toBe(false); // consumed → no stored value now
  });
  it('rejects a mismatched or missing state', () => {
    sessionStorage.setItem('chq_oauth_state', 'abc');
    expect(consumeAndVerifyState('xyz')).toBe(false);
    expect(consumeAndVerifyState(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/__tests__/cognito.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cognito.ts`**

```ts
// frontend/src/lib/cognito.ts
export interface AuthTokens {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
}

const TOKENS_KEY = 'chq_user_tokens';
const PKCE_VERIFIER_KEY = 'chq_pkce_verifier';
const OAUTH_STATE_KEY = 'chq_oauth_state';

const DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN ?? '';       // e.g. https://xxx.auth.us-east-1.amazoncognito.com
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID ?? '';
const REDIRECT_URI = `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`;

export function saveTokens(t: AuthTokens): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
}
export function getTokens(): AuthTokens | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(TOKENS_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as AuthTokens; } catch { return null; }
}
export function clearTokens(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKENS_KEY);
}
export function isExpired(t: AuthTokens): boolean { return Date.now() >= t.expiresAt; }
export function getAccessToken(): string | null {
  const t = getTokens();
  return t ? t.accessToken : null;
}

// --- PKCE helpers (browser SubtleCrypto) ---
function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
}
function randomToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return base64url(arr.buffer);
}

/** Decode a base64url-encoded JWT segment (JWTs are NOT standard base64). */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const seg = jwt.split('.')[1];
    if (!seg) return null;
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/').padEnd(seg.length + (4 - (seg.length % 4)) % 4, '=');
    return JSON.parse(atob(b64)) as Record<string, unknown>;
  } catch { return null; }
}

export async function buildAuthorizeUrl(): Promise<string> {
  const verifier = randomToken();
  const state = randomToken();
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(OAUTH_STATE_KEY, state);   // CSRF binding, verified in the callback
  const challenge = base64url(await sha256(verifier));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid email profile',
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  return `${DOMAIN}/oauth2/authorize?${params.toString()}`;
}

/** Verify the returned ?state against the stored value (single-use). Returns
 *  false on mismatch — the callback MUST abort the code exchange if false. */
export function consumeAndVerifyState(returnedState: string | null): boolean {
  const expected = sessionStorage.getItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  return !!expected && !!returnedState && expected === returnedState;
}

async function tokenRequest(body: Record<string, string>): Promise<AuthTokens> {
  const res = await fetch(`${DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new Error(`token endpoint ${res.status}`);
  const j = await res.json();
  return {
    accessToken: j.access_token,
    idToken: j.id_token,
    refreshToken: j.refresh_token,
    expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
  };
}

export async function exchangeCodeForTokens(code: string): Promise<AuthTokens> {
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY) ?? '';
  return tokenRequest({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
}

export async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  const t = await tokenRequest({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });
  return { ...t, refreshToken }; // Cognito omits refresh_token on refresh; keep the old one
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/__tests__/cognito.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `useAuth`** (decodes the ID token for display claims; triggers redirect on `signIn`)

```ts
// frontend/src/hooks/useAuth.ts
import { useState, useEffect, useCallback } from 'react';
import { buildAuthorizeUrl, getTokens, clearTokens, isExpired, refreshTokens, saveTokens, decodeJwtPayload } from '@/lib/cognito';

interface AuthUser { sub: string; email?: string }

function decodeIdToken(idToken: string): AuthUser | null {
  const payload = decodeJwtPayload(idToken); // base64url-safe (JWT segments are not standard base64)
  if (!payload || typeof payload.sub !== 'string') return null;
  return { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    (async () => {
      let t = getTokens();
      if (!t) { setUser(null); return; }
      if (isExpired(t) && t.refreshToken) {
        try { t = await refreshTokens(t.refreshToken); saveTokens(t); }
        catch { clearTokens(); setUser(null); return; }
      }
      setUser(decodeIdToken(t.idToken));
    })();
  }, []);

  const signIn = useCallback(() => {
    buildAuthorizeUrl().then(url => { window.location.href = url; });
  }, []);

  const signOut = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  return { user, signIn, signOut, isAuthenticated: user !== null };
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/cognito.ts frontend/src/hooks/useAuth.ts frontend/src/lib/__tests__/cognito.test.ts
git commit -m "feat(auth): Cognito PKCE client and useAuth hook"
```

> Deferred to Task 11: the `/auth/callback` page/entry that calls
> `exchangeCodeForTokens` and redirects home.

---

## Task 9: Frontend user-preferences API client

**Files:**
- Create: `frontend/src/lib/userPreferencesApi.ts`
- Create: `frontend/src/lib/__tests__/userPreferencesApi.test.ts`

**Interfaces:**
- Consumes: `getAccessToken` (Task 8), `API_BASE_URL` (`@/lib/api`).
- Produces: `fetchPreferences(): Promise<{ preferences: PreferencesBlob | null; favorites: FavoritesMap }>`, `pushPreferences(body: { preferences: PreferencesBlob; favorites: FavoritesMap }): Promise<void>`, `deleteAccount(): Promise<void>`.

- [ ] **Step 1: Write the failing test** (mock `fetch` and `getAccessToken`)

```ts
// frontend/src/lib/__tests__/userPreferencesApi.test.ts
/// <reference types="vitest/globals" />
import { vi } from 'vitest';
vi.mock('@/lib/cognito', () => ({ getAccessToken: () => 'tok-123' }));
import { fetchPreferences, pushPreferences } from '@/lib/userPreferencesApi';

describe('userPreferencesApi', () => {
  afterEach(() => vi.restoreAllMocks());

  it('GET attaches the bearer token and returns parsed body', async () => {
    const json = { preferences: null, favorites: { e1: { favorited: true, at: 3 } } };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(json), { status: 200 }),
    );
    const r = await fetchPreferences();
    expect(r.favorites.e1.favorited).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('PUT sends the body and tolerates a 204', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 204 }));
    await pushPreferences({ preferences: { filters: {} as any, notes: {}, lastSaved: 1 }, favorites: {} });
    const [, init] = fetchMock.mock.calls[0];
    expect(init!.method).toBe('PUT');
    expect(JSON.parse(init!.body as string).preferences.lastSaved).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/__tests__/userPreferencesApi.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client** (mirrors the admin `req<T>` helper style)

```ts
// frontend/src/lib/userPreferencesApi.ts
import { API_BASE_URL } from '@/lib/api';
import { getAccessToken } from '@/lib/cognito';
import type { PreferencesBlob, FavoritesMap } from '@/lib/preferenceSync/types';

const PREFIX = `${API_BASE_URL}/user`; // MUST match the CloudFront path chosen in Task 7 Step 6

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${PREFIX}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export function fetchPreferences(): Promise<{ preferences: PreferencesBlob | null; favorites: FavoritesMap }> {
  return req('/preferences');
}
export function pushPreferences(body: { preferences: PreferencesBlob; favorites: FavoritesMap }): Promise<void> {
  return req('/preferences', { method: 'PUT', body: JSON.stringify(body) });
}
export function deleteAccount(): Promise<void> {
  return req('', { method: 'DELETE' });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/__tests__/userPreferencesApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/userPreferencesApi.ts frontend/src/lib/__tests__/userPreferencesApi.test.ts
git commit -m "feat(sync): authed user-preferences API client"
```

---

## Task 10: `usePreferenceSync` hook (wires reconcile + api + hooks)

**Files:**
- Create: `frontend/src/hooks/usePreferenceSync.ts`
- Create: `frontend/src/__tests__/hooks/usePreferenceSync.test.ts`

**Interfaces:**
- Consumes: `reconcileFavorites`/`reconcileBlob` (Task 1), `fetchPreferences`/`pushPreferences` (Task 9), a `FavoritesMap` + `mergeFavorites` from `useFavorites` (Task 2).
- Produces: `usePreferenceSync(opts: { isAuthenticated: boolean; favoritesMap: FavoritesMap; mergeFavorites: (m: FavoritesMap) => void; buildLocalBlob: () => PreferencesBlob; applyBlob: (b: PreferencesBlob) => void; changeSignature: string }): { syncing: boolean; lastError: string | null }`.
- Behavior: on `isAuthenticated` becoming true → `fetchPreferences`, reconcile with local, `applyBlob`/`mergeFavorites`, then push merged. On any local change (signalled by `changeSignature` changing) while authed → debounced `pushPreferences` (best-effort; errors captured in `lastError`, never thrown). The `changeSignature` is a primitive so the debounce effect has stable deps.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/__tests__/hooks/usePreferenceSync.test.ts
/// <reference types="vitest/globals" />
import { renderHook, act, waitFor } from '@testing-library/preact';
import { vi } from 'vitest';
vi.mock('@/lib/userPreferencesApi', () => ({
  fetchPreferences: vi.fn(),
  pushPreferences: vi.fn().mockResolvedValue(undefined),
}));
import { fetchPreferences, pushPreferences } from '@/lib/userPreferencesApi';
import { usePreferenceSync } from '@/hooks/usePreferenceSync';
import type { PreferencesBlob } from '@/lib/preferenceSync/types';

const blob = (lastSaved: number): PreferencesBlob => ({
  filters: { searchTerm: '', selectedTags: [], selectedLocations: [], dateFilter: 'next', selectedWeeks: [], expandedDescriptions: [], recentLocations: [], recentCategories: [], showFavoritesOnly: false },
  notes: {}, lastSaved,
});

describe('usePreferenceSync', () => {
  it('on sign-in, pulls server state, merges, and pushes the union', async () => {
    (fetchPreferences as any).mockResolvedValue({ preferences: blob(100), favorites: { e2: { favorited: true, at: 50 } } });
    const mergeFavorites = vi.fn();
    const applyBlob = vi.fn();
    renderHook(() => usePreferenceSync({
      isAuthenticated: true,
      favoritesMap: { e1: { favorited: true, at: 200 } },
      mergeFavorites,
      buildLocalBlob: () => blob(300),         // local newer
      applyBlob,
      changeSignature: 'sig-0',
    }));
    await waitFor(() => expect(mergeFavorites).toHaveBeenCalledWith({ e2: { favorited: true, at: 50 } }));
    // local blob newer (300 > 100) -> applyBlob keeps local; push includes unioned favorites
    await waitFor(() => expect(pushPreferences).toHaveBeenCalled());
    const pushed = (pushPreferences as any).mock.calls[0][0];
    expect(pushed.favorites.e1.favorited).toBe(true);
    expect(pushed.favorites.e2.favorited).toBe(true);
  });

  it('does nothing when not authenticated', () => {
    renderHook(() => usePreferenceSync({
      isAuthenticated: false, favoritesMap: {}, mergeFavorites: vi.fn(),
      buildLocalBlob: () => blob(1), applyBlob: vi.fn(), changeSignature: 'sig-0',
    }));
    expect(fetchPreferences).not.toHaveBeenCalled();
  });

  it('after initial sync, a changeSignature change debounces a write-through push', async () => {
    vi.useFakeTimers();
    (fetchPreferences as any).mockResolvedValue({ preferences: blob(1), favorites: {} });
    const props = {
      isAuthenticated: true, favoritesMap: { e1: { favorited: true, at: 10 } } as any,
      mergeFavorites: vi.fn(), buildLocalBlob: () => blob(10), applyBlob: vi.fn(),
      changeSignature: 'sig-1',
    };
    const { rerender } = renderHook((p: any) => usePreferenceSync(p), { initialProps: props });
    await vi.runOnlyPendingTimersAsync();          // let the initial sync + its push settle
    (pushPreferences as any).mockClear();
    // a local change: new signature + new favorites
    rerender({ ...props, changeSignature: 'sig-2', favoritesMap: { e1: { favorited: false, at: 20 } } });
    expect(pushPreferences).not.toHaveBeenCalled(); // still within debounce window
    await vi.advanceTimersByTimeAsync(1500);
    expect(pushPreferences).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/__tests__/hooks/usePreferenceSync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```ts
// frontend/src/hooks/usePreferenceSync.ts
import { useEffect, useRef, useState } from 'react';
import { fetchPreferences, pushPreferences } from '@/lib/userPreferencesApi';
import { reconcileBlob, reconcileFavorites } from '@/lib/preferenceSync/reconcile';
import type { FavoritesMap, PreferencesBlob } from '@/lib/preferenceSync/types';

interface Opts {
  isAuthenticated: boolean;
  favoritesMap: FavoritesMap;
  mergeFavorites: (m: FavoritesMap) => void;
  buildLocalBlob: () => PreferencesBlob;
  applyBlob: (b: PreferencesBlob) => void;
  // A cheap primitive the caller memoizes from favorites + filters (e.g. a
  // JSON string). Changes to it trigger the debounced write-through. Using a
  // primitive keeps the effect deps stable (buildLocalBlob is an inline arrow).
  changeSignature: string;
}

const WRITE_DEBOUNCE_MS = 1500;

export function usePreferenceSync(opts: Opts): { syncing: boolean; lastError: string | null } {
  const { isAuthenticated, favoritesMap, mergeFavorites, buildLocalBlob, applyBlob, changeSignature } = opts;
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const didInitialSync = useRef(false);            // guards duplicate initial fetches
  const [initialSyncDone, setInitialSyncDone] = useState(false); // gates the write-through; flips AFTER the initial push resolves
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial reconcile on sign-in.
  useEffect(() => {
    if (!isAuthenticated || didInitialSync.current) return;
    didInitialSync.current = true;
    let cancelled = false;
    (async () => {
      setSyncing(true);
      try {
        const server = await fetchPreferences();
        if (cancelled) return;
        const local = buildLocalBlob();
        const mergedBlob = server.preferences ? reconcileBlob(local, server.preferences) : local;
        applyBlob(mergedBlob);
        // mergeFavorites MUST be reconcile-into-local (union), never an overwrite —
        // useFavorites.mergeFavorites is reconcileFavorites(prev, incoming). If that
        // ever changes to a replace, local-only favorites would be lost here.
        const mergedFavorites = reconcileFavorites(favoritesMap, server.favorites ?? {});
        mergeFavorites(server.favorites ?? {});
        await pushPreferences({ preferences: mergedBlob, favorites: mergedFavorites });
      } catch (e) {
        if (!cancelled) setLastError(e instanceof Error ? e.message : 'sync failed');
      } finally {
        // Enable the write-through ONLY now — after the merged push has resolved —
        // so a debounced push can never fire with pre-merge state and clobber the
        // just-reconciled server copy.
        if (!cancelled) { setSyncing(false); setInitialSyncDone(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, favoritesMap, mergeFavorites, buildLocalBlob, applyBlob]);

  // Reset the guards on sign-out so a later sign-in re-syncs cleanly.
  useEffect(() => {
    if (!isAuthenticated) { didInitialSync.current = false; setInitialSyncDone(false); }
  }, [isAuthenticated]);

  // Debounced write-through: after the initial sync COMPLETES, any local change
  // (favorites toggled, filters edited) pushes to the server best-effort. This is
  // what makes sync ONGOING, not just at sign-in — device A's later edits reach B.
  useEffect(() => {
    if (!isAuthenticated || !initialSyncDone) return; // never overlaps the initial reconcile
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      pushPreferences({ preferences: buildLocalBlob(), favorites: favoritesMap })
        .catch((e) => setLastError(e instanceof Error ? e.message : 'sync failed'));
    }, WRITE_DEBOUNCE_MS);
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, [isAuthenticated, initialSyncDone, changeSignature, buildLocalBlob, favoritesMap]);

  return { syncing, lastError };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/__tests__/hooks/usePreferenceSync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/usePreferenceSync.ts frontend/src/__tests__/hooks/usePreferenceSync.test.ts
git commit -m "feat(sync): usePreferenceSync reconciles local and server on sign-in"
```

---

## Task 11: Header sign-in affordance + `/auth/callback` entry + page wiring

**Files:**
- Create: `frontend/src/lib/featureFlags.ts` + `frontend/src/lib/__tests__/featureFlags.test.ts` (the `VITE_ENABLE_ACCOUNTS` + `?accounts=1` gate)
- Create: `frontend/src/components/layout/SignInButton.tsx`
- Create: `frontend/src/components/layout/__tests__/SignInButton.test.tsx`
- Create: `frontend/index-auth-callback.html` + `frontend/src/entries/authCallback.tsx` (new page per multi-page convention) + `vite.config.ts` input entry
- Modify: `frontend/src/hooks/useFilterState.ts` (+ its test) — add a `HYDRATE_STATE` reducer action and a `hydrateFilters(snapshot)` callback so a server-won blob can be applied
- Modify: `frontend/src/components/layout/Header.tsx` (mount `SignInButton` in the desktop cluster + mobile menu, gated by the flag)
- Modify: `frontend/src/app/page.tsx` (call `useAuth` + `usePreferenceSync`, both gated by the flag)

**Interfaces:**
- Consumes: `useAuth` (Task 8), `useFavorites` + `useFilterState` (existing/Task 2), `usePreferenceSync` (Task 10), `exchangeCodeForTokens`+`saveTokens` (Task 8).
- Produces: `isAccountsEnabled(): boolean` — true when `VITE_ENABLE_ACCOUNTS === 'true'` OR the URL contains `?accounts=1` (per-visitor self-test opt-in). Gates ALL sign-in UI + sync activation.

- [ ] **Step 1: Write the failing component test**

```tsx
// frontend/src/components/layout/__tests__/SignInButton.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { SignInButton } from '../SignInButton';

describe('SignInButton', () => {
  it('shows "Sign in" and calls signIn when signed out', () => {
    const signIn = vi.fn();
    render(<SignInButton user={null} signIn={signIn} signOut={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(signIn).toHaveBeenCalled();
  });
  it('shows "Sign out" when signed in', () => {
    const signOut = vi.fn();
    render(<SignInButton user={{ sub: 'u1', email: 'x@y.z' }} signIn={() => {}} signOut={signOut} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/layout/__tests__/SignInButton.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SignInButton`** (presentational; state comes from props so it's trivially testable — Header passes `useAuth()` values in)

```tsx
// frontend/src/components/layout/SignInButton.tsx
interface Props {
  user: { sub: string; email?: string } | null;
  signIn: () => void;
  signOut: () => void;
}

export function SignInButton({ user, signIn, signOut }: Props) {
  const cls = 'px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors';
  return user
    ? <button className={cls} onClick={signOut}>Sign out</button>
    : <button className={cls} onClick={signIn}>Sign in</button>;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/components/layout/__tests__/SignInButton.test.tsx`
Expected: PASS.

- [ ] **Step 5: Feature-flag gate (TDD helper)**

Write the failing test, then the helper. This is the dark-launch switch — all
sign-in UI and sync activation route through it.

```ts
// frontend/src/lib/__tests__/featureFlags.test.ts
/// <reference types="vitest/globals" />
import { vi } from 'vitest';
import { isAccountsEnabled } from '@/lib/featureFlags';

describe('isAccountsEnabled', () => {
  const origSearch = window.location.search;
  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(window, 'location', { value: { ...window.location, search: origSearch }, writable: true });
  });
  it('is true when VITE_ENABLE_ACCOUNTS === "true"', () => {
    vi.stubEnv('VITE_ENABLE_ACCOUNTS', 'true');
    expect(isAccountsEnabled()).toBe(true);
  });
  it('is true when the URL has ?accounts=1 even if the env flag is off', () => {
    vi.stubEnv('VITE_ENABLE_ACCOUNTS', 'false');
    Object.defineProperty(window, 'location', { value: { ...window.location, search: '?accounts=1' }, writable: true });
    expect(isAccountsEnabled()).toBe(true);
  });
  it('is false by default (flag off, no param)', () => {
    vi.stubEnv('VITE_ENABLE_ACCOUNTS', 'false');
    Object.defineProperty(window, 'location', { value: { ...window.location, search: '' }, writable: true });
    expect(isAccountsEnabled()).toBe(false);
  });
});
```

Run: `cd frontend && npx vitest run src/lib/__tests__/featureFlags.test.ts`
(expect FAIL), then implement:

```ts
// frontend/src/lib/featureFlags.ts
export function isAccountsEnabled(): boolean {
  if (String(import.meta.env.VITE_ENABLE_ACCOUNTS) === 'true') return true;
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('accounts') === '1') return true;
  return false;
}
```

Re-run: expect PASS.

- [ ] **Step 6: Wire Header + page + callback (gated by the flag)**

Header: import `useAuth` + `isAccountsEnabled`; render
`<SignInButton user={user} signIn={signIn} signOut={signOut} />` inside the
desktop `gap-2` cluster (next to Feedback/Programs/Questions) and mirror into
the mobile "More" dropdown — **only when `isAccountsEnabled()`**. When the flag
is off the button does not render, so anonymous users see today's header
exactly.

**First, add a hydrate seam to `useFilterState`** (required by `applyBlob`).
The existing `reconcileFilters(availableCategories, availableLocations,
isCurrentYear)` only *prunes* invalid selections — it does NOT load a
`FilterSnapshot`, and the reducer has no HYDRATE action. So when the server
blob wins `reconcileBlob`, there is currently no way to apply it. Add one, TDD:

```ts
// in useFilterState.ts reducer — add a case:
// FilterState gains a real `lastSaved: number` (the time filters were last
// EDITED). This is what the blob-level LWW compares — do NOT fabricate it with
// Date.now() at read time (that makes local always win and breaks
// "expired-local pulls from server", spec §6.2).
case 'HYDRATE_STATE':
  return {
    ...state, // keep runtime-only fields (availableCategories/Locations, extraDays)
    searchTerm: action.snapshot.searchTerm,
    selectedTags: action.snapshot.selectedTags,
    selectedLocations: action.snapshot.selectedLocations,
    dateFilter: action.snapshot.dateFilter,
    selectedWeeks: action.snapshot.selectedWeeks,
    expandedDescriptions: new Set(action.snapshot.expandedDescriptions),
    recentLocations: action.snapshot.recentLocations,
    recentCategories: action.snapshot.recentCategories,
    showFavoritesOnly: action.snapshot.showFavoritesOnly,
    lastSaved: action.lastSaved, // adopt the server blob's timestamp on a server-won pull
  };
```
The reducer must bump `lastSaved` ONLY on genuine **user edits**. Use an
explicit allowlist of edit actions (safer than excluding runtime actions — a
future runtime-only action then can't accidentally fabricate a newer timestamp).
The current `useFilterState` reducer's action types are: `SET_SEARCH`,
`TOGGLE_TAG`, `TOGGLE_LOCATION`, `SET_DATE_FILTER`, `SET_SELECTED_WEEKS`,
`TOGGLE_DESCRIPTION`, `TOGGLE_FAVORITES_ONLY`, `CLEAR_FILTERS`,
`CLEAR_NON_DATE_FILTERS` (edits) vs `SET_AVAILABLE_CATEGORIES`,
`SET_AVAILABLE_LOCATIONS`, `ADD_EXTRA_DAY`, `CLEAR_EXTRA_DAYS`,
`RECONCILE_FILTERS`, `HYDRATE_STATE` (runtime/lifecycle — must NOT bump).
Note especially `RECONCILE_FILTERS`: it fires on availability/year load (not a
user action) and *can* prune persisted selections, so it must be excluded or
year-reconciliation would spuriously make local win the LWW.
```ts
const EDIT_ACTIONS: ReadonlySet<FilterAction['type']> = new Set([
  'SET_SEARCH', 'TOGGLE_TAG', 'TOGGLE_LOCATION', 'SET_DATE_FILTER',
  'SET_SELECTED_WEEKS', 'TOGGLE_DESCRIPTION', 'TOGGLE_FAVORITES_ONLY',
  'CLEAR_FILTERS', 'CLEAR_NON_DATE_FILTERS',
]);

function filterReducer(state: FilterState, action: FilterAction): FilterState {
  const next = baseFilterReducer(state, action);
  if (next === state) return state;                       // no real change
  if (action.type === 'HYDRATE_STATE') return next;       // sets its own lastSaved
  if (!EDIT_ACTIONS.has(action.type)) return next;        // runtime/lifecycle, not a user edit
  return { ...next, lastSaved: Date.now() };
}
```
`loadInitialState` seeds `lastSaved` from the persisted value when the stored
state is still valid, and **`0` when it is absent or expired** — so an
expired-local user loses the LWW tie and pulls the server copy:
```ts
// inside loadInitialState, in the valid branch: lastSaved: parsed.lastSaved,
// in the expired/default branch (return initialState): lastSaved: 0
```
Expose a callback (note it also carries the blob-level timestamp):
```ts
const hydrateFilters = useCallback((snapshot: FilterSnapshot, lastSaved: number) =>
  dispatch({ type: 'HYDRATE_STATE', snapshot, lastSaved }), []);
```
Add tests in `useFilterState.test.ts`: (a) an edit (`setSearchTerm`) bumps
`lastSaved`; (b) `setAvailableCategories` does NOT bump it; (c) **`reconcileFilters`
does NOT bump it** even when it prunes a now-invalid selection (guards the
year-reconciliation regression); (d) `hydrateFilters` sets fields AND `lastSaved`
to the passed value while leaving `availableCategories` untouched; (e) an expired
stored state loads with `lastSaved === 0`. (`FilterSnapshot` is the Task 1 type;
import it.)

**Then** `page.tsx`: after the existing `useFilterState()`/`useFavorites()`
calls, add (note `isAuthenticated` is `false` whenever the flag is off, so sync
never activates for gated-off visitors):
```tsx
const accountsOn = isAccountsEnabled();
const { user } = useAuth();
const buildLocalBlob = useCallback((): PreferencesBlob => ({
  filters: {
    searchTerm: filterState.searchTerm, selectedTags: filterState.selectedTags,
    selectedLocations: filterState.selectedLocations, dateFilter: filterState.dateFilter,
    selectedWeeks: filterState.selectedWeeks,
    expandedDescriptions: Array.from(filterState.expandedDescriptions),
    recentLocations: filterState.recentLocations, recentCategories: filterState.recentCategories,
    showFavoritesOnly: filterState.showFavoritesOnly,
  },
  notes: {},
  lastSaved: filterState.lastSaved, // REAL last-edit time, not Date.now()
}), [filterState]);
// Primitive change-signal for the debounced write-through (stable dep):
const changeSignature = JSON.stringify([favorites.favoritesMap, buildLocalBlob().filters]);
usePreferenceSync({
  isAuthenticated: accountsOn && user !== null,
  favoritesMap: favorites.favoritesMap,
  mergeFavorites: favorites.mergeFavorites,
  buildLocalBlob,
  applyBlob: (b) => filterState.hydrateFilters(b.filters, b.lastSaved), // hydrate seam carries the timestamp
  changeSignature,
});
```
(Adapt property access to however `page.tsx` currently destructures the hooks.)

`authCallback.tsx` entry (verifies the OAuth `state` before exchanging the code):
```tsx
// frontend/src/entries/authCallback.tsx
import { exchangeCodeForTokens, saveTokens, consumeAndVerifyState } from '@/lib/cognito';

const params = new URLSearchParams(window.location.search);
const code = params.get('code');
const stateOk = consumeAndVerifyState(params.get('state')); // CSRF check — single-use
if (code && stateOk) {
  exchangeCodeForTokens(code)
    .then(saveTokens)
    .finally(() => { window.location.href = '/'; });
} else {
  // Missing code or state mismatch → do NOT exchange; bounce home signed-out.
  window.location.href = '/';
}
```
Add `index-auth-callback.html` (mirroring an existing page's HTML) and register
it in `vite.config.ts` `rollupOptions.input`, output path `/auth/callback`.

- [ ] **Step 7: Run full frontend build + tests**

Run: `cd frontend && npm run build`
Expected: PASS (validate + type-check + lint + vitest + vite build all green).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/featureFlags.ts frontend/src/lib/__tests__/featureFlags.test.ts frontend/src/components/layout/ frontend/src/entries/authCallback.tsx frontend/index-auth-callback.html frontend/vite.config.ts frontend/src/app/page.tsx frontend/src/components/layout/Header.tsx
git commit -m "feat(auth): flag-gated header sign-in button, OAuth callback page, and page sync wiring"
```

---

## Task 12: Backend integration test — full authed round-trip

**Files:**
- Create: `backend/src/__tests__/integration/userPreferences.integration.test.ts`

**Interfaces:**
- Consumes: the in-memory `DynamoDBDocumentClient` harness
  (`backend/src/__tests__/integration/harness/inMemoryDocClient.ts`),
  `UserProfileService`, `FavoritesService`, and the handler route functions
  with services injected via `_set*ForTests`.

- [ ] **Step 1: Write the integration test**

```ts
// backend/src/__tests__/integration/userPreferences.integration.test.ts
import { InMemoryDocClient } from './harness/inMemoryDocClient'; // adjust import to the harness's actual export
import { UserProfileService } from '../../services/userProfileService';
import { FavoritesService } from '../../services/favoritesService';
import {
  handlePutPreferences, handleGetPreferences, handleDeleteUser,
  _setProfileServiceForTests, _setFavoritesServiceForTests, _setCognitoClientForTests,
} from '../../handlers/userHandler';

jest.mock('../../services/cognitoVerifier', () => ({ verifyCognitoAccessToken: jest.fn() }));
import { verifyCognitoAccessToken } from '../../services/cognitoVerifier';

const evt = (over: any = {}) => ({
  headers: { Authorization: 'Bearer good' }, httpMethod: 'GET', path: '/user/preferences',
  body: '', requestContext: { identity: { sourceIp: '::1' } }, ...over,
});

describe('user preferences round-trip (in-memory Dynamo)', () => {
  let cognitoSend: jest.Mock;
  beforeEach(() => {
    process.env.COGNITO_USER_POOL_ID = 'pool-1';
    const db: any = new InMemoryDocClient();
    _setProfileServiceForTests(new UserProfileService(db, 'users'));
    _setFavoritesServiceForTests(new FavoritesService(db, 'favorites', 'by-event'));
    cognitoSend = jest.fn().mockResolvedValue({});
    _setCognitoClientForTests({ send: cognitoSend } as any);
    // Realistic federated claim: real Cognito access tokens carry `username`,
    // which is what drives the AdminDeleteUser branch. Omitting it would let the
    // delete path silently no-op and hide regressions.
    (verifyCognitoAccessToken as jest.Mock).mockResolvedValue({ sub: 'u1', username: 'Google_123', tokenUse: 'access' });
  });
  afterEach(() => {
    _setProfileServiceForTests(null); _setFavoritesServiceForTests(null); _setCognitoClientForTests(null);
  });

  it('PUT then GET returns the stored blob and favorites; DELETE purges DB rows AND the Cognito user', async () => {
    await handlePutPreferences(evt({
      httpMethod: 'PUT',
      body: JSON.stringify({ preferences: { filters: {}, notes: {}, lastSaved: 42 }, favorites: { e1: { favorited: true, at: 9 } } }),
    }));
    const got = JSON.parse((await handleGetPreferences(evt())).body);
    expect(got.preferences.lastSaved).toBe(42);
    expect(got.favorites.e1).toEqual({ favorited: true, at: 9 });

    await handleDeleteUser(evt({ httpMethod: 'DELETE', path: '/user' }));
    const after = JSON.parse((await handleGetPreferences(evt())).body);
    expect(after.preferences).toBeNull();
    expect(after.favorites).toEqual({});
    // the Cognito user was actually deleted, with the pool Username
    expect(cognitoSend.mock.calls[0][0].input).toEqual({ UserPoolId: 'pool-1', Username: 'Google_123' });
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd backend && npx jest userPreferences.integration`
Expected: PASS. (If the harness constructor/import differs, adapt to the
harness's real API — inspect `inMemoryDocClient.ts` first.)

> The round-trip now exercises **conditional** writes (`putIfNewer` uses
> `attribute_not_exists(userId) OR lastSaved <= :ls`; `putRow` uses
> `attribute_not_exists(eventId) OR #at < :at` with a `#at` name alias). Confirm
> the in-memory harness evaluates these — the scout reported it supports
> condition expressions and throws `ConditionalCheckFailedException`; if it
> doesn't cover `attribute_not_exists`/comparison/name-aliases, extend it (a
> small, reusable harness improvement) rather than weakening the services.

- [ ] **Step 3: Full backend gate**

Run: `cd backend && npm run validate && npm run test:ci`
Expected: PASS; coverage at/above floor.

- [ ] **Step 4: Commit**

```bash
git add backend/src/__tests__/integration/userPreferences.integration.test.ts
git commit -m "test(user): integration round-trip for preferences put/get/delete"
```

---

## Phase 1 acceptance gate

Before opening the Phase 1 PR, all green:
- `cd frontend && npm run build` (validate + tests + build)
- `cd backend && npm run validate && npm run build`
- `cd infrastructure && terraform validate && terraform fmt -check`
- Guardrail suites present and passing: `reconcile.test.ts`,
  `useFavorites.test.ts` (migration), `cognitoVerifier.test.ts`,
  `userHandler.test.ts` (auth on every route + deletion purge),
  `userPreferences.integration.test.ts`.

Infra `apply`, Cognito Google credentials, and the CloudFront behavior are a
**deploy step performed with the user**, not part of the code PR.

### Phase 1 dark-launch sequence (protects current users)

Perform WITH the user, in order — the flag stays OFF in prod until the final
step:

1. **Local E2E** against the dev Cognito pool (Task 7 Step 7): sign in with
   Google, verify favorites/filters sync across two browsers.
2. **Apply infra** (prod pool + tables + Lambda + routes). `VITE_ENABLE_ACCOUNTS`
   still `false` in the prod build.
3. **Deploy the code dark.** All shared-path changes now run in prod with
   sign-in hidden. **Verify anonymous users are unaffected:** favorites still
   work, the header is unchanged, the legacy localStorage favorites of a real
   returning user still load (the migration is the load-bearing risk — Task 2).
4. **Self-test live** via `https://www.chqcal.org/?accounts=1`: sign in against
   the prod pool, confirm sync + account deletion end-to-end. Everyone else
   still sees the flag OFF.
5. **Expose** by rebuilding with `VITE_ENABLE_ACCOUNTS=true`. Instant rollback =
   redeploy with it `false` again.

---

# PHASE 2 — Apple sign-in + cross-provider account linking

> Do not start until Phase 1 is merged and deployed. Account-linking is the
> single most delicate flow in this plan; it is test-first.

## Task 12b (Phase 2 prerequisite): Staging environment

Apple Sign In rejects `http://localhost` — it needs HTTPS + a verified domain —
so Phase 2 requires a real `staging.chqcal.org` to test against before prod.
This is the Terraform refactor deferred from Phase 1.

- [ ] **Step 1:** Parameterize the single-prod hard-codings by `var.environment`:
  the Route53 zone/records, ACM cert usage (the `*.chqcal.org` wildcard already
  covers `staging.`), CloudFront `aliases`, and the fixed Lambda function names
  (env-suffix them). Introduce per-env resource naming end-to-end.
- [ ] **Step 2:** Move Terraform off committed-local state to a remote backend
  (S3 + DynamoDB lock) and/or workspaces so `staging` and `prod` don't share one
  state file. (Migrate the existing `terraform.tfstate`.)
- [ ] **Step 3:** Create `staging.tfvars` (`environment = "staging"`,
  `domain_name` handling for the subdomain) and a `staging` GitHub deploy path
  (a workflow that deploys the `staging` stack on demand / on a `staging` branch).
- [ ] **Step 4:** Stand up a staging Cognito pool + app client whose callbacks
  are `https://staging.chqcal.org/auth/callback`.
- [ ] **Step 5:** Smoke-test the staging stack end-to-end (Google sign-in +
  sync) before adding Apple, to prove the new environment works.
- [ ] **Step 6:** Commit `infra(staging): parameterized staging environment for Phase 2`.

> This task is sizeable and independent — it may be worth its own spec/plan
> cycle. It is listed here so Phase 2 is not started assuming localhost can test
> Apple.

## Task 13: Add Apple as a Cognito IdP (infra)

**Files:** Modify `infrastructure/user-accounts.tf`, `infrastructure/variables.tf`.

- [ ] **Step 1:** Add `aws_cognito_identity_provider "apple"` (provider_type
  `"SignInWithApple"`, `provider_details` with `client_id` = Apple Services ID,
  `team_id`, `key_id`, `private_key`, `authorize_scopes = "email name"`),
  variables `apple_services_id`/`apple_team_id`/`apple_key_id`/`apple_private_key`
  (all `sensitive`). Add `"SignInWithApple"` to the app client's
  `supported_identity_providers`. **Keep attribute auto-linking OFF.**
- [ ] **Step 2:** `terraform validate` + `terraform fmt -check`.
- [ ] **Step 3:** Commit `infra(user): add Apple Sign In identity provider`.

> Operational note to document in `docs/runbooks/`: the Apple `private_key`
> signs a client secret that Apple treats as expiring (~6 months); capture the
> rotation procedure. This is the tax we accepted Cognito to *reduce* but not
> fully remove — Cognito re-derives the client secret from the key, so rotate
> the key, not a hand-built JWT.

## Task 14: Account-linking endpoint (backend, test-first)

**Files:** Create `backend/src/services/accountLinkService.ts` +
`backend/src/__tests__/accountLinkService.test.ts`; add a `POST /user/link`
route to `userHandler.ts` + tests.

**Interfaces:**
- Produces: `class AccountLinkService { constructor(cognito: CognitoIdentityProviderClient, userPoolId: string); link(params: { destinationSub: string; sourceProvider: 'Google'|'SignInWithApple'; sourceProviderSub: string }): Promise<void> }` — wraps `AdminLinkProviderForUserCommand`.
- Route: `POST /user/link` — authed (destination = token `sub`), body identifies the second provider identity to merge; verifies the second provider's token *before* linking.

- [ ] **Step 1:** Write the failing service test — inject a fake
  `{ send: jest.fn() }` Cognito client; assert `AdminLinkProviderForUserCommand`
  input has `DestinationUser` = the existing user and `SourceUser` = the new
  provider identity, and that a link failure surfaces as a thrown error.
- [ ] **Step 2:** Run to verify failure.
- [ ] **Step 3:** Implement `AccountLinkService` using
  `@aws-sdk/client-cognito-identity-provider` (`AdminLinkProviderForUserCommand`),
  constructor-injected client (matches the DynamoDB service pattern).
- [ ] **Step 4:** Run to verify pass.
- [ ] **Step 5:** Write the failing handler test for `POST /user/link`:
  rejects unauthenticated (401); on success calls `AccountLinkService.link`
  with the token `sub` as destination and returns 204; **rejects when the two
  emails differ only via the explicit user-initiated flow (never silent
  auto-merge)** — assert the handler does not attempt any email-based merge.
- [ ] **Step 6:** Implement the route (verify the second-provider token via
  `verifyCognitoAccessToken` or the appropriate provider verification, then
  call the service). Run to verify pass.
- [ ] **Step 7:** `cd backend && npm run validate && npm run test:ci`.
- [ ] **Step 8:** Commit
  `feat(user): account-linking endpoint via AdminLinkProviderForUser`.

## Task 15: Frontend "link another provider" UI

**Files:** Create a small account/settings surface (e.g.
`frontend/src/components/account/LinkProviders.tsx` + test); add a
`linkProvider(provider)` call to `userPreferencesApi.ts`.

- [ ] **Step 1:** Write the failing component test — renders "Link Google" /
  "Link Apple" buttons based on `linkedProviders`; clicking initiates the
  second-provider PKCE redirect with a `link=1` marker so the callback calls
  `POST /user/link` instead of a fresh sign-in.
- [ ] **Step 2:** Run to verify failure.
- [ ] **Step 3:** Implement the component + the callback branch in
  `authCallback.tsx` that detects the link marker and calls the link endpoint.
- [ ] **Step 4:** Run to verify pass; `cd frontend && npm run build`.
- [ ] **Step 5:** Commit `feat(auth): link-another-provider UI and flow`.

## Phase 2 acceptance gate

- Linking tests green (service + handler + component).
- Manual smoke with the user: sign in with Google, link Apple (different
  email), confirm both providers resolve to the same `sub` and the same
  preferences/favorites.

---

## Open Questions / Dependencies to confirm at execution time

1. **CloudFront path** for `/user/*` vs `/api/user/*` (Task 7 Step 6) — the
   frontend `PREFIX` (Task 9) must match. Default `/user/*`.
2. **`DateFilter` import cycle** (Task 1 Step 1) — move the type into
   `types.ts` if a hook→lib cycle appears.
3. **In-memory harness API** (Task 12) — confirm the real export/constructor of
   `inMemoryDocClient.ts` before writing the integration test.
4. **`page.tsx` hook destructuring** (Task 11 Step 5) — adapt `buildLocalBlob`/
   `applyBlob` to the actual shapes returned by `useFilterState`/`useFavorites`.
5. **Cognito hosted-UI vs direct Google** — `buildAuthorizeUrl` can add
   `identity_provider=Google` to skip the Cognito chooser and go straight to
   Google. Decide during Task 8.
