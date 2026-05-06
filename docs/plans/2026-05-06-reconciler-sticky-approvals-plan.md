# Reconciler — sticky approvals (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the publisher reconciler from clobbering admin-approved events on subsequent ingest runs by making `state='published'` terminal once reached.

**Architecture:** Single-file fix in `backend/src/services/publisherReconciler.ts`. `toStored` gains an optional `existing` parameter; when the prior stored row was `published`, the rebuilt row preserves `state='published'` regardless of `trustLevel`. The reconcile loop already has the prior row in scope (line 48), so plumbing it through is one extra argument. Two new tests pin the bug; one existing trust-demotion test is rewritten to match the new policy.

**Tech Stack:** TypeScript, Jest, Node 24, DynamoDB Document Client (untouched by this fix).

**Spec:** `docs/plans/2026-05-06-reconciler-sticky-approvals-design.md`

**Branch:** `fix/reconciler-sticky-approvals` (already created off `main`).

---

## Task 1: Add failing test pinning the bug

**Files:**
- Modify: `backend/src/__tests__/publisherReconciler.test.ts`

This task adds the test that captures the reported bug: stored row is `state='published'` (admin-approved), feed re-emits the same event with newer `lastModified`, publisher's `trustLevel` is `'review'`. Today the reconciler emits an update that demotes to `pending`. After the fix it must keep `state='published'`.

- [ ] **Step 1: Add the failing test**

Append to `backend/src/__tests__/publisherReconciler.test.ts` immediately after the existing `'updates stored event when trust-level demotes published → pending'` test (i.e. after line 143, inside the `describe('reconcile', …)` block):

```ts
  it('preserves admin-approved published state across re-ingest with newer lastModified (review trust)', () => {
    const stored = [ev('a', '2026-07-01T00:00:00-04:00', '2026-04-01T00:00:00-04:00', 'published')];
    const r = reconcile({
      stored,
      feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' }]),
      now: NOW,
      trustLevel: 'review',
    });
    expect(r.diff.updates).toHaveLength(1);
    expect(r.diff.updates[0].state).toBe('published');
  });

  it('counts unchanged for an admin-approved event re-emitted with same lastModified (review trust)', () => {
    const stored = [ev('a', '2026-07-01T00:00:00-04:00', '2026-05-01T00:00:00-04:00', 'published')];
    const r = reconcile({
      stored,
      feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' }]),
      now: NOW,
      trustLevel: 'review',
    });
    expect(r.diff.updates).toHaveLength(0);
    expect(r.diff.unchanged).toBe(1);
  });
```

- [ ] **Step 2: Run the new tests and verify they fail in the expected way**

Run from the repo root:

```bash
cd backend && npx jest publisherReconciler --testNamePattern "preserves admin-approved|counts unchanged for an admin-approved"
```

Expected:
- The first new test (`preserves admin-approved...`) **FAILS**: actual `r.diff.updates[0].state` is `'pending'` (current bug).
- The second new test (`counts unchanged for an admin-approved...`) **PASSES** today already, because the `ex.state !== newRec.state` branch fires and pushes the row into `updates`. Wait — re-check this: with `trustLevel='review'` and stored `state='published'`, `newRec.state` is `'pending'`, so `ex.state !== newRec.state` is true and it lands in `updates`, not `unchanged`. So this test **also FAILS** today (`r.diff.updates` is length 1, not 0).

Both failures are expected pre-fix. Do not proceed if either test passes — that means the test is mis-asserting the bug.

- [ ] **Step 3: Commit the failing tests**

```bash
git add backend/src/__tests__/publisherReconciler.test.ts
git commit -m "test(reconciler): pin admin-approval clobber bug (failing)"
```

---

## Task 2: Implement the fix in `toStored` and the reconcile loop

**Files:**
- Modify: `backend/src/services/publisherReconciler.ts:19-60`

The change is two-line:

1. Add an optional `existing?: StoredPublisherEvent` parameter to `toStored`.
2. Compute `state` as: if `existing?.state === 'published'`, keep `'published'`; otherwise the existing rule (`trustLevel === 'auto' ? 'published' : 'pending'`).
3. Pass `ex` (already in scope at line 48) into `toStored` from the reconcile loop.

- [ ] **Step 1: Replace the `toStored` function**

In `backend/src/services/publisherReconciler.ts`, replace the existing `toStored` function (lines 19-35) with:

```ts
function toStored(
  ev: FeedEvent,
  publisher: FeedDocument['publisher'],
  trustLevel: TrustLevel,
  nowIso: string,
  existing?: StoredPublisherEvent,
): StoredPublisherEvent {
  // Once an event reaches state='published' it is terminal. Re-ingest never
  // demotes — admin approvals (state='published' under trustLevel='review')
  // and trust-level changes never push a published row back to pending.
  // The only ways out of 'published' are admin reject (delete) or removal
  // due to feed-absence, both handled outside toStored.
  const state: 'published' | 'pending' =
    existing?.state === 'published'
      ? 'published'
      : trustLevel === 'auto'
        ? 'published'
        : 'pending';
  return {
    publisherId: publisher.id,
    eventId: ev.id,
    startDate: ev.startDate,
    endDate: ev.endDate,
    lastModified: ev.lastModified,
    payload: { ...ev, sourcePublisherId: publisher.id, sourcePublisherName: publisher.name },
    state,
    updatedAt: nowIso,
  };
}
```

- [ ] **Step 2: Pass `ex` through from the reconcile loop**

In the same file, in the `for (const inc of feed.events)` loop (around line 47), change:

```ts
    const newRec = toStored(inc, feed.publisher, trustLevel, nowIso);
```

to:

```ts
    const newRec = toStored(inc, feed.publisher, trustLevel, nowIso, ex);
```

`ex` is already defined on the line above (`const ex = storedById.get(inc.id);`).

- [ ] **Step 3: Run the two new tests and verify they pass**

```bash
cd backend && npx jest publisherReconciler --testNamePattern "preserves admin-approved|counts unchanged for an admin-approved"
```

Expected: both tests **PASS**.

- [ ] **Step 4: Run the entire reconciler test file and identify the broken test**

```bash
cd backend && npx jest publisherReconciler
```

Expected: one failure in `'updates stored event when trust-level demotes published → pending'` (line 133) — under the new policy, demotion no longer demotes already-published events. This is the one test we knew would flip; do not "fix" any other unexpected failures by editing the implementation.

- [ ] **Step 5: Do not commit yet — proceed to Task 3 to update the demotion test**

The implementation change and the demotion-test rewrite belong in one logical commit so the repo never lands in a state where committed code disagrees with committed tests.

---

## Task 3: Rewrite the trust-demotion test to match the new policy

**Files:**
- Modify: `backend/src/__tests__/publisherReconciler.test.ts:133-143`

The existing test asserts the old behavior (demotion re-pends published events). Under the new policy it must assert the inverse: demotion preserves `state='published'`, and because the row's content didn't change, the reconciler should report it as `unchanged`, not `updates`.

- [ ] **Step 1: Replace the demotion test**

In `backend/src/__tests__/publisherReconciler.test.ts`, replace the existing test starting `it('updates stored event when trust-level demotes published → pending', ...)` (line 133) with:

```ts
  it('preserves published state on trust-level demotion (auto → review)', () => {
    const stored = [ev('a', '2026-07-01T00:00:00-04:00', '2026-05-01T00:00:00-04:00', 'published')];
    const r = reconcile({
      stored,
      feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' }]),
      now: NOW,
      trustLevel: 'review',
    });
    expect(r.diff.updates).toHaveLength(0);
    expect(r.diff.unchanged).toBe(1);
  });
```

The test name and intent change; only one expectation block.

- [ ] **Step 2: Run the full reconciler test file and verify all tests pass**

```bash
cd backend && npx jest publisherReconciler
```

Expected: every test **PASSES**, including the original `'updates stored event when trust-level promotes pending → published'` test (Task 2's change does not affect promotion — `existing.state === 'published'` is false for a `pending` row, so the original `trustLevel === 'auto'` branch still fires).

- [ ] **Step 3: Run the full backend test suite to catch unrelated regressions**

```bash
cd backend && npx jest
```

Expected: all tests **PASS**. If anything outside `publisherReconciler.test.ts` fails, stop and investigate — the fix is local to the reconciler and should not affect other suites.

- [ ] **Step 4: Lint**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit the fix together with the rewritten test**

```bash
git add backend/src/services/publisherReconciler.ts backend/src/__tests__/publisherReconciler.test.ts
git commit -m "fix(reconciler): preserve admin-approved state across re-ingest

Once an event reaches state='published' it is terminal. The reconciler
previously rebuilt every row from trustLevel only, so admin approvals on
review-trust publishers reverted to pending whenever the feed's
lastModified advanced. toStored now consults the prior stored row and
preserves state='published' regardless of trustLevel.

Also flips the trust-demotion test: demotion no longer re-pends already-
published events. The only ways out of 'published' remain admin reject
or feed-absence removal."
```

---

## Task 4: Push and open PR

**Files:** none (git/gh only)

- [ ] **Step 1: Push the branch**

```bash
git push -u origin fix/reconciler-sticky-approvals
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "fix(reconciler): preserve admin-approved state across re-ingest" --body "$(cat <<'EOF'
## Summary
- Once an event reaches `state='published'` it is terminal; re-ingest no longer demotes it
- Fixes the reported bug where admin approvals on `trustLevel='review'` publishers reverted to `pending` whenever the feed's `lastModified` advanced
- Trust-level demotion (auto → review/flagged) also no longer re-pends already-published events — admin's decision is durable

Design doc: \`docs/plans/2026-05-06-reconciler-sticky-approvals-design.md\`
Plan: \`docs/plans/2026-05-06-reconciler-sticky-approvals-plan.md\`

## Test plan
- [x] New test: admin-approved event with newer-lastModified re-ingest keeps \`state='published'\` under \`trustLevel='review'\`
- [x] New test: admin-approved event re-emitted with same lastModified counts as \`unchanged\` (no update emitted)
- [x] Rewritten test: trust-demotion (auto → review) preserves \`state='published'\` instead of re-pending
- [x] Full backend jest suite passes
- [x] \`tsc --noEmit\` clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Report PR URL to the user**

Print the PR URL returned by `gh pr create` so the user can review and merge.

---

## Self-review notes (verified before handoff)

- **Spec coverage:** Every section of the design doc maps to a task: policy → Task 2's `toStored` rewrite; tests → Tasks 1 and 3; "no schema change" → no migration task; "out of scope" items → genuinely absent.
- **Placeholder scan:** All code blocks contain literal code; all commands have expected output; no "TBD" / "implement later" / "similar to Task N" shortcuts.
- **Type consistency:** `existing?: StoredPublisherEvent` matches the imported type at line 5 of the source file. The state literal type `'published' | 'pending'` matches `StoredPublisherEvent.state` at `backend/src/types/publisher.ts:77`.
- **Anticipated tripwire:** Step 2 of Task 1 calls out that *both* new tests fail pre-fix (not just the obvious one). This is non-obvious because the second test reads like an "unchanged" case — but `ex.state !== newRec.state` routes it into updates today. Engineer needs the heads-up so they don't think the test is broken.
