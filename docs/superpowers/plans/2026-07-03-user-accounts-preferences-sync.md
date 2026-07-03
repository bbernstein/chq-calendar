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
- Coverage floors are enforced: frontend `frontend/.coverage-floor.json`,
  backend `backend/src/.coverage-floor.json`. New logic must keep coverage at
  or above the floor.
- Never commit to `main`. Work on a feature branch
  (`feat/user-accounts-preferences-sync` already exists).
- Never log user email or name (project sensitivity rule).
- Frontend hooks/JSX files import hooks/types from `'react'` (aliased to
  `preact/compat`); pure `.ts` logic files may import from `'preact/hooks'` or
  avoid Preact entirely.
- AWS resource names use the `"${var.app_name}-<thing>"` prefix; GSI names are
  `by-<attr>`; env vars are `*_TABLE_NAME`, resolved in code via
  `process.env.X ?? '<default>'`.
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
  client ID, pool ID, region.

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

/** Per-event last-write-wins. A present record beats undefined. */
export function mergeFavoritesRecord(
  a: FavoriteRecord | undefined,
  b: FavoriteRecord | undefined,
): FavoriteRecord {
  if (!a) return b!;
  if (!b) return a;
  return a.at >= b.at ? a : b;
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
    localStorage.setItem('chq-calendar-favorites', JSON.stringify({
      eventIds: ['old-a', 'old-b'], lastSaved: 1_000,
    }));
    const { result } = renderHook(() => useFavorites());
    expect(result.current.isFavorite('old-a')).toBe(true);
    expect(result.current.favoritesMap['old-a']).toEqual({ favorited: true, at: 1_000 });
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
  - `class UserProfileService { constructor(db: DynamoDBDocumentClient, tableName: string); get(userId): Promise<UserProfile | null>; put(profile: UserProfile): Promise<void>; delete(userId): Promise<void> }`

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

  it('put writes the profile to the table', async () => {
    mockSend.mockResolvedValueOnce({});
    await svc.put(profile({ userId: 'u2' }));
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.TableName).toBe('chq-users');
    expect(cmd.input.Item.userId).toBe('u2');
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

  async put(profile: UserProfile): Promise<void> {
    await this.db.send(new PutCommand({ TableName: this.tableName, Item: profile }));
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
  - `class FavoritesService { constructor(db, tableName, byEventIndexName); listByUser(userId): Promise<FavoriteRow[]>; putRow(row: FavoriteRow): Promise<void>; upsertMany(userId, map: Record<string,{favorited:boolean;at:number}>): Promise<void>; deleteAllForUser(userId): Promise<void>; countFavoritesForEvent(eventId): Promise<number> }`
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

  it('upsertMany writes one row per event with its timestamp', async () => {
    mockSend.mockResolvedValue({});
    await svc.upsertMany('u1', { e1: { favorited: true, at: 5 }, e2: { favorited: false, at: 6 } });
    expect(mockSend).toHaveBeenCalledTimes(2);
    const first: any = mockSend.mock.calls[0][0];
    expect(first.input.Item).toEqual({ userId: 'u1', eventId: 'e1', favorited: true, at: 5 });
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

  async putRow(row: FavoriteRow): Promise<void> {
    await this.db.send(new PutCommand({ TableName: this.tableName, Item: row }));
  }

  async upsertMany(
    userId: string,
    map: Record<string, { favorited: boolean; at: number }>,
  ): Promise<void> {
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
  - `verifyCognitoAccessToken(token: string): Promise<CognitoClaims | null>` — returns null on any failure (expired/bad sig/malformed/wrong use), mirroring `verifyPublisherJwt`.
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
  sub: string;
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
  try {
    const c = await verifier().verify(token);
    if (typeof c.sub !== 'string') return null;
    if (c.token_use !== 'access') return null;
    return {
      sub: c.sub,
      email: typeof c.email === 'string' ? c.email : undefined,
      tokenUse: 'access',
    };
  } catch {
    return null;
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
  - Test seams: `_setProfileServiceForTests(s | null)`, `_setFavoritesServiceForTests(s | null)`.
- Wire contract: `GET /user/preferences` → `{ preferences, favorites }` (favorites as a `FavoritesMap`); `PUT /user/preferences` body `{ preferences, favorites }` → 204; `DELETE /user` → 204 after purging profile + all favorites rows.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/__tests__/userHandler.test.ts
import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  handleGetPreferences, handlePutPreferences, handleDeleteUser,
  _setProfileServiceForTests, _setFavoritesServiceForTests,
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
  let profile: { get: jest.Mock; put: jest.Mock; delete: jest.Mock };
  let favorites: { listByUser: jest.Mock; upsertMany: jest.Mock; deleteAllForUser: jest.Mock };
  beforeEach(() => {
    jest.clearAllMocks();
    profile = { get: jest.fn(), put: jest.fn(), delete: jest.fn() };
    favorites = { listByUser: jest.fn(), upsertMany: jest.fn(), deleteAllForUser: jest.fn() };
    _setProfileServiceForTests(profile as any);
    _setFavoritesServiceForTests(favorites as any);
  });
  afterEach(() => { _setProfileServiceForTests(null); _setFavoritesServiceForTests(null); });

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
  });

  it('PUT persists blob + favorites and returns 204', async () => {
    (verifyCognitoAccessToken as jest.Mock).mockResolvedValue({ sub: 'u1', tokenUse: 'access' });
    profile.get.mockResolvedValue(null);
    const r = await handlePutPreferences(evt({
      httpMethod: 'PUT',
      headers: { Authorization: 'Bearer good' },
      body: JSON.stringify({ preferences: { filters: {}, notes: {}, lastSaved: 7 }, favorites: { e1: { favorited: false, at: 8 } } }),
    }));
    expect(r.statusCode).toBe(204);
    expect(profile.put).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', lastSaved: 7 }));
    expect(favorites.upsertMany).toHaveBeenCalledWith('u1', { e1: { favorited: false, at: 8 } });
  });

  it('DELETE purges profile AND all favorites rows', async () => {
    (verifyCognitoAccessToken as jest.Mock).mockResolvedValue({ sub: 'u1', tokenUse: 'access' });
    const r = await handleDeleteUser(evt({ httpMethod: 'DELETE', path: '/user', headers: { Authorization: 'Bearer good' } }));
    expect(r.statusCode).toBe(204);
    expect(favorites.deleteAllForUser).toHaveBeenCalledWith('u1');
    expect(profile.delete).toHaveBeenCalledWith('u1');
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
import { verifyCognitoAccessToken } from '../services/cognitoVerifier';
import { UserProfileService, type UserProfile } from '../services/userProfileService';
import { FavoritesService } from '../services/favoritesService';

// Local blob favorites shape (mirrors the frontend FavoritesMap; kept inline so
// the backend has no dependency on frontend types).
type FavRecord = { favorited: boolean; at: number };
type FavMap = Record<string, FavRecord>;

const CORS = {
  'Access-Control-Allow-Origin': '*',
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

function bearer(event: APIGatewayProxyEvent): string {
  const h = event.headers.Authorization || event.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}
async function requireUser(event: APIGatewayProxyEvent): Promise<string | null> {
  const claims = await verifyCognitoAccessToken(bearer(event));
  return claims?.sub ?? null;
}

export async function handleGetPreferences(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = await requireUser(event);
  if (!userId) return json(401, { error: 'unauthorized' });
  const [profile, rows] = await Promise.all([profileSvc().get(userId), favoritesSvc().listByUser(userId)]);
  const favorites: FavMap = {};
  for (const r of rows) favorites[r.eventId] = { favorited: r.favorited, at: r.at };
  return json(200, { preferences: profile?.preferences ?? null, favorites });
}

export async function handlePutPreferences(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = await requireUser(event);
  if (!userId) return json(401, { error: 'unauthorized' });
  let parsed: { preferences?: { lastSaved?: number }; favorites?: FavMap };
  try { parsed = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'invalid json' }); }
  const existing = await profileSvc().get(userId);
  const now = Date.now();
  const toStore: UserProfile = {
    userId,
    preferences: parsed.preferences ?? existing?.preferences ?? null,
    lastSaved: parsed.preferences?.lastSaved ?? now,
    createdAt: existing?.createdAt ?? now,
    linkedProviders: existing?.linkedProviders,
  };
  await profileSvc().put(toStore);
  if (parsed.favorites) await favoritesSvc().upsertMany(userId, parsed.favorites);
  return json(204);
}

export async function handleDeleteUser(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = await requireUser(event);
  if (!userId) return json(401, { error: 'unauthorized' });
  await favoritesSvc().deleteAllForUser(userId); // favorites first: never orphan rows if profile delete fails
  await profileSvc().delete(userId);
  return json(204);
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod.toUpperCase();
  const path = event.path;
  if (method === 'OPTIONS') return json(204);
  if (path.endsWith('/user/preferences') && method === 'GET') return handleGetPreferences(event);
  if (path.endsWith('/user/preferences') && method === 'PUT') return handlePutPreferences(event);
  if (path.endsWith('/user') && method === 'DELETE') return handleDeleteUser(event);
  return json(404, { error: 'not found' });
}
```

> The handler uses the inline `FavMap` type (no cross-package type import) so
> the backend never depends on frontend types. The wire shape is identical to
> the frontend `FavoritesMap`; the test only depends on that shape.

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx jest userHandler`
Expected: PASS — all four cases green (401, GET shape, PUT persistence, DELETE purge order).

- [ ] **Step 5: Run backend validate (lint is zero-warning) + full test**

Run: `cd backend && npm run validate && npx jest`
Expected: PASS, no lint warnings.

- [ ] **Step 6: Commit**

```bash
git add backend/src/handlers/userHandler.ts backend/src/__tests__/userHandler.test.ts
git commit -m "feat(user): userHandler routes with auth enforcement and deletion purge"
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

  # No password self-signup surface needed; federation only in Phase 1.
  admin_create_user_config {
    allow_admin_create_user_only = false
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
    # CRITICAL: do NOT enable attribute-based auto-linking. Linking is explicit (Phase 2).
  }

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
    Statement = [{
      Effect = "Allow",
      Action = [
        "dynamodb:Query", "dynamodb:GetItem", "dynamodb:PutItem",
        "dynamodb:UpdateItem", "dynamodb:DeleteItem"
      ],
      Resource = [
        aws_dynamodb_table.users.arn,
        aws_dynamodb_table.favorites.arn,
        "${aws_dynamodb_table.favorites.arn}/index/by-event"
      ]
    }]
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

- [ ] **Step 7: Validate (no apply)**

Run: `cd infrastructure && terraform init -backend=false && terraform validate`
Expected: `Success! The configuration is valid.`

Run: `cd infrastructure && terraform fmt -check`
Expected: no diffs (run `terraform fmt` if it reports files).

- [ ] **Step 8: Commit (still no apply)**

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
  - `frontend/src/lib/cognito.ts`: `buildAuthorizeUrl(): string` (PKCE), `exchangeCodeForTokens(code: string): Promise<AuthTokens>`, `refreshTokens(refreshToken: string): Promise<AuthTokens>`, `AuthTokens = { accessToken: string; idToken: string; refreshToken?: string; expiresAt: number }`, storage helpers `saveTokens/getTokens/clearTokens/getAccessToken`.
  - `frontend/src/hooks/useAuth.ts`: `useAuth(): { user: { sub: string; email?: string } | null; signIn(): void; signOut(): void; isAuthenticated: boolean }`.
- Storage keys: `chq_user_tokens` (JSON), following the existing `chq_*` convention.

- [ ] **Step 1: Write the failing test for the pure PKCE/token bits** (redirect and network calls are integration; test the storage + expiry logic and URL construction)

```ts
// frontend/src/lib/__tests__/cognito.test.ts
/// <reference types="vitest/globals" />
import { saveTokens, getTokens, clearTokens, getAccessToken, isExpired, type AuthTokens } from '@/lib/cognito';

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
function randomVerifier(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return base64url(arr.buffer);
}

export async function buildAuthorizeUrl(): Promise<string> {
  const verifier = randomVerifier();
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  const challenge = base64url(await sha256(verifier));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid email profile',
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  return `${DOMAIN}/oauth2/authorize?${params.toString()}`;
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
import { buildAuthorizeUrl, getTokens, clearTokens, isExpired, refreshTokens, saveTokens } from '@/lib/cognito';

interface AuthUser { sub: string; email?: string }

function decodeIdToken(idToken: string): AuthUser | null {
  try {
    const payload = JSON.parse(atob(idToken.split('.')[1]));
    return { sub: payload.sub, email: payload.email };
  } catch { return null; }
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
- Produces: `usePreferenceSync(opts: { isAuthenticated: boolean; favoritesMap: FavoritesMap; mergeFavorites: (m: FavoritesMap) => void; buildLocalBlob: () => PreferencesBlob; applyBlob: (b: PreferencesBlob) => void }): { syncing: boolean; lastError: string | null }`.
- Behavior: on `isAuthenticated` becoming true → `fetchPreferences`, reconcile with local, `applyBlob`/`mergeFavorites`, then push merged. On local favorites change while authed → debounced `pushPreferences` (best-effort; errors captured in `lastError`, never thrown).

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
      buildLocalBlob: () => blob(1), applyBlob: vi.fn(),
    }));
    expect(fetchPreferences).not.toHaveBeenCalled();
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
}

export function usePreferenceSync(opts: Opts): { syncing: boolean; lastError: string | null } {
  const { isAuthenticated, favoritesMap, mergeFavorites, buildLocalBlob, applyBlob } = opts;
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const didInitialSync = useRef(false);

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
        const mergedFavorites = reconcileFavorites(favoritesMap, server.favorites ?? {});
        mergeFavorites(server.favorites ?? {});
        await pushPreferences({ preferences: mergedBlob, favorites: mergedFavorites });
      } catch (e) {
        if (!cancelled) setLastError(e instanceof Error ? e.message : 'sync failed');
      } finally {
        if (!cancelled) setSyncing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, favoritesMap, mergeFavorites, buildLocalBlob, applyBlob]);

  // Reset the guard on sign-out so a later sign-in re-syncs.
  useEffect(() => { if (!isAuthenticated) didInitialSync.current = false; }, [isAuthenticated]);

  return { syncing, lastError };
}
```

> The debounced write-through on subsequent local changes can be added here
> later; the initial-reconcile + push is the core guardrail behavior and is
> what the tests pin. Keep the push best-effort (never throw to the UI).

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
- Create: `frontend/src/components/layout/SignInButton.tsx`
- Create: `frontend/src/components/layout/__tests__/SignInButton.test.tsx`
- Create: `frontend/index-auth-callback.html` + `frontend/src/entries/authCallback.tsx` (new page per multi-page convention) + `vite.config.ts` input entry
- Modify: `frontend/src/components/layout/Header.tsx` (mount `SignInButton` in the desktop cluster + mobile menu)
- Modify: `frontend/src/app/page.tsx` (call `useAuth` + `usePreferenceSync`)

**Interfaces:**
- Consumes: `useAuth` (Task 8), `useFavorites` + `useFilterState` (existing/Task 2), `usePreferenceSync` (Task 10), `exchangeCodeForTokens`+`saveTokens` (Task 8).

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

- [ ] **Step 5: Wire Header + page + callback**

Header: import `useAuth`, render `<SignInButton user={user} signIn={signIn} signOut={signOut} />` inside the desktop `gap-2` cluster (next to Feedback/Programs/Questions) and mirror into the mobile "More" dropdown.

`page.tsx`: after the existing `useFilterState()`/`useFavorites()` calls, add:
```tsx
const { user } = useAuth();
usePreferenceSync({
  isAuthenticated: user !== null,
  favoritesMap: favorites.favoritesMap,
  mergeFavorites: favorites.mergeFavorites,
  buildLocalBlob: () => ({
    filters: {
      searchTerm: filterState.searchTerm, selectedTags: filterState.selectedTags,
      selectedLocations: filterState.selectedLocations, dateFilter: filterState.dateFilter,
      selectedWeeks: filterState.selectedWeeks,
      expandedDescriptions: Array.from(filterState.expandedDescriptions),
      recentLocations: filterState.recentLocations, recentCategories: filterState.recentCategories,
      showFavoritesOnly: filterState.showFavoritesOnly,
    },
    notes: {},
    lastSaved: Date.now(),
  }),
  applyBlob: (b) => filterState.reconcileFilters(b.filters), // use existing reconcileFilters seam
});
```
(Adapt property access to however `page.tsx` currently destructures the hooks.)

`authCallback.tsx` entry:
```tsx
// frontend/src/entries/authCallback.tsx
import { exchangeCodeForTokens, saveTokens } from '@/lib/cognito';

const code = new URLSearchParams(window.location.search).get('code');
if (code) {
  exchangeCodeForTokens(code)
    .then(saveTokens)
    .finally(() => { window.location.href = '/'; });
} else {
  window.location.href = '/';
}
```
Add `index-auth-callback.html` (mirroring an existing page's HTML) and register
it in `vite.config.ts` `rollupOptions.input`, output path `/auth/callback`.

- [ ] **Step 6: Run full frontend build + tests**

Run: `cd frontend && npm run build`
Expected: PASS (validate + type-check + lint + vitest + vite build all green).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/layout/ frontend/src/entries/authCallback.tsx frontend/index-auth-callback.html frontend/vite.config.ts frontend/src/app/page.tsx frontend/src/components/layout/Header.tsx
git commit -m "feat(auth): header sign-in button, OAuth callback page, and page sync wiring"
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
  _setProfileServiceForTests, _setFavoritesServiceForTests,
} from '../../handlers/userHandler';

jest.mock('../../services/cognitoVerifier', () => ({ verifyCognitoAccessToken: jest.fn() }));
import { verifyCognitoAccessToken } from '../../services/cognitoVerifier';

const evt = (over: any = {}) => ({
  headers: { Authorization: 'Bearer good' }, httpMethod: 'GET', path: '/user/preferences',
  body: '', requestContext: { identity: { sourceIp: '::1' } }, ...over,
});

describe('user preferences round-trip (in-memory Dynamo)', () => {
  beforeEach(() => {
    const db: any = new InMemoryDocClient();
    _setProfileServiceForTests(new UserProfileService(db, 'users'));
    _setFavoritesServiceForTests(new FavoritesService(db, 'favorites', 'by-event'));
    (verifyCognitoAccessToken as jest.Mock).mockResolvedValue({ sub: 'u1', tokenUse: 'access' });
  });
  afterEach(() => { _setProfileServiceForTests(null); _setFavoritesServiceForTests(null); });

  it('PUT then GET returns the stored blob and favorites; DELETE purges both', async () => {
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
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd backend && npx jest userPreferences.integration`
Expected: PASS. (If the harness constructor/import differs, adapt to the
harness's real API — inspect `inMemoryDocClient.ts` first.)

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

---

# PHASE 2 — Apple sign-in + cross-provider account linking

> Do not start until Phase 1 is merged and deployed. Account-linking is the
> single most delicate flow in this plan; it is test-first.

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
