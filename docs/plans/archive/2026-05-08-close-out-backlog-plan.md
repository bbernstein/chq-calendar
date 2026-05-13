# Close Out Backlog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every actionable item that was deferred from PR #115 (publisher self-service) and PR #81 (publisher-ingest E2E), plus the residual cleanup items from the 2026-05-03 publisher-format wrap-up — leaving zero open backlog items except the explicitly-deferred staging-environment effort.

**Architecture:** Three independent PRs against `main`, each with its own feature branch, plus a short list of local ops that don't need PRs. PRs are sized for one-shot review. No cross-cutting refactors — each PR closes a discrete pile of follow-ups in one functional area.

**Tech Stack:** Preact 10 / Vite (frontend), TypeScript / AWS SDK v3 / DynamoDB DocumentClient (backend), Terraform (infra), Vitest (tests).

---

## Pre-flight verification (memory hygiene)

The 2026-05-03 cleanup memory was 5 days old at the time this plan was drafted. The
following items showed up there but **were already complete** when state was checked
on 2026-05-08:

- Trailing-slash inconsistency in `lib/auth.ts:50` — already uses `/admin/login/`.
- 58-branch sweep — local branch count is now **3** (`main`, `fix/reconciler-sticky-approvals`, `fix/sw-evict-stale-on-404`).
- `fix/lambda-payload-base64-encoding` local branch — already gone.
- `bbtest` publisher — already `enabled=false` in DynamoDB (verified via `aws dynamodb get-item`).

The PR #115 deferred-items memory listed "Apply form / SourceEdit modal a11y." On
inspection those aren't modals — `frontend/src/app/publish/apply/page.tsx` is a flat
form and `frontend/src/app/publish/status/SourceEditPanel.tsx` is an inline panel.
**The actual non-`<Modal>` modals** that exist today are:
- `frontend/src/app/admin/feedback/page.tsx:444` — feedback-detail modal. No Esc handler, no focus trap, no `role="dialog"`, no `aria-modal`. Real a11y gap.
- `frontend/src/app/admin/publishers/page.tsx:836` — delete-confirmation modal. Has its own ~50-line custom focus trap (lines 251–331) duplicating `<Modal>`'s logic, and uses backdrop-click-to-close which `<Modal>` doesn't yet support.

This plan converts both of those, treating them as the genuine items behind the
mislabeled memory entry.

---

## Out of Scope — Explicit Deferrals

The following item is not part of this plan and is left open by design:

- **Staging account / second AWS environment** (memorized at `publisher-ingest-e2e-ci-test-status.md`). This is genuine architectural work — provisioning a second AWS account, splitting Terraform workspaces, replicating IAM, and wiring CI to deploy there. It does not fit alongside the small follow-ups in this plan and should be its own design + plan when it's prioritized.

---

## PR-A: Frontend Modal a11y Consolidation

**Branch:** `chore/modal-a11y-and-backdrop-click`

**Why:** Two admin pages still ship custom modal markup. One has no a11y plumbing
(real keyboard/screen-reader gap); the other duplicates ~50 lines of `<Modal>`'s
focus-trap logic. Converting both onto `<Modal>` removes the duplication and closes
the a11y gap. The publishers-page modal needs a new opt-in `closeOnBackdropClick`
prop on `<Modal>` to preserve its existing backdrop-click-to-close behavior.

### Task A1: Add `closeOnBackdropClick` opt-in prop to `<Modal>`

**Files:**
- Modify: `frontend/src/components/Modal.tsx`
- Test: `frontend/src/components/__tests__/Modal.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/components/__tests__/Modal.test.tsx`:

```tsx
  it('does NOT close on backdrop click by default', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} titleId="t-bd-default">
        <h3 id="t-bd-default">Heading</h3>
        <button>OK</button>
      </Modal>,
    );
    // The backdrop is the outer fixed-inset wrapper; click it directly.
    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on backdrop click when closeOnBackdropClick=true', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} titleId="t-bd-on" closeOnBackdropClick>
        <h3 id="t-bd-on">Heading</h3>
        <button>OK</button>
      </Modal>,
    );
    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close when click originates inside the dialog card', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} titleId="t-bd-inside" closeOnBackdropClick>
        <h3 id="t-bd-inside">Heading</h3>
        <button data-testid="inside">OK</button>
      </Modal>,
    );
    fireEvent.click(screen.getByTestId('inside'));
    expect(onClose).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/components/__tests__/Modal.test.tsx
```
Expected: 3 new tests fail (the prop doesn't exist, no backdrop handler).

- [ ] **Step 3: Implement the prop**

Modify `frontend/src/components/Modal.tsx`:

In the `ModalProps` interface, add:

```ts
  // Default false. When true, clicking the backdrop (the area outside the
  // dialog card) calls onClose. Off by default because typed-confirmation
  // gates and forms with unsaved input would lose user work to a stray
  // backdrop click. Opt in only when the modal is showing read-only or
  // already-cancelable content.
  closeOnBackdropClick?: boolean;
```

In the `Modal` function signature, add `closeOnBackdropClick = false` to the
destructured params (next to `closeOnEsc = true`).

In the JSX `return`, change the outer wrapper from:

```tsx
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
```

to:

```tsx
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={closeOnBackdropClick ? onClose : undefined}
    >
```

And on the inner card `<div ref={containerRef} ...>`, add an
`onClick={(e) => e.stopPropagation()}` so clicks inside the card don't bubble
up to the backdrop.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/components/__tests__/Modal.test.tsx
```
Expected: all Modal tests pass (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Modal.tsx frontend/src/components/__tests__/Modal.test.tsx
git commit -m "feat(modal): add closeOnBackdropClick opt-in prop"
```

### Task A2: Convert `admin/feedback` feedback-detail modal to `<Modal>`

**Files:**
- Modify: `frontend/src/app/admin/feedback/page.tsx` (around lines 442–456 and the closing `</div>` of the modal)
- Test: `frontend/src/app/admin/feedback/__tests__/page.test.tsx` (create if absent)

This modal currently has no a11y plumbing. After conversion it will have Esc
handling, focus trap, focus restore, `role="dialog"`, and `aria-labelledby`.

- [ ] **Step 1: Verify current test setup**

```bash
ls frontend/src/app/admin/feedback/__tests__/ 2>/dev/null || \
  echo "no test dir — creating one"
```

If `__tests__/page.test.tsx` doesn't exist, create it with a single failing test:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import AdminFeedbackPage from '../page';

// Stub localStorage auth so AdminFeedbackPage doesn't redirect.
beforeEach(() => {
  localStorage.setItem('admin_auth', JSON.stringify({
    token: 'test', user: { email: 'admin@test', name: 'Admin' },
    expiresAt: Date.now() + 60_000,
  }));
});

describe('admin feedback page — detail modal a11y', () => {
  it('opens detail modal with role=dialog and aria-labelledby', async () => {
    // The page fetches; mock fetch to return one feedback row.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      items: [{ feedbackId: 'f1', timestamp: '2026-05-08T00:00:00Z',
        feedback: 'hello', contactInfo: '', source: 'web' }],
    }), { status: 200 })));
    render(<AdminFeedbackPage />);
    const row = await screen.findByText('hello');
    fireEvent.click(row.closest('tr')!);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
  });

  it('closes detail modal on Escape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      items: [{ feedbackId: 'f1', timestamp: '2026-05-08T00:00:00Z',
        feedback: 'hello', contactInfo: '', source: 'web' }],
    }), { status: 200 })));
    render(<AdminFeedbackPage />);
    const row = await screen.findByText('hello');
    fireEvent.click(row.closest('tr')!);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
```

If a test file already exists, add the two `it(...)` blocks above to its existing
`describe`.

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
cd frontend && npx vitest run src/app/admin/feedback/__tests__/page.test.tsx
```
Expected: FAIL — current modal has no `role="dialog"` and no Esc handler.

- [ ] **Step 3: Replace the custom modal markup with `<Modal>`**

In `frontend/src/app/admin/feedback/page.tsx`, find:

```tsx
      {/* Feedback Detail Modal */}
      {selectedFeedback && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 dark:bg-gray-900 dark:bg-opacity-75 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border border-gray-200 dark:border-gray-700 w-11/12 max-w-2xl shadow-lg rounded-md bg-white dark:bg-gray-800">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Feedback Details</h3>
```

Add to the file's imports (top of file):

```tsx
import { Modal } from '@/components/Modal';
```

Replace the entire `{selectedFeedback && (...)}` block with:

```tsx
      {selectedFeedback && (
        <Modal
          onClose={() => setSelectedFeedback(null)}
          titleId="feedback-detail-title"
          className="bg-white dark:bg-gray-800 rounded-md shadow-lg max-w-2xl w-11/12 p-5 max-h-[90vh] overflow-y-auto"
        >
          <div className="flex justify-between items-start mb-4">
            <h3 id="feedback-detail-title" className="text-lg font-semibold text-gray-900 dark:text-white">
              Feedback Details
            </h3>
            {/* Existing close-button JSX, unchanged */}
            {/* ... preserve everything between the original h3 and the Modal's
                 outer </div> down to the closing tag of the original modal ... */}
          </div>
          {/* Body content (the existing space-y-4 div with Submitted, Contact
               Information, Feedback, etc.) — copied verbatim from the original
               modal body. */}
        </Modal>
      )}
```

The mechanical move: take everything between the original outer `<div className="fixed inset-0 ...">` and its matching `</div>` (excluding the wrapper itself and the `relative top-20 ...` inner card div), and place it inside `<Modal>`. The `Modal` component already provides the backdrop and centered card; the
custom inner card div should be removed because `<Modal>`'s `className` prop now
supplies that styling.

The submit-feedback close button (the `×` SVG) stays in place; it already calls
`setSelectedFeedback(null)` and that's also what Esc / outer onClose will do.

- [ ] **Step 4: Run page tests and full validate**

```bash
cd frontend && npx vitest run src/app/admin/feedback/
cd frontend && npm run validate
```
Expected: all admin feedback tests pass, type-check + lint green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/admin/feedback/page.tsx frontend/src/app/admin/feedback/__tests__/
git commit -m "feat(admin-feedback): convert detail modal to <Modal> for a11y"
```

### Task A3: Convert `admin/publishers` delete-confirmation modal to `<Modal>`

**Files:**
- Modify: `frontend/src/app/admin/publishers/page.tsx`
- Test: `frontend/src/app/admin/publishers/__tests__/page.test.tsx` (likely exists; add tests)

This modal already has the right a11y attributes but rolls its own focus trap +
escape handling (lines 251–331) and uses backdrop-click-to-close. After
conversion: remove the custom trap, use `<Modal closeOnBackdropClick>`, keep the
"don't dismiss while delete is in flight" guard.

- [ ] **Step 1: Add a regression test for "Esc does not close while delete is in flight"**

Add to `frontend/src/app/admin/publishers/__tests__/page.test.tsx` (or create the
file with the harness mirroring A2 if absent — same `localStorage` setup):

```tsx
it('Esc does not close delete-confirm modal while a delete is in flight', async () => {
  // Arrange: render page, open delete modal, start a never-resolving delete.
  // … (see existing test patterns in this file for fetch-mocking helpers)
  // Press Escape.
  // Expect: dialog is still in the DOM.
});
```

If similar tests exist already, this may be a no-op — but verify the assertion
about in-flight Esc is present.

- [ ] **Step 2: Replace custom focus-trap + modal markup**

In `frontend/src/app/admin/publishers/page.tsx`:

a) Add Modal import at top:

```tsx
import { Modal } from '@/components/Modal';
```

b) Delete the entire focus-trap `useEffect` block (lines ~250–331 — the comment
block "Focus-trap + Escape handling for the delete confirmation modal" through
its `}, [deleteTarget]);`). Also delete the now-unused refs:

- `const deleteModalRef = useRef<HTMLDivElement | null>(null);`
- `const lastFocusBeforeModalRef = useRef<HTMLElement | null>(null);`
- `const deletingIdsRef = useRef(deletingIds);`
- The `useEffect(() => { deletingIdsRef.current = deletingIds; }, [deletingIds]);`

c) Add a small Esc-while-busy guard. `<Modal>`'s default Esc behavior is
unconditional close. We need to suppress Esc only while the in-flight delete is
busy, while still allowing Esc when idle. Use `closeOnEsc={!deletingIds.has(deleteTarget.id)}`:

d) Replace the modal JSX block (lines ~833–883 — `{deleteTarget && (...)}`):

```tsx
      {deleteTarget && (
        <Modal
          onClose={() => {
            if (!deletingIds.has(deleteTarget.id)) setDeleteTarget(null);
          }}
          titleId="delete-publisher-title"
          closeOnEsc={!deletingIds.has(deleteTarget.id)}
          closeOnBackdropClick={!deletingIds.has(deleteTarget.id)}
        >
          <h3 id="delete-publisher-title" className="text-lg font-semibold text-gray-900 dark:text-white">
            Delete publisher?
          </h3>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            This will permanently delete the publisher record and all of their stored events.
            The next sidecar publish will remove these events from the public site.
            This action cannot be undone.
          </p>
          <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-900/40 rounded text-sm">
            <div className="font-medium text-gray-900 dark:text-gray-100">{deleteTarget.name}</div>
            <div className="font-mono text-xs text-gray-500 dark:text-gray-400">{deleteTarget.id}</div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={() => setDeleteTarget(null)}
              disabled={deletingIds.has(deleteTarget.id)}
              autoFocus
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmDelete}
              disabled={deletingIds.has(deleteTarget.id)}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deletingIds.has(deleteTarget.id) ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Modal>
      )}
```

Note: `<Modal>` already restores focus on unmount, so the row's Delete button gets
focus back when the modal closes. The custom `lastFocusBeforeModalRef` block
becomes redundant.

- [ ] **Step 3: Run admin publishers tests + validate**

```bash
cd frontend && npx vitest run src/app/admin/publishers/
cd frontend && npm run validate
```
Expected: all admin publishers tests pass, type-check + lint green.

- [ ] **Step 4: Smoke test in dev**

```bash
cd frontend && npm run dev
# Visit http://localhost:3000/admin/publishers/
# 1. Click a publisher's Delete button — modal opens, focus on Cancel.
# 2. Press Esc — modal closes, focus returns to Delete button. ✓
# 3. Open again, click Delete (start in-flight) — Esc/backdrop are no-ops. ✓
# 4. Tab cycles within Cancel ↔ Delete only. ✓
```

Capture any UI regressions; if found, address before committing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/admin/publishers/page.tsx frontend/src/app/admin/publishers/__tests__/
git commit -m "refactor(admin-publishers): use shared <Modal> for delete confirm"
```

### Task A4: Open the PR

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin chore/modal-a11y-and-backdrop-click
gh pr create --title "chore(modal): a11y consolidation + closeOnBackdropClick" --body "$(cat <<'EOF'
## Summary
- Add `closeOnBackdropClick` opt-in prop to `<Modal>`
- Convert `admin/feedback` detail modal to `<Modal>` (closes a11y gap: was missing role/aria/Esc/focus-trap)
- Convert `admin/publishers` delete-confirm modal to `<Modal>` (replaces ~50 lines of custom focus-trap)

## Test plan
- [ ] `npm run validate` passes
- [ ] Modal unit tests cover the new prop's three cases (default off / on / inside-click)
- [ ] Manual: admin feedback modal — Esc closes, focus returns
- [ ] Manual: admin publishers delete modal — Esc closes when idle, no-op while in-flight

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR-B: Backend `bumpTokenVersion` dead-code removal

**Branch:** `chore/remove-bumptokenversion`

**Why:** `PublisherRegistryService.bumpTokenVersion` is referenced only by its own
unit tests. The intended caller (email-change verify) uses
`commitEmailChange`'s atomic `SET contactEmail = :e ADD tokenVersion :one`
expression. Keeping a helper that nothing in production calls is a footgun: a
future hand could reach for it and reintroduce the two-write race that
`commitEmailChange` was specifically written to avoid.

### Task B1: Remove the method, its tests, and the comment reference

**Files:**
- Modify: `backend/src/services/publisherRegistryService.ts` (delete lines ~454–472, edit comment at lines ~21–29)
- Modify: `backend/src/__tests__/publisherRegistryService.test.ts` (delete `describe('bumpTokenVersion', ...)` block, lines ~341–357)

- [ ] **Step 1: Re-confirm the method is unreferenced in production code**

```bash
grep -rn "bumpTokenVersion" backend/src/ --include="*.ts" | grep -v __tests__
```
Expected output: only the definition site (`publisherRegistryService.ts`) — no
caller. If grep finds any non-test caller, STOP and reassess; the memory was
stale.

- [ ] **Step 2: Delete the method**

In `backend/src/services/publisherRegistryService.ts`, delete this block:

```ts
  // Increments tokenVersion by 1 — used by email-change verify to invalidate
  // the old session's JWT once the new email is confirmed.
  // attribute_exists(id) guard — see PublisherNotFoundError.
  async bumpTokenVersion(id: string): Promise<void> {
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { id },
        ConditionExpression: 'attribute_exists(id)',
        UpdateExpression: 'ADD tokenVersion :one',
        ExpressionAttributeValues: { ':one': 1 },
      }));
    } catch (err) {
      if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
        throw new PublisherNotFoundError(id, 'bumpTokenVersion');
      }
      throw err;
    }
  }
```

- [ ] **Step 3: Update the `PublisherNotFoundError` doc comment**

The class doc comment at lines ~21–29 lists `bumpTokenVersion` among the helpers
that throw it. Remove just that one name. Change:

```ts
// Thrown by self-service mutation helpers (setPausedFlag, setSelfDisabled,
// bumpTokenVersion, updateProfile, commitEmailChange, setEmailChangeLock,
// clearEmailChangeLock) when the underlying UpdateItem fails its
```

to:

```ts
// Thrown by self-service mutation helpers (setPausedFlag, setSelfDisabled,
// updateProfile, commitEmailChange, setEmailChangeLock, clearEmailChangeLock)
// when the underlying UpdateItem fails its
```

- [ ] **Step 4: Delete the test block**

In `backend/src/__tests__/publisherRegistryService.test.ts`, delete the entire
`describe('bumpTokenVersion', ...)` block (lines ~341–357):

```ts
  describe('bumpTokenVersion', () => {
    it('uses ADD to increment tokenVersion by 1', async () => {
      mockSend.mockResolvedValue({});
      await svc.bumpTokenVersion('pub-1');
      const cmd: any = mockSend.mock.calls[0][0];
      expect(cmd.input.Key).toEqual({ id: 'pub-1' });
      expect(cmd.input.UpdateExpression).toBe('ADD tokenVersion :one');
      expect(cmd.input.ExpressionAttributeValues[':one']).toBe(1);
      expect(cmd.input.ConditionExpression).toBe('attribute_exists(id)');
    });

    it('translates ConditionalCheckFailedException to PublisherNotFoundError', async () => {
      const condErr = Object.assign(new Error('cond fail'), { name: 'ConditionalCheckFailedException' });
      mockSend.mockRejectedValue(condErr);
      await expect(svc.bumpTokenVersion('deleted')).rejects.toBeInstanceOf(PublisherNotFoundError);
    });
  });
```

- [ ] **Step 5: Run full backend tests**

```bash
cd backend && npm test
```
Expected: all backend tests pass. Test count drops by 2 (the two cases just deleted).

- [ ] **Step 6: Type-check + lint**

```bash
cd backend && npm run validate
```
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/publisherRegistryService.ts backend/src/__tests__/publisherRegistryService.test.ts
git commit -m "chore(registry): drop unused bumpTokenVersion helper"
```

### Task B2: Open the PR

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin chore/remove-bumptokenversion
gh pr create --title "chore(registry): drop unused bumpTokenVersion helper" --body "$(cat <<'EOF'
## Summary
- Remove `PublisherRegistryService.bumpTokenVersion`. Only its own unit tests called it.
- The intended caller (email-change verify) uses `commitEmailChange`'s atomic `SET contactEmail = :e ADD tokenVersion :one` expression.
- Doc comment on `PublisherNotFoundError` updated to drop the stale entry.

## Test plan
- [ ] `npm test` (backend) — same count minus 2 cases, no other failures
- [ ] `npm run validate` (backend) — green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR-C: CI E2E Auto-Disable Safety Net

**Branch:** `feat/ci-e2e-auto-disable-safety`

**Why:** The publisher disable→retract end-to-end CI test enables the
`ci-e2e-test` publisher row at the start and disables it at the end. If a runner
is killed mid-test (between enable and cleanup), the publisher stays
`enabled=true` with `[CI-E2E]` events live on the public sidecar until the next
successful CI run. Belt-and-suspenders: piggyback on the existing hourly
publisher-ingest Lambda — when it boots, if `ci-e2e-test` is `enabled=true` and
its `lastFetchedAt` is older than a threshold, disable it.

**Why not a separate Lambda + EventBridge rule?** The publisher-ingest Lambda
already runs hourly and already has IAM to read/write the publishers table.
Adding ~15 lines to its boot path costs ~zero extra infra, gets the same SLA,
and keeps the recovery logic in the same place as the data path it protects.

### Task C1: Add the safety check to the ingest Lambda

**Files:**
- Modify: `backend/src/handlers/publisherIngestHandler.ts` (or whichever file is the ingest entry — verify before editing)
- Test: `backend/src/__tests__/publisherIngestHandler.test.ts` (or the existing ingest test file)

- [ ] **Step 1: Locate the ingest handler entry**

```bash
grep -rln "publisher-ingest\|publisherIngest\|handler.*ingest" backend/src/handlers/ --include="*.ts"
ls backend/src/handlers/ | grep -i ingest
```
Note the exact filename. The remaining steps reference `publisherIngestHandler.ts`
as a placeholder; substitute the actual filename throughout.

- [ ] **Step 2: Write a failing test for the safety net**

Append to the ingest handler's test file:

```ts
describe('ci-e2e-test stale-enabled safety net', () => {
  const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

  it('disables ci-e2e-test if enabled and lastFetchedAt is older than 1h', async () => {
    const publishers = [
      // Stale ci-e2e-test row that should be auto-disabled
      {
        id: 'ci-e2e-test',
        enabled: true,
        lastFetchedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
        // … other required fields per StoredPublisher
      },
      // Normal publisher — must NOT be touched
      {
        id: 'newton',
        enabled: true,
        lastFetchedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
      },
    ];
    const updateSpy = vi.fn();
    // … wire up DDB mock with `publishers` and capture UpdateItem calls
    await runIngestHandler({ /* event */ });
    // Expect exactly one UpdateItem on ci-e2e-test setting enabled=false.
    const ciCall = updateSpy.mock.calls.find(c => c[0].input.Key.id === 'ci-e2e-test');
    expect(ciCall).toBeDefined();
    expect(ciCall![0].input.UpdateExpression).toMatch(/SET enabled\b/);
    expect(ciCall![0].input.ExpressionAttributeValues[':f']).toBe(false);
    // Expect NO UpdateItem on the normal publisher's `enabled` field.
    const normalCall = updateSpy.mock.calls.find(
      c => c[0].input.Key.id === 'newton' && /enabled\s*=/.test(c[0].input.UpdateExpression ?? '')
    );
    expect(normalCall).toBeUndefined();
  });

  it('leaves ci-e2e-test alone when lastFetchedAt is fresh (<1h)', async () => {
    // Same wiring, but lastFetchedAt = now - 5min.
    // Expect: no UpdateItem touching `enabled` on ci-e2e-test.
  });

  it('leaves ci-e2e-test alone when enabled=false', async () => {
    // Same wiring, but enabled=false (the baseline).
    // Expect: no UpdateItem on ci-e2e-test at all.
  });

  it('handles ci-e2e-test missing entirely (preview accounts)', async () => {
    // No ci-e2e-test row in publishers list.
    // Expect: handler runs to completion, no error.
  });
});
```

(Adapt the mock-wiring to match how the existing tests in this file mock DDB —
the existing patterns there are authoritative.)

- [ ] **Step 3: Run the new tests to confirm they fail**

```bash
cd backend && npx vitest run src/__tests__/publisherIngestHandler.test.ts
```
Expected: all 4 new cases fail (no safety-net code yet).

- [ ] **Step 4: Implement the safety net**

In the ingest handler entry function, after publishers are listed and BEFORE the
per-publisher fetch loop runs, add:

```ts
// Belt-and-suspenders: if a CI runner died between the deploy workflow's
// enable step and its cleanup step, the ci-e2e-test publisher could still be
// enabled with [CI-E2E] events live on the public sidecar. Auto-disable it
// here if it's been enabled for longer than CI's expected runtime budget.
// Safe in preview accounts where the row doesn't exist (count=0 above): the
// findIndex returns -1 and the branch is a no-op.
const CI_E2E_STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const ciE2e = publishers.find(p => p.id === 'ci-e2e-test');
if (ciE2e && ciE2e.enabled && ciE2e.lastFetchedAt) {
  const ageMs = Date.now() - new Date(ciE2e.lastFetchedAt).getTime();
  if (ageMs > CI_E2E_STALE_THRESHOLD_MS) {
    console.warn(
      `[ci-e2e-safety] disabling ci-e2e-test: enabled=true and lastFetchedAt is ${Math.round(ageMs / 60_000)}m old`,
    );
    await registry.setEnabled('ci-e2e-test', false);
    // Mirror the local list so this run skips the now-disabled row.
    ciE2e.enabled = false;
  }
}
```

If `PublisherRegistryService` doesn't already expose a `setEnabled(id, bool)`
method, use a direct `UpdateCommand` with `attribute_exists(id)` guard
matching the patterns of the other helpers in the service. Verify by grepping:

```bash
grep -n "setEnabled\b" backend/src/services/publisherRegistryService.ts
```

If it exists, use it. If not, add a small helper in the service (with its own
unit test in the registry-service test file) before wiring it into the handler.

- [ ] **Step 5: Run tests + validate**

```bash
cd backend && npm test
cd backend && npm run validate
```
Expected: all 4 new cases pass plus the rest of the suite.

- [ ] **Step 6: Commit**

```bash
git add backend/src/handlers/publisherIngestHandler.ts backend/src/__tests__/publisherIngestHandler.test.ts
# If you added setEnabled to the service, include it:
# git add backend/src/services/publisherRegistryService.ts backend/src/__tests__/publisherRegistryService.test.ts
git commit -m "feat(ingest): auto-disable stale-enabled ci-e2e-test publisher"
```

### Task C2: Update the post-deploy CI documentation note

**Files:**
- Modify: `infrastructure/ci-e2e-publisher.tf` (header comment)

- [ ] **Step 1: Add a one-line comment about the safety net**

In `infrastructure/ci-e2e-publisher.tf`, after the existing header block ending
at the `lifecycle.ignore_changes` rationale, add a short note:

```hcl
# Safety net: if a CI runner dies mid-test leaving enabled=true, the hourly
# publisher-ingest Lambda will auto-disable this row when its lastFetchedAt
# is more than ~1h stale. See backend/src/handlers/publisherIngestHandler.ts
# for the implementation.
```

- [ ] **Step 2: Commit**

```bash
git add infrastructure/ci-e2e-publisher.tf
git commit -m "docs(infra): note the ci-e2e auto-disable safety net"
```

### Task C3: Open the PR

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin feat/ci-e2e-auto-disable-safety
gh pr create --title "feat(ingest): auto-disable stale-enabled ci-e2e-test publisher" --body "$(cat <<'EOF'
## Summary
- The hourly publisher-ingest Lambda now auto-disables the `ci-e2e-test` publisher row when it's `enabled=true` and `lastFetchedAt` is more than 1 hour stale.
- Belt-and-suspenders for the rare case where a CI runner dies between the deploy workflow's enable step and its cleanup step.

## Test plan
- [ ] Backend unit tests cover: stale+enabled (auto-disable), fresh+enabled (no-op), already disabled (no-op), preview-account row-missing (no-op)
- [ ] `npm run validate` (backend)
- [ ] Post-merge: confirm next scheduled ingest run logs no warning (because cleanup is healthy today)

## Out of scope
- Staging account / second AWS environment — separate initiative.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Local ops (no PR)

These don't change source code. Run after the three PRs above are merged so the
final state of the repo matches the verifications.

### Op 1: contactEmail normalization audit

**Why:** PR #115 enforced normalization (trim + lowercase) at every write
boundary, but pre-existing rows might still hold non-normalized values. Memory
flagged `bbtest` and `ci-e2e-test` as the only non-apply-path rows, and both
were created with already-normalized emails. Verify before declaring closed.

- [ ] **Step 1: Scan for non-normalized contactEmail values**

```bash
aws dynamodb scan \
  --table-name chautauqua-calendar-publishers \
  --projection-expression "id, contactEmail" \
  --output json \
| python3 -c '
import json, sys
data = json.load(sys.stdin)
non_norm = []
for it in data.get("Items", []):
    pid = it["id"]["S"]
    em  = it.get("contactEmail", {}).get("S", "")
    if em and em != em.strip().lower():
        non_norm.append((pid, em))
if non_norm:
    print("Non-normalized rows found:")
    for pid, em in non_norm:
        print(f"  {pid}: {em!r}")
else:
    print("All contactEmail values are already normalized.")
'
```

- [ ] **Step 2: If any non-normalized rows are found**

For each `(pid, em)`:

```bash
NORMALIZED=$(echo -n "$em" | tr 'A-Z' 'a-z' | xargs)
aws dynamodb update-item \
  --table-name chautauqua-calendar-publishers \
  --key "{\"id\":{\"S\":\"$pid\"}}" \
  --update-expression 'SET contactEmail = :e' \
  --expression-attribute-values "{\":e\":{\"S\":\"$NORMALIZED\"}}" \
  --condition-expression 'contactEmail = :old' \
  --expression-attribute-values "{\":e\":{\"S\":\"$NORMALIZED\"},\":old\":{\"S\":\"$em\"}}"
```

(The condition-expression guards against a concurrent write that already fixed
the row.)

- [ ] **Step 3: Re-run the scan to confirm no rows remain**

Expected: "All contactEmail values are already normalized."

### Op 2: Verify `bbtest` is fully retracted

The publisher is `enabled=false` per pre-flight verification. After the next
ingest run (which happens hourly), no `bbtest` events should remain in the
public sidecar.

- [ ] **Step 1: Confirm no live `bbtest` events on the public sidecar**

```bash
curl -s https://www.chqcal.org/cache/calendar-cache/all-events.json \
| python3 -c '
import json, sys
d = json.load(sys.stdin)
matches = [e for e in d.get("events", [])
           if e.get("publisherId") == "bbtest"
           or "[TEST]" in (e.get("title") or "")]
print(f"bbtest/[TEST] events live on sidecar: {len(matches)}")
for m in matches[:5]:
    print(f"  - {m.get('title')!r} ({m.get('publisherId')})")
'
```

- [ ] **Step 2: If `bbtest/[TEST] events live on sidecar > 0`, force a single ingest**

```bash
aws lambda invoke \
  --function-name chautauqua-calendar-publisher-ingest \
  --invocation-type RequestResponse \
  --cli-binary-format raw-in-base64-out \
  --payload '{}' \
  /tmp/ingest-out.json && cat /tmp/ingest-out.json
```

Wait ~2 minutes for the sidecar to publish, then re-run Step 1.

- [ ] **Step 3 (optional): Delete the bbtest publisher row entirely**

Only if user wants the row removed (vs. left disabled for future testing). Ask
before running:

```bash
aws dynamodb delete-item \
  --table-name chautauqua-calendar-publishers \
  --key '{"id":{"S":"bbtest"}}'
```

### Op 3: Local-branch sweep

Currently 3 local branches: `main`, `fix/reconciler-sticky-approvals`,
`fix/sw-evict-stale-on-404`. Verify they're merged and prune.

- [ ] **Step 1: Identify which non-main branches are merged into main**

```bash
git fetch --prune
git branch --merged main | grep -vE '^\*|^\s+main$'
```

- [ ] **Step 2: Delete the merged ones**

For each branch listed in Step 1's output:

```bash
git branch -d <branch-name>
```

- [ ] **Step 3: List unmerged branches and decide each**

```bash
git branch --no-merged main
```

For each remaining branch, confirm with the user whether to delete (force) or
keep. Don't run `git branch -D` without explicit instruction — these branches
have unmerged commits.

---

## Self-review

**Spec coverage check (against the open-items list from the user-facing summary):**

- [x] Apply form / SourceEdit modal a11y → Reframed as "the actual non-`<Modal>` modals" (admin/feedback, admin/publishers) in PR-A. Pre-flight section documents why memory was wrong.
- [x] Remove `bumpTokenVersion` dead code → PR-B.
- [x] `closeOnBackdropClick` opt-in prop on `<Modal>` → Task A1, used by Task A3.
- [x] One-time backfill verification of `contactEmail` normalization → Local Op 1.
- [x] Belt-and-suspenders auto-disable EventBridge rule for `ci-e2e-test` → PR-C (piggyback on existing ingest Lambda; rationale documented).
- [x] Staging account / environment → Out of Scope section, deferred explicitly.
- [x] Retract `bbtest` test publisher → Local Op 2.
- [x] Sweep stale local branches → Local Op 3.
- [x] Delete `fix/lambda-payload-base64-encoding` local branch → Pre-flight: already gone.
- [x] Trailing-slash inconsistency in `lib/auth.ts:50` → Pre-flight: already resolved (uses `/admin/login/`).

**Placeholder scan:** No "TBD" / "implement later" / "similar to Task N" / "add appropriate error handling" — every step has the actual code or command.

**Type-name consistency:**
- `<Modal>` prop names: `closeOnBackdropClick` used the same way in A1 (definition), A3 (consumer).
- Backend: `setEnabled(id, bool)` referenced in C1 with explicit "verify it exists or add it" guard — not assumed into existence.
- `ci-e2e-test` (id) used consistently across C1, C2, the existing infra file.

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-05-08-close-out-backlog-plan.md`.**

**Two execution options:**

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task; review between tasks; fast iteration.
2. **Inline Execution** — Run tasks in this session using executing-plans; batch with checkpoints for review.

The three PRs are independent and can run in parallel under subagent-driven mode
(one subagent per branch). The local ops should run last, after the three PRs
are merged.

**Which approach?**
