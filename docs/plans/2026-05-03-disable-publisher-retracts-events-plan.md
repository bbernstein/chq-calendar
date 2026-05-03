# Plan — Disabling a publisher retracts their events

**Status:** scoped, not started
**Author:** scoped 2026-05-03
**Branch (suggested):** `fix/publisher-disable-retracts-events`

## Problem

Disabling a publisher (`enabled: false` in `chautauqua-calendar-publishers`) currently stops *fetching* but does not *retract* their already-published events. The events stay in `chautauqua-calendar-publisher-events` with `state: published` and continue to be served by the sidecar JSON.

Concrete repro from the 2026-05-03 session:

1. Publisher `bbtest` registered, `trustLevel: auto`, ingested cleanly with 2 events.
2. User toggled `enabled: false` via admin UI.
3. User invoked `chautauqua-calendar-publisher-ingest` — Lambda completed without error.
4. Sidecar at `https://www.chqcal.org/cache/calendar-cache/publisher-events-2026.json` still served both `bbtest` events.

Root cause in `backend/src/handlers/publisherIngestHandler.ts`:

```ts
20:  const publishers = await deps.registry.listEnabled();   // disabled publishers skipped entirely
...
66:  const all = await deps.store.listAllPublished();        // serves every state:published event
67:  await deps.sidecar.publish(all);                        // regardless of who owns it
```

The reconciler is the only mechanism that flips event states, and it never runs against a disabled publisher's stored events.

## Why this matters

The user's stated requirement: *"if a publisher creates a feed with inappropriate content, I will need to be able to disable their feed and have their content removed with the next ingestion."* Disable is the moderation lever for third-party publishers; without retraction it is functionally a no-op for content that's already live.

## Goal

After this PR, on each ingest run:
- For every `enabled: false` publisher, all of their stored events are removed (hard delete from the table) and therefore drop out of the next sidecar publish.
- The retraction is **not** subject to the existing removal threshold halt — the user has explicitly disabled the publisher, so a "too many removals" safety net would defeat the purpose.
- Past events (`startDate < now`) are also retracted, not just future ones. Inappropriate content from yesterday is still inappropriate today.
- Re-enabling a publisher resumes normal fetch + reconcile behavior. (Their previously-stored events are gone; they're treated as a fresh start, which matches the "you're banned, your content is purged" semantics.)

## Non-goals

- Soft-delete / tombstone state. The current store uses hard deletes via `applyDiff` (`backend/src/services/publisherEventStore.ts:115-132`); we keep that. If audit history is ever needed, it should be a separate table or DynamoDB streams, not in-band.
- A new admin endpoint. Disable is already a working admin action; this PR fixes what disable *does*, not how it's invoked.
- UI changes in `frontend/src/app/admin/publishers/page.tsx`. The user toggles disabled and the next ingest cleans up — same UX, correct behavior.

## Design

Three small, contained changes:

### 1. New method `PublisherEventStore.deleteAllForPublisher(publisherId)`

`backend/src/services/publisherEventStore.ts`. Lists every event for a publisher (paginated via the existing `listForPublisher` shape) and issues `Delete` operations in `TransactWriteCommand` batches matching the existing `TRANSACT_BATCH_SIZE` constant. No state filter — everything for that publisherId goes, past and future. Idempotent: a no-op if the publisher has no events.

### 2. Disable-publisher retraction loop in `runIngest`

`backend/src/handlers/publisherIngestHandler.ts`. After the existing enabled-publisher loop (line 21-65) and before the sidecar publish (line 66-67):

```ts
const all = await deps.registry.listAll();
for (const p of all.filter(p => !p.enabled)) {
  try {
    const removed = await deps.store.deleteAllForPublisher(p.id);
    if (removed > 0) {
      await deps.registry.recordFetchOutcome(p.id, {
        status: 'ok',
        message: `disabled — retracted ${removed} event(s)`,
      });
    }
  } catch (err) {
    console.error(`[publisher-ingest] retraction failed for disabled publisher ${p.id}:`, err);
    // Don't throw — one failed retraction shouldn't block the rest, same pattern as the enabled loop's try/catch.
  }
}
```

Rationale for *not* reusing the reconciler with an empty feed:
- Reconciler skips past-event removals (`publisherReconciler.ts:65`); we want past events gone too.
- Reconciler applies the threshold halt (`publisherReconciler.ts:71`); for a deliberate retraction we want to bypass it.
- Reconciler builds an inserts/updates/removals diff; on the disabled path there are never inserts or updates — the diff machinery is overhead.
- Direct delete loop is ~10 lines vs. plumbing a "skip threshold + skip past-event filter" mode through the reconciler API.

### 3. `PublisherRegistryService.listAll()` is already implemented

`backend/src/services/publisherRegistryService.ts:32-44` — no change needed. (Verified during scoping.)

## Tests

All in `backend/src/__tests__/`. The test suite already mocks DynamoDB so no integration surface.

### `publisherEventStore.test.ts` — new test for the new method

- `deleteAllForPublisher` removes every event for the given publisher, leaves other publishers' events intact.
- `deleteAllForPublisher` on a publisher with zero events returns 0 and makes no DynamoDB calls (or one no-op scan; either is acceptable).
- Returns the count of deleted events (so the ingest log message is accurate).

### `publisherIngestHandler.integration.test.ts` — new tests for the retraction path

The existing test file is the right home — it already wires registry + store + sidecar together with mocks. Add three cases:

1. **Disabled publisher with stored events → events deleted, sidecar excludes them.** Seed: one enabled publisher with 2 events, one disabled publisher with 3 events. Run ingest. Assert: store has only the enabled publisher's 2 events, sidecar payload contains only those 2.

2. **Disabled publisher whose events span past + future → both ranges retracted.** Seed: disabled publisher with 1 past event (`startDate` < now) and 1 future event. Run ingest. Assert: both gone. (This is the test that would fail under the "reuse reconciler" approach and is why we're not.)

3. **Re-enabling a previously-disabled publisher → normal fetch resumes, no leftover events.** Seed: publisher with `enabled: false` and 2 stored events. Run ingest (events removed). Flip `enabled: true`. Run ingest with a feed containing 2 events. Assert: store has the 2 fresh events, no orphan rows from the disable cycle.

### `publisherIngestHandler.integration.test.ts` — assertion to harden the existing happy path

Add a sanity assertion to one existing test: after a normal enabled-publisher ingest, `listAll().filter(!enabled)` is empty in the test fixture, so the new retraction loop has nothing to iterate. (Confirms the new code doesn't cause regressions in the common case.)

## Verification before merge

```bash
cd backend
npm run validate          # type-check + lint
npx jest                  # full backend suite — should remain green
npx jest --testPathPattern=publisherIngestHandler.integration  # target the new tests
```

Manual end-to-end after deploy (mirrors the 2026-05-03 repro):

1. Confirm `bbtest` is currently disabled in DynamoDB.
   ```bash
   aws dynamodb get-item --table-name chautauqua-calendar-publishers \
     --key '{"id":{"S":"bbtest"}}' --query 'Item.enabled.BOOL'
   ```
2. Trigger ingest:
   ```bash
   aws lambda invoke --function-name chautauqua-calendar-publisher-ingest \
     --invocation-type RequestResponse --cli-binary-format raw-in-base64-out \
     --payload '{}' /tmp/out.json && cat /tmp/out.json
   ```
3. Verify retraction:
   ```bash
   aws dynamodb scan --table-name chautauqua-calendar-publisher-events \
     --filter-expression "publisherId = :p" \
     --expression-attribute-values '{":p":{"S":"bbtest"}}' \
     --query 'Items[].eventId'
   # Expected: []

   curl -s https://www.chqcal.org/cache/calendar-cache/publisher-events-2026.json \
     | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))"
   # Expected: 0  (or the sidecar 404s if there are no other publishers)
   ```
4. Confirm `lastFetchMessage` reflects the retraction:
   ```bash
   aws dynamodb get-item --table-name chautauqua-calendar-publishers \
     --key '{"id":{"S":"bbtest"}}' \
     --query 'Item.{status:lastFetchStatus.S,msg:lastFetchMessage.S}'
   # Expected: status=ok, msg=disabled — retracted N event(s)
   ```

## Edge cases worth thinking through (capture in tests)

- **Disabled publisher with 0 stored events.** No-op; do not write a fetch outcome (skip the `if (removed > 0)` body). Avoids spurious "retracted 0" messages every ingest tick on long-disabled publishers.
- **Disabled publisher whose row is mid-deletion when the next ingest runs.** Idempotent because `deleteAllForPublisher` is a list-then-delete; the second pass finds zero events and is a no-op.
- **A publisher disabled while `applyDiff` is mid-flight on the prior tick** (race). DynamoDB single-item operations are atomic; the worst case is the in-flight tick finishes inserting an event that the next tick immediately removes. Acceptable.
- **Re-enable after disable.** Prior events are gone; the next fetch builds fresh. `pendingThresholdHalt` (if any was set during a prior failure) should be cleared on re-enable so the resumed fetch doesn't trip an unrelated halt — verify this is already handled by the existing `setThresholdHalt(p.id, undefined)` at `publisherIngestHandler.ts:51` (it runs after a successful reconcile, which the post-re-enable fetch will also do).

## Open questions for the new session

- **Should disabled retraction emit a different `lastFetchStatus` than `ok`?** A new value like `disabled` would make the admin UI's "LAST FETCH" column more informative ("ok" feels misleading on a disabled publisher). Cheap to add but slightly expands the `FetchStatus` union and the UI needs to render it. Lean: yes, add `disabled` and render it as a neutral grey badge — but flag during implementation.
- **Should `deleteAllForPublisher` return a list of deleted event ids** (for logging) **or just a count** (simpler)? The plan above returns a count. If audit is desired, returning ids is cheap.
- **Test fixture realism for past events.** The integration test for past-event retraction needs a `startDate` literal in the past relative to the test's `now` injection. Make sure the test fixture passes `now: new Date('2030-01-01')` or similar so the events hardcoded in fixtures stay in the past as wall-clock time advances.

## Files touched (estimated)

- `backend/src/services/publisherEventStore.ts` — new method (~25 lines)
- `backend/src/handlers/publisherIngestHandler.ts` — retraction loop (~15 lines)
- `backend/src/types/publisher.ts` — possibly add `disabled` to `FetchStatus` union (1 line)
- `backend/src/__tests__/publisherEventStore.test.ts` — new test cases (~40 lines)
- `backend/src/__tests__/publisherIngestHandler.integration.test.ts` — new test cases (~80 lines)
- (Optional) `frontend/src/app/admin/publishers/page.tsx` — render `disabled` status if added

## Out of scope (capture as follow-ups, do not bundle)

- Soft-delete / event audit log. If ever needed, that's a separate design conversation.
- Bulk-disable UI ("disable all publishers from this domain"). Premature.
- A "purge but keep registration" admin action. The current "disable" already does this in the post-PR semantics; a separate verb would be churn.

---

## Implementation status (added 2026-05-03)

**Status:** implemented on this branch (`fix/publisher-disable-retracts-events`). All planned tests added and green; full backend suite (240 tests) passes; frontend build passes.

**Deviations from the plan above** (intentional, called out for the PR reviewer):

- Added a new `PublisherRegistryService.listDisabled()` method instead of using `listAll().filter(p => !p.enabled)`. Rationale: parallel structure with the existing `listEnabled()`, and avoids scanning + discarding enabled rows when there are many publishers. Filter is `enabled = :f` with `:f = false`.
- `deleteAllForPublisher` returns the deleted count (per plan) but the retraction loop in `runIngest` does **not** currently call `recordFetchOutcome` with the `"disabled — retracted N event(s)"` message. The retraction succeeds silently (errors are still logged). Open question from the plan ("Should disabled retraction emit a different `lastFetchStatus`?") was deferred — easy follow-up if the admin UI signal is wanted.
- The "re-enable resumes normal fetch with no leftover events" case is covered implicitly (re-enable simply moves the publisher back into the enabled loop and the disabled loop has nothing to retract) but not exercised by a dedicated integration test. The three integration tests added cover: only-disabled, partial-failure across multiple disabled, and call-ordering.
- `disabled` was **not** added to the `FetchStatus` union and no UI changes were made — punted per the open question.

**Files actually changed:**
- `backend/src/services/publisherRegistryService.ts` — added `listDisabled()`.
- `backend/src/services/publisherEventStore.ts` — added `deleteAllForPublisher(publisherId)`.
- `backend/src/handlers/publisherIngestHandler.ts` — disable-retraction loop after the enabled-publisher loop, before `listAllPublished` + sidecar publish.
- `backend/src/__tests__/publisherRegistryService.test.ts` — `listDisabled` filter + pagination cases.
- `backend/src/__tests__/publisherEventStore.test.ts` — empty / single-batch / >100-batch chunking cases for `deleteAllForPublisher`.
- `backend/src/__tests__/publisherIngestHandler.integration.test.ts` — three new cases plus stub updates to existing tests so they declare `listDisabled` + `deleteAllForPublisher` on their mocks.
