# User Accounts & Server-Side Preference Sync — Design

**Status:** Draft for review
**Date:** 2026-07-03
**Scope:** Phase 1 (Google sign-in + preference sync) and Phase 2 (Apple
sign-in + cross-provider account linking). Phase 3 (ambient discovery UI)
is explicitly **out of scope** but the data model is designed so event
popularity is queryable later without a schema change.

---

## 1. Motivation & Context

The calendar today is fully anonymous and offline-first: all user state
(filters, favorites) lives in `localStorage` with a 30-day expiry and never
touches the server. This design introduces the app's **first end-user
identity system** so that a signed-in user's preferences follow them across
devices.

This is a deliberate departure from the anonymous model. The guiding
constraint is that **it must not regress the anonymous, offline-first
experience** — signed-out users behave exactly as they do today.

### Goals

- Google **and** Apple sign-in.
- One human with two different provider emails is **one account** (account
  linking across providers).
- Server-side persistence of preferences (filters, favorites, notes) for
  signed-in users, synced across devices.
- Preserve offline-first behavior: the UI never blocks on the network for
  user state.
- Store favorites such that **event popularity is queryable** from the data
  (admin/aggregate only) — with **no user-facing UI** for it in this scope.

### Non-goals (this scope)

- Groups, sharing, or event suggestions between users.
- Friend activity / social graph.
- Any popularity/trending UI, publisher-follow UI, or public popularity
  endpoint.
- Notifications, reminders, `.ics` export (possible future work, not here).

---

## 2. Current-State Facts (verified)

- **Preference persistence is localStorage-only.** No server-side user
  storage exists.
  - `frontend/src/hooks/useFilterState.ts` — key `chq-calendar-user-state`;
    a `useReducer` blob (`searchTerm`, `selectedTags`, `selectedLocations`,
    `dateFilter`, `selectedWeeks`, `expandedDescriptions`, `recentLocations`,
    `recentCategories`, `showFavoritesOnly`, `lastSaved`).
  - `frontend/src/hooks/useFavorites.ts` — key `chq-calendar-favorites`;
    `{ eventIds: string[], lastSaved: number }`.
  - Both use `USER_STATE_EXPIRY_MS` (30 days) from
    `frontend/src/lib/constants.ts`. Every write stamps `lastSaved =
    Date.now()`.
- **Two existing bespoke JWT auth systems** (both HS256, localStorage):
  admin Google-OAuth (`backend/src/handlers/adminHandler.ts`, whitelist-
  bound) and publisher magic-link
  (`backend/src/services/publisherAuthService.ts`). The Google OAuth2 client
  + JWT helpers are a usable *template* but are hard-gated to the admin email
  whitelist — not a drop-in for end users.
- **Data layer:** DynamoDB (PAY_PER_REQUEST), Terraform IaC. No
  user/account/preferences table exists. IAM roles are already split
  (`admin_lambda_role` vs `lambda_role`).
- **Auth pattern:** no API Gateway authorizer; JWTs are verified
  **in-Lambda** per route. A new authenticated endpoint follows this
  convention.

---

## 3. Identity Layer — Cognito

**Decision:** AWS Cognito User Pool, Terraform-managed, federating Google
(Phase 1) and Apple (Phase 2). Chosen over roll-your-own (avoids Apple's
client-secret rotation tax and a third bespoke auth system) and over managed
SaaS like Clerk (keeps PII in-account, stays in Terraform IaC, stays light on
the bundle). See the decision matrix in the brainstorming discussion.

- **Flow:** OAuth Authorization Code + **PKCE** redirect — correct for a
  static SPA (no client secret in the browser). Sign-in redirects to Cognito,
  returns to a callback URL with ID/access/refresh tokens.
- **Token verification:** Lambdas verify the Cognito **access token against
  the pool's JWKS** (public keys) — replacing the shared-HS256-secret pattern
  with standard asymmetric verification. Fits the existing "verify JWT
  in-Lambda" convention.
- **Account key = Cognito `sub`.** Because linking is performed *inside*
  Cognito (`AdminLinkProviderForUser`), both providers resolve to the **same
  Cognito user with the same stable `sub`**. The Phase 1 data model therefore
  survives Phase 2 unchanged.
- **Linking guard:** Cognito's default email-based auto-linking **must be
  disabled** so two different people who share an email are never merged.

---

## 4. API & Compute

- **New `user_handler` Lambda** with its own **`user_lambda_role`**,
  deliberately separate from `admin_lambda_role` and the public
  `lambda_role`. End-user access never touches admin/publisher privileges.
- **Routes** (JWT verified in-handler against Cognito JWKS):
  - `GET /user/preferences` — return the user's blob + favorites.
  - `PUT /user/preferences` — upsert the blob and favorites (reconciled
    server-side; see §6).
  - `DELETE /user` — account deletion: purge Cognito user + `users` row +
    all `favorites` rows (see §7).
- Popularity is **not** an endpoint in this scope — it is an admin/aggregate
  query against the `by-event` GSI (§5), used ad hoc, no public surface.

---

## 5. Data Model

### `chq-calendar-users`
- Hash key: `userId` (= Cognito `sub`).
- Attributes:
  - `preferences` — opaque blob `{ filterState, notes }` (mirrors the
    existing `useFilterState` shape, plus optional per-event `notes`).
  - `email` — informational only, **never a key**.
  - `linkedProviders: string[]` — informational (e.g. `["google","apple"]`).
  - `lastSaved: number`, `createdAt: number`.

### `chq-calendar-favorites`
- Hash key: `userId`, range key: `eventId`. **One row per favorite.**
- Attributes: `{ favorited: boolean, at: number }`.
- **GSI `by-event`:** hash `eventId` — the popularity index. Counting/
  querying favorites per event is a direct GSI query, available from day one,
  admin-only, no UI.

**Why favorites are split out of the blob:** keeping favorites in the opaque
`preferences` blob would make popularity require a full-table scan + JSON
parse. As their own rows with a `by-event` GSI, popularity is queryable for
free, *and* reconciliation simplifies to plain **per-event last-write-wins**
(each event's favorite status is an independent row with an `at` timestamp; a
removal is a newer row that beats a stale add). Filters/notes stay in the
blob where nobody needs to query inside them.

---

## 6. Sync & Offline-First Behavior

**Governing principle: the server is always best-effort; the UI never waits
on it.** `localStorage` remains the instant, always-on source of truth.
**Signed-out users get byte-for-byte today's behavior.**

- **Write path (signed in):** write `localStorage` immediately (instant,
  offline-safe), then a **debounced best-effort** push to the server. Offline
  → queue and retry on reconnect. A failed sync never blocks or flickers the
  UI.
- **Read/reconcile path (sign-in or app load):** fetch server state,
  reconcile with local, write the result back to both.

**Reconciliation is asymmetric by data type:**

- **Filters = last-write-wins by `lastSaved`.** A filter set is the user's
  "current view"; newest simply wins. The existing `lastSaved` timestamp
  drives this for free.
- **Favorites = per-event last-write-wins rows** (§5). Union behavior falls
  out naturally; no starred event is silently lost or resurrected.

**Two consequences fall out of this design:**

1. **First sign-in merges anonymous state up.** A previously-anonymous
   user's existing localStorage favorites/filters merge into their new empty
   account — they lose nothing by signing in.
2. **Signing in defeats the 30-day forgetting.** The server copy is durable,
   so local expiry degrades to "just a cache": if local has expired but the
   user is signed in, pull from the server.

**Accepted loss:** two devices editing *filters* while both offline → one
view loses (last-write-wins). Intentional and invisible in practice for a
"current view."

---

## 7. Cross-Cutting Concerns

- **Privacy / data residency.** Favorites are person-linked data. The
  `by-event` popularity query is **admin/aggregate-only**; no public
  popularity endpoint exists in this scope. All PII stays in the AWS account.
  **Never log email/name** (per project sensitivity rules).
- **Account deletion.** `DELETE /user` must purge the Cognito user, the
  `users` row, and **all** `favorites` rows for that `userId`. Designed in
  now, not retrofitted.
- **Sessions.** Cognito refresh tokens keep sessions alive; `useAuth`
  silently refreshes the access token. Refresh failure → graceful fallback to
  signed-out (local-only), never a hard error.
- **Apple specifics (Phase 2).** Apple returns the user's name **only on
  first auth**, supports **private-relay emails**, and requires the
  email-auto-merge guard to be off before linking.
- **Testing.** Reconciliation/merge logic is the highest-risk unit → test
  first (offline-both-devices, delete-beats-stale-add, first-sign-in
  merge-up, expired-local-but-signed-in pull). Authenticated endpoints get
  integration tests in the existing program; JWKS verification gets its own
  tests. Respect the coverage floor.

---

## 8. Frontend Changes

- **`useAuth` hook** — consumer sibling to `useAdminAuth`; owns the PKCE
  redirect, token storage (localStorage, consistent with existing keys),
  silent refresh, and sign-out.
- **Sync layer** — sits *underneath* `useFilterState` and `useFavorites`,
  which change minimally: they keep writing localStorage; the sync layer
  observes changes and reconciles with the server when signed in.
- **Favorites shape change** — `useFavorites` moves from a bare `Set<string>`
  to per-event records `{ favorited, at }` to support LWW merge and the row
  model. Handle migration of the existing `chq-calendar-favorites`
  localStorage value.
- **Sign-in entry point** — a lightweight sign-in affordance in the header;
  no dedicated page required for Phase 1 beyond the OAuth callback handler.

---

## 9. Deployment (Terraform)

Adds:
- Cognito user pool + hosted domain + Google IdP (Phase 1); Apple IdP
  (Phase 2).
- `user_handler` Lambda + `user_lambda_role` (scoped to the two new tables
  only).
- `chq-calendar-users` and `chq-calendar-favorites` tables (favorites with
  the `by-event` GSI; consider PITR + SSE as with publisher tables).
- CloudFront routing for `/user/*` and the OAuth callback path.
- `VITE_`-prefixed frontend config: Cognito domain, client ID, pool ID,
  region.
- Secrets: Google client secret (Phase 1); Apple sign-in key + key ID + team
  ID (Phase 2).

---

## 10. Phasing

- **Phase 1 — Google sign-in + preference sync.** Cognito pool + Google IdP,
  `user_handler` + tables + IAM, `useAuth`, sync layer, favorites row model.
  Delivers cross-device favorites/filters. Independently shippable; proves
  the entire vertical slice.
- **Phase 2 — Apple sign-in + account linking.** Apple IdP + the "link
  another provider" flow (signed-in re-auth → `AdminLinkProviderForUser`) +
  the email-auto-merge guard. No data-model change (account keyed on `sub`).
  Test-first on the linking flow.

Phase 3 (ambient discovery UI) is out of scope; the `by-event` GSI leaves the
door open with no rework.

---

## 11. Open Questions / Dependencies to Verify

- Confirm the exact Cognito access-token verification library/approach for
  the Node Lambda runtime (JWKS caching).
- Confirm whether the header has room for a sign-in affordance without a
  layout regression on mobile.
- Confirm the localStorage favorites migration path (bare array → per-event
  records) preserves existing anonymous favorites on first load.
