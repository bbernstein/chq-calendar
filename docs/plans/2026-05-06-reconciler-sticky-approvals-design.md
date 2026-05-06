# Reconciler — sticky approvals (design)

**Date:** 2026-05-06
**Status:** Approved, ready for implementation plan
**Origin bug:** `bug-review-status-clobbered-on-ingest` — admin-approved events for review-trust publishers revert to `pending` on the next ingest run whenever the feed's `lastModified` advances.

## Problem

`backend/src/services/publisherReconciler.ts:19-35` (`toStored`) rebuilds a `StoredPublisherEvent` purely from the publisher's current `trustLevel`:

```ts
state: trustLevel === 'auto' ? 'published' : 'pending',
```

The reconcile loop calls `toStored` for every incoming feed event and emits the rebuilt row as an update whenever `lastModified` advances or the computed `state` differs from what's stored. `applyDiff` then writes that row via `Put`, clobbering any admin-applied `state='published'`.

For a publisher with `trustLevel='review'`, this fires on essentially every ingest cycle (most upstream feeds bump `lastModified` on each poll), so admin approvals evaporate within an hour.

## Policy

**Once an event reaches `state='published'`, it is terminal.**

The only ways for an event to leave `published`:

- Admin hard-reject via `rejectEvent` (deletes the row).
- Removal because the event is absent from the feed and is in the future — already handled by the reconciler's removal pass and removal-threshold guard.

Re-ingest never demotes. `trustLevel` changes never demote already-published events. Content drift (title/description edits) rides through silently in `payload`; if a previously-approved event becomes spammy after edit, admins reject it.

This matches the semantics already encoded in `publisherEventStore.approveEvent`, which only fires from `state='pending'` and has no inverse "auto-revert" path.

## Change

### Code

`backend/src/services/publisherReconciler.ts`

- Add an optional `existing?: StoredPublisherEvent` parameter to `toStored`.
- When `existing?.state === 'published'`, the rebuilt row preserves `state='published'` regardless of `trustLevel`. Otherwise behavior is unchanged: `trustLevel === 'auto' ? 'published' : 'pending'`.
- The reconcile loop already looks up `ex = storedById.get(inc.id)` (line 48); pass it through to `toStored`.

No schema change. No migration. `StoredPublisherEvent.state` stays `'published' | 'pending'`.

### Tests

`backend/src/__tests__/publisherReconciler.test.ts`

- **New test (pins the bug):** stored event has `state='published'`, feed re-emits the event with newer `lastModified`, `trustLevel='review'`. Expect the update to keep `state='published'`.
- **New test:** stored event has `state='published'`, feed re-emits it unchanged, `trustLevel='review'`. Expect `unchanged` count to increment (no update emitted).
- **Updated test (line 133, "demotes published → pending"):** flip the assertion. Under the new policy, trust-level demotion does **not** revert published events. Either rename to "preserves published across trust-level demotion" or delete and add the inverse expectation.
- **Untouched:** the promotion test at line 121 (`pending → published` on trust upgrade) remains valid.

## Edge cases — confirmed

| Scenario | Behavior |
|---|---|
| Trust-level promotion (review → auto) on a `pending` row | Upgrades to `published`. Unchanged. |
| Trust-level demotion (auto → review/flagged) on a `published` row | Stays `published`. **Changed.** |
| Re-ingest of approved event with newer `lastModified` | Stays `published`; `payload` rewritten. **Bug fixed.** |
| Re-ingest of approved event with title/description edit | Stays `published`; new payload silently rides through. Admin rejects if needed. |
| New event from `review`-trust publisher | Inserted as `pending`. Unchanged. |
| Admin reject of a `pending` row | Deletes the row. Unchanged. |
| Mass-removal protection | 50%/5 threshold guard untouched. |

## Out of scope

- No `approvedBy` / `approvedAt` audit field. Clean follow-up if the admin dashboard ever needs to surface approval provenance.
- No re-pending on content diff. The simpler "approval is durable" semantics is what we're shipping; content-aware re-review can be layered later if a real abuse case appears.
- No change to `applyDiff`, `approveEvent`, or `rejectEvent`. The fix is local to the reconciler.
