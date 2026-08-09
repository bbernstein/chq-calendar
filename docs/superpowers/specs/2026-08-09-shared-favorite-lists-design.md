# Shared Favorite Lists — Publish, Follow, and Be Alerted — Design

**Status:** Draft for review — not implemented, not scheduled
**Date:** 2026-08-09
**Scope:** Named favorite lists with per-list visibility; invite-link and
public following; follower alerts on iOS. Web first, iOS after.
**Hard prerequisite:** user accounts
(`docs/superpowers/specs/2026-07-03-user-accounts-preferences-sync-design.md`,
issue #132), which is specced but **not built**. Nothing here can ship before
it.

---

## 1. Motivation & Context

Favorites today are private by construction and private by accident: they
live in `localStorage` (web) and `UserDefaults` (iOS) and never leave the
device. Two real needs are unserved by that:

- **Households.** Two people attending the same lectures and concerts
  currently star every event twice, on two devices, and each maintains the
  duplicate by hand. One of them should be able to curate the shared set once
  and have both be alerted to it.
- **Public figures.** A chaplain-in-residence, a visiting artist, or an
  Institution staff member may want their week's schedule followable so
  attendees know where to find them.

Both are the same operation — *publish a set of events to a defined
audience* — separated only by who the audience is.

This is a **deliberate departure from the app's privacy posture**, and a
sharper one than user accounts were. Accounts moved private data to a server
the user controls. This moves it to other people. A published schedule is a
statement about where a real person will physically be, on a small walkable
campus, at a known time. Section 9 treats that as a first-class design
constraint, not a footnote.

### Goals

- Named lists, each with its own visibility, replacing the single flat
  favorites set as the top-level organizing idea.
- Share a list with a specific person (spouse, friend) without building an
  approval inbox.
- Publish a list to anyone, for the public-figure case.
- Followers see live updates and can opt into alerts for a followed list.
- The private default set stays private and unshareable, with no toggle that
  could expose it by accident.

### Non-goals (this scope)

- Co-editing. Every list has exactly one owner; followers are read-only.
- An approval/request queue for followers.
- A browsable public directory or search of user lists.
- Handles, profiles, avatars, or any user-to-user surface beyond a list.
- Attendance, check-in, presence, "here now", or last-seen.
- Comments, reactions, or messaging.
- Any change to the signed-out experience. Signed-out users are unaffected,
  byte for byte.

---

## 2. Current-State Facts (verified 2026-08-09)

- **Favorites are a flat set of event IDs on both platforms, device-local.**
  - Web: `frontend/src/hooks/useFavorites.ts`, `localStorage` key
    `chq-calendar-favorites`, shape `{ eventIds: string[], lastSaved: number }`,
    30-day expiry via `USER_STATE_EXPIRY_MS`.
  - iOS: `ios/ChqCalendarShared/Data/UserStateStore.swift`, `UserDefaults` key
    `chq-favorites`, decoded to a `Set<String>`.
- **No end-user identity exists.** There is no user table, no user-facing
  sign-in, and no server-side user state. The three existing auth paths (admin
  Google OAuth, publisher magic link, CI smoke token) are all HS256 and all
  operator-facing.
- **The accounts design is written but unbuilt.** It specifies Cognito
  (PKCE), a `${var.app_name}-users` table, and a `${var.app_name}-favorites`
  table keyed `(userId, eventId)` with a `by-event` GSI, plus a `user_handler`
  Lambda with its own `user_lambda_role`. It explicitly lists "groups,
  sharing, or event suggestions between users" as a non-goal — **this design is
  the feature that non-goal was deferring.**
- **iOS already converts a favorites set into scheduled notifications.**
  `ios/ChqCalendarShared/Domain/ReminderPlanner.swift`:
  `plan(favorites:events:settings:now:)` skips non-favorited and `.cancelled`
  events, sorts by `triggerDate` ascending with `eventID` as tiebreak, and
  truncates to **`maxPending = 60`** — deliberately under the OS's 64 pending
  local-notification ceiling to leave headroom for non-reminder notifications.
  This is the seam follower alerts plug into, and the cap is the constraint
  they strain (§10).
- **Static-JSON-on-CloudFront is the house pattern for read-heavy data**
  (`all-events.json`, the article-links and program-links sidecars). It is the
  natural escape hatch if a public list ever gets a large following (§7).
- **Terraform table naming is `"${var.app_name}-<thing>"`**, `app_name`
  defaulting to `chautauqua-calendar`.

---

## 3. Decisions

Settled during brainstorming on 2026-08-09. Each was chosen over the
alternatives noted.

| # | Decision | Chosen over |
|---|---|---|
| 1 | **Named lists with per-list visibility.** One concept covers household sharing, friend following, and public broadcasting. | A single shared/private flag per favorite (only one audience); a separate "household" feature plus a separate "follow" feature (two permission systems). |
| 2 | **One owner, read-only followers.** | Co-editable lists (a second permission tier plus multi-writer conflict handling); designing a `role` field in now for later co-edit (YAGNI). |
| 3 | **Live subscription with opt-in alerts.** Followed events stay distinct from the follower's own stars. | One-time import/fork (a snapshot, which breaks the "one of us maintains it" premise); live plus per-event adopt (extra affordance, upstream-removal ambiguity). |
| 4 | **Invite links, no approval inbox.** Possession of the link is the approval. Owner holds a follower roster, can remove followers, and can rotate the link. | A request-to-follow approval queue (needs an inbox, a notification path, and solves the wrong problem — you can't tell which "J. Smith" is requesting); both mechanisms (doubles the access-control surface). |
| 5 | **Public lists are link-only, plus an admin-curated featured surface.** No browsable directory, no search of user lists. | An open directory (hosting user-generated public content: moderation, reporting, takedown, impersonation policing); no featured surface at all (zero in-app discovery). |
| 6 | **Four safety guarantees, all in scope for v1** (§9). | Shipping any of them as a follow-up. |
| 7 | **Web first, iOS after** (§14). | iOS-first (front-loads value but front-loads unbuilt iOS sign-in and gates every phase on App Store review); one big cross-platform phase (no intermediate shippable state). |

---

## 4. The Model

### Lists

Every account has exactly one **default list**, "My Favorites". It is
created implicitly on first sign-in, is private, cannot be deleted, cannot be
renamed, and **cannot be given any visibility other than `private`**. It is
exactly today's star behavior, and it is the list the existing star control
writes to. This is guarantee (a) of §9: there is no control anywhere that
turns the set you already have into a published one.

Any other list is created explicitly, named by the owner, and carries a
visibility:

| Visibility | Who can read | How they get in | Listed anywhere |
|---|---|---|---|
| `private` | owner only | — | no |
| `invite` | anyone holding the invite link or code | owner sends the link or shows a QR | no |
| `public` | anyone holding the URL | owner promotes it wherever they like | only if an admin features it |

An event may belong to any number of lists. The yoga class lives only in "My
Favorites"; the concert and the lecture live in "Ours", which the spouse
follows. Removing an event from one list never affects another.

### Following

A **follow** is a membership row linking a follower to a list. It carries an
`alertsEnabled` flag, defaulting to **off**, with one exception: accepting an
invite defaults it **on**, because someone who acted on a personal invitation
has expressed intent. Followers can toggle it per list at any time.

Followed events are rendered alongside the follower's own favorites but are
never merged into them: they carry a source badge naming the list, they do
not become the follower's stars, and unfollowing removes them cleanly and
completely.

### Invite links are capability URLs

Anyone the link is forwarded to can follow. This is the accepted cost of
having no approval inbox and it must be stated plainly in the UI at the
moment of sharing — *"anyone with this link can follow this list"*. The
mitigations are rotation (§8) and the follower roster, not secrecy of the
`listId`.

---

## 5. Data Model

Builds on the accounts spec's two tables **without changing either**.
`${var.app_name}-favorites` remains the storage for the private default list
and keeps its `by-event` popularity GSI; the default list is not represented
in the new tables at all. Three new tables:

### `${var.app_name}-lists`
- Hash key: `listId` (UUID v4, opaque; see the note below on why it is not a
  secret).
- Attributes:
  - `ownerId` — Cognito `sub`.
  - `name` — owner-supplied list name, shown to followers.
  - `ownerDisplayName` — owner-supplied, shown to followers. **Never the
    account email or any Cognito claim** (§9b).
  - `visibility` — `private` | `invite` | `public`.
  - `shareKey` — high-entropy random string (≥128 bits, URL-safe). Present
    for `invite` and `public`; absent for `private`. Rotating writes a new
    value; the old value then resolves to nothing.
  - `featured` — boolean, **admin-writable only**, never settable by the
    owner.
  - `followerCount`, `eventCount` — denormalized counters, best-effort.
  - `createdAt`, `updatedAt`.
- **GSI `by-owner`** — hash `ownerId`: the owner's list of lists.
- **GSI `by-share-key`** — hash `shareKey`: resolves an invite/public link to
  a list. Rotation invalidates old links for free, because the old key is no
  longer in the index.

> `listId` is a primary key, not a bearer token. Access is granted by
> `shareKey` or by an existing membership row — never by knowing a `listId`.

### `${var.app_name}-list-events`
- Hash key: `listId`, range key: `eventId`. One row per event per list.
- Attributes: `{ at: number }`.
- Same per-row shape and last-write-wins semantics the accounts spec already
  uses for personal favorites, so the reconciliation logic is a known
  quantity.
- No `by-event` GSI in this scope: popularity stays a personal-favorites
  question, and counting a public figure's list toward "popularity" would
  conflate one person's broadcast with a thousand individual choices.

### `${var.app_name}-list-members`
- Hash key: `userId`, range key: `listId`. One row per follow.
- Attributes: `{ alertsEnabled: boolean, joinedAt: number, viaShareKey:
  string }` (`viaShareKey` recorded so a rotation can optionally be made to
  cut previously-admitted followers, and for support/debug).
- **GSI `by-list`** — hash `listId`: powers the follower roster, follower
  removal, unpublish revocation, and the account-deletion cascade (§8). This
  GSI is load-bearing for correctness, not just for a UI.

The owner has no membership row; ownership lives on the list row.

---

## 6. API Surface

All routes extend the **existing specced `user_handler` Lambda** and its
`user_lambda_role`, which gains access to the three new tables and their
GSIs. Cognito access tokens are verified in-handler against the pool JWKS,
per the accounts spec's convention. No API Gateway authorizer.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/user/lists` | Owner's lists + the lists they follow, with per-list metadata. |
| `POST` | `/user/lists` | Create a list. |
| `PATCH` | `/user/lists/{listId}` | Rename, change visibility, rotate `shareKey`, unpublish. |
| `DELETE` | `/user/lists/{listId}` | Delete a list (cascades, §8). |
| `PUT`/`DELETE` | `/user/lists/{listId}/events/{eventId}` | Add/remove an event. Owner only. |
| `GET` | `/user/lists/{listId}/followers` | Follower roster. Owner only. |
| `DELETE` | `/user/lists/{listId}/followers/{userId}` | Remove a follower. Owner only. |
| `POST` | `/user/follow` | Body `{ shareKey }`. Creates a membership. Requires sign-in. |
| `DELETE` | `/user/follow/{listId}` | Unfollow. |
| `PATCH` | `/user/follow/{listId}` | Toggle `alertsEnabled`. |
| `GET` | `/user/feed` | The follower read path (§7). |
| `GET` | `/lists/preview/{shareKey}` | **Unauthenticated** read-only preview data (§7). |
| `GET` | `/lists/featured` | **Unauthenticated** admin-curated featured lists. |

**The link an owner copies is a page, not an API route.** Shape:
`https://www.chqcal.org/f/{shareKey}` — a static page (a new Vite entry, per
the multi-page convention) that reads `shareKey` from its path, calls
`GET /lists/preview/{shareKey}`, renders the list, and offers sign-in-to-follow.
The `/f/*` path needs its own CloudFront behavior mapping to that entry.
Short path, because these get read aloud and typed.

Admin takedown (`PATCH` visibility → `private`, clear `featured`) is added to
the **existing admin handler and portal**, not to `user_handler` — it needs
`admin_lambda_role`, and the portal already has the moderation idiom from
publisher approval.

All routes sit under `/user/*` or `/lists/*`, each of which is a single new
CloudFront behavior. `/lists/*` is deliberately unauthenticated-capable and
separate from `/user/*` so no preview request ever carries a token.

---

## 7. Read Path, Preview, and Offline Behavior

### Follower read path

`GET /user/feed` returns the signed-in user's own favorites plus, for each
followed list, its metadata and event IDs. Cost is one `Query` per followed
list on a hash key, bounded by the follow cap in §11. At PAY_PER_REQUEST
pricing with lists of tens of events and a handful of follows, this is
negligible.

**The scaling escape hatch, if a featured list ever gets a large
following:** publish that list's JSON to S3/CloudFront on write, exactly as
`all-events.json` and the sidecars already work, and have followers read the
static object. This is a known, in-house pattern and a drop-in replacement
for the query. It is explicitly **not** in v1 — noted so the v1 choice is
recorded as bounded rather than naive.

### Unauthenticated preview

`GET /lists/preview/{shareKey}` renders a read-only web page: list name,
owner display name, and the events. No account required. This exists so an
invite link is useful the instant it is received, rather than dead-ending at
a sign-in wall.

Consequence, accepted and documented: **an invite link leaks the schedule to
anyone it is forwarded to, with or without an account.** This is already true
of a capability URL — without preview, a recipient would simply sign up to
read it. Preview makes the property visible rather than creating it.
Following (and therefore alerts) still requires sign-in.

### Offline-first

The accounts spec's governing principle carries over unchanged: **the server
is best-effort and the UI never waits on it.**

- **Owner writes** (add/remove event, rename, visibility) go to the server as
  the source of truth, with optimistic local application. A failed write
  reverts the optimistic state and surfaces an inline error — unlike private
  favorites, a silent local-only success would be a lie, because the point is
  that someone else sees it.
- **Followed list contents are a read-only local cache** with a TTL. Offline
  shows the last cached copy, labeled with its age if stale beyond a
  threshold. A failed refresh never blocks the UI and never empties the cache.
- **Signed-out users never fetch any of this**, and the default-list code path
  is unchanged.

---

## 8. Revocation, Cascades, and Lifecycle

These are the correctness core of the feature. Each gets a test (§15).

- **Unpublish** (visibility → `private`): every follower loses read access
  immediately on their next fetch, their cached copy is dropped, and their
  scheduled alerts for that list are cancelled. The list itself and its events
  are preserved for the owner.
- **Rotate `shareKey`:** the old key stops resolving. **Existing followers
  keep access** — they hold membership rows, not links. Rotation stops *new*
  people from joining via a leaked link; removing an existing follower is a
  separate action, and the UI must not conflate the two.
- **Remove a follower:** deletes the membership row; access, cache, and
  alerts end on next sync.
- **Remove an event from a list:** the corresponding follower reminders are
  cancelled on next sync. A followed event that vanishes should not silently
  disappear mid-day from a follower's My Day without explanation — surface it
  the same way a cancelled event is surfaced.
- **Delete a list:** deletes its `list-events` rows and, via the `by-list`
  GSI, every membership row pointing at it.
- **Delete an account** (the accounts spec's `DELETE /user/account`): in
  addition to purging the Cognito user, the `users` row, and the personal
  `favorites` rows, it must delete **every list the user owns** (with the full
  cascade above) **and every membership row where the user is the follower**.
  Nobody is left following a dead list, and no deleted user's name remains on
  anyone's screen.
- **Event no longer exists in the feed** (data churn between seasons): a
  `list-events` row whose `eventId` is absent from the current snapshot is
  skipped on render and on alert planning, never an error.

---

## 9. Safety, Privacy, and Moderation

All four guarantees are **in scope for v1**, not follow-ups.

**(a) Nothing is shared unless explicitly published.** The default list is
private and unshareable by construction (§4). Sharing requires deliberately
creating a *separate* list and choosing a visibility. There is no toggle that
could accidentally expose the set the user already has.

**(b) Chosen display name, never the account identity.** A published list
shows `name` and `ownerDisplayName`, both owner-typed. The account email,
Cognito `sub`, and every other claim are **never** included in any payload a
follower or preview can read. Owners may be effectively pseudonymous. Per
existing project rules, email is never logged.

**(c) Owner control, including a kill switch.** The owner can see who
follows each list, remove any follower, rotate the invite link, and unpublish
in one action that revokes everyone at once. Account deletion cascades (§8).

**(d) Schedules only, never presence.** The feature publishes *intent* —
"this event is on my list". There is no attendance, check-in, live location,
"here now", or last-active concept, and none may be added without revisiting
this document. Followers cannot tell whether the owner actually went, or
whether they have opened the app.

### Moderation

`name` and `ownerDisplayName` are user-generated strings. For `invite` lists
only invitees see them, so reach is inherently small. For `public` lists,
reach is bounded by the absence of any in-app directory (decision 5) — the
owner must promote the link themselves.

- **Admin takedown** is in v1: an admin can force any list to `private` and
  clear `featured` from the existing portal.
- **Featuring is admin-only** and hand-curated, so the one surface the app
  itself amplifies is fully controlled.
- **Impersonation** ("Official Chautauqua Schedule") is possible but
  unamplified. A reserved-substring check on public list names is cheap and
  optional; admin takedown is the backstop. Institution-adjacent naming is a
  judgment call the same portal already makes for publishers.
- **No user-facing reporting flow in v1.** With no directory and no
  amplification, the expected volume does not justify an inbox. Revisit if a
  directory is ever added.

---

## 10. iOS: Alerts and the 60-Notification Cap

`ReminderPlanner.plan(favorites:events:settings:now:)` today takes a single
`Set<String>`, sorts qualifying reminders by `triggerDate`, and truncates to
`maxPending = 60`. Followed lists turn cap overflow from theoretical into
likely: a follower of two active lists plus their own favorites can exceed 60
pending reminders in a busy week.

**Required changes:**

1. **Planner input becomes source-attributed** — favorites plus, per followed
   list with `alertsEnabled`, its event IDs. The function stays pure domain
   logic with no `UNUserNotificationCenter` dependency, consistent with its
   current design.
2. **Truncation precedence becomes explicit and tested.** Today's rule is
   nearest-first across one set. The new rule: **the user's own favorites
   outrank followed-list events**; within each group, nearest `triggerDate`
   first; the followed group is truncated first. Rationale: a user's own
   deliberate star should never be evicted by someone else's list.
3. **Truncation becomes visible.** When the cap bites, the UI says so rather
   than silently dropping reminders. Today's silent truncation is defensible
   for one's own favorites; silently dropping alerts the user opted into for a
   followed list is not.
4. **Notification copy names the source** — a followed-list alert should read
   as "from Ours", not as if the user had starred it.
5. **De-duplication:** an event in both the user's favorites and a followed
   list schedules **one** notification, attributed to the user's own favorite.

**Filter integration:** followed lists become chips in the existing inline
filter facet rows (the pattern from the #151 filtering overhaul), so "show
only Ours" is a filter, not a new navigation concept. The existing
"favorites only" control continues to mean *the user's own stars*.

**App Store note:** the iOS phases require **accounts Phase 2 (Sign in with
Apple), not Phase 1** — App Store login rules require an equivalent Apple
option for an app offering third-party sign-in. Apple IdP and account linking
are a hard gate on the iOS half (§14). Separately, account creation on iOS
requires in-app account deletion, which the accounts spec already designs.

---

## 11. Limits

Bounds on cost and abuse, enforced server-side. The publisher DDB rate
limiter (PR #85) is the precedent.

| Limit | Value | Why |
|---|---|---|
| Lists owned per user | 20 | Bounds `by-owner` fan-out and the UI. |
| Events per list | 300 | Roughly a full season of one person's schedule. |
| Lists followed per user | 10 | Bounds the `/user/feed` query count. |
| Followers per list | soft, monitored | The featured/public case; the trigger to consider the static-JSON path (§7). |
| `shareKey` rotations | rate-limited | Cheap abuse vector against the `by-share-key` GSI. |
| `POST /user/follow` attempts | rate-limited per user | Prevents share-key guessing (already infeasible at ≥128 bits, but cheap to bound). |

---

## 12. Frontend Changes

### Web (P1)

- **Lists UI** — a lists screen: owner's lists with visibility badges and
  follower counts, followed lists with an alerts toggle, and per-list event
  management. The star control keeps writing the default list; adding to
  another list is an explicit "add to list" action.
- **Share sheet** — copy link, QR code, rotate, follower roster, unpublish.
  Carries the capability-URL warning copy (§4).
- **Follow screen** — admin-curated featured lists plus a code entry field
  (decision 5), with no browse-all.
- **Preview page** — an unauthenticated route rendering
  `/lists/preview/{shareKey}`, with a sign-in call to action to follow.
- **`useFavorites` and the sync layer** — the accounts spec already moves
  favorites to per-event records; this design adds the list dimension on top,
  and the default list keeps that hook's existing contract so the calendar's
  star behavior is untouched.

### iOS (P3)

- Lists screen and share sheet mirroring web, using the native share sheet
  for links and QR.
- Followed lists as filter facet chips; source badges in My Day, the event
  list, and event detail.
- `ReminderPlanner` changes per §10; widget and Spotlight surfaces continue to
  reflect the user's own favorites only, unless a later decision says
  otherwise.

### Admin portal (P1)

- List moderation: look up by `listId` or `shareKey`, force-private, feature
  or unfeature.

---

## 13. Deployment (Terraform)

Adds, on top of everything the accounts spec adds:

- Three DynamoDB tables (`-lists`, `-list-events`, `-list-members`) with the
  three GSIs (`by-owner`, `by-share-key`, `by-list`), PITR and SSE, matching
  the publisher tables' configuration.
- `user_lambda_role` policy extension for the new tables and GSIs. It gains
  no admin or publisher privileges.
- `admin_lambda_role` policy extension for the moderation controls.
- One new CloudFront behavior for `/lists/*` (`/user/*` already exists from
  the accounts work).
- Feature flag `VITE_ENABLE_SHARED_LISTS`, following
  `VITE_ENABLE_PUBLISHER_FEEDS` and the accounts spec's
  `VITE_ENABLE_ACCOUNTS`, with a `?lists=1` opt-in param for self-testing
  before exposure.

---

## 14. Phasing

| Phase | Contents | Gated on |
|---|---|---|
| **P0** | Accounts Phase 1: Cognito, Google sign-in, `users` + `favorites` tables, `user_handler`, sync layer. | Existing spec; unbuilt. |
| **P1** | Lists, visibility, invite links, following, preview page, featured surface, admin takedown — **web only**. | P0 |
| **P2** | iOS sign-in (`ASWebAuthenticationSession`), account deletion, sync. | P0 **and accounts Phase 2 (Sign in with Apple + linking)** — see §10. |
| **P3** | iOS lists, following, source badges, filter chips, and **shared-list alerts**. | P2 |

Each phase is independently shippable. Stated plainly: **the headline family
benefit — both phones alerting for the shared concert — does not arrive until
P3**, because notifications and My Day are iOS-only surfaces. P1 delivers
seeing a shared list, which is the "I can always see what activities are
there" half of the original ask.

A secondary benefit worth noting: shared lists driving local notifications
and Watch-mirrored alerts strengthens the iOS-only-capability story that
Guideline 4.2 turned on in 2026-08.

---

## 15. Testing Strategy

Highest-risk logic first, tested before implementation, respecting the
coverage floor (`.coverage-floor.json`, `docs/coverage.md`).

**Access control** — the security core:
- A non-owner cannot write to a list by any route.
- Knowing a `listId` grants nothing without a `shareKey` or a membership.
- A rotated `shareKey` no longer resolves; existing followers retain access.
- A `private` list's `shareKey` resolves to nothing.
- `/lists/preview/{shareKey}` never returns email, `sub`, or any Cognito claim
  (assert on the serialized payload, not the object).

**Revocation and cascades** (§8), each with its own test:
- Unpublish revokes all followers and cancels their alerts.
- Remove-follower revokes exactly one.
- Delete-list removes `list-events` and all memberships.
- Delete-account removes owned lists, their memberships, **and** the user's own
  memberships elsewhere.
- A `list-events` row for an event absent from the snapshot is skipped, not an
  error.

**iOS planner** (§10):
- Own favorites outrank followed events at the cap boundary.
- An event in both a favorite and a followed list yields exactly one
  notification.
- Disabling alerts for one list leaves the other list's alerts intact.
- Unfollowing cancels only that list's pending notifications.

**Sync and offline:**
- Owner write failure reverts optimistic state and surfaces an error.
- Follower refresh failure preserves the last cache and never empties it.
- Signed-out and flag-off paths are byte-for-byte unchanged (the existing
  favorites tests must pass untouched).

**Limits** (§11) are enforced server-side, with a test per limit.

Integration tests join the existing program; the post-deploy smoke test gains
a create → share → follow → unpublish round trip.

---

## 16. Open Questions

Resolve during planning, not now:

1. **Does the web get any alerting at all?** Web Push would move the family
   payoff earlier than P3, at the cost of a permission prompt and a service
   worker path the PWA auto-update work already made delicate. Currently
   assumed **no**.
2. **Do widgets and Spotlight include followed events?** Assumed no in P3;
   worth revisiting once the source-badge treatment exists.
3. **Should a rotation optionally cut existing followers?** `viaShareKey` is
   recorded to make it possible. Assumed no by default — rotation and removal
   stay distinct actions (§8).
4. **Seasonal lifecycle.** Do lists roll over between seasons, archive, or
   expire? Events are season-scoped; a list from 2026 will be entirely dead
   references in 2027. Leaning toward season-scoped lists with an explicit
   archive view.
5. **Reserved-name check for public lists** (§9) — cheap, optional, not yet
   decided.
