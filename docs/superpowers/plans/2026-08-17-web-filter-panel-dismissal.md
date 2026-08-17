# Filter panel dismissal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the revealed filter panel behave the way it already looks — a scroll gesture dismisses it, animated, and only the Filters control brings it back.

**Architecture:** Four separable pieces. A gesture-detection hook decides *when* to dismiss, keying off user input events and never `scroll`. An exit animation removes the panel from flow immediately and animates it out of flow, so layout settles once and the existing reference-node scroll correction runs once. A caret gives an explicit close that needs no scrolling. The toggle becomes a funnel icon carrying an active-filter dot. Nothing about the rail, its chips, or the window model changes.

**Tech Stack:** Vite 7 + Preact 10 + TypeScript 5 + Tailwind 4; Vitest + `@testing-library/preact`; jsdom; Playwright for behaviour.

**Spec:** `docs/superpowers/specs/2026-08-17-web-filter-panel-dismissal-design.md`
(partly supersedes `2026-08-16-web-filter-reveal-design.md` — read the superseded note at the top of that one)

---

## Global Constraints

- **Never commit to `main`.** Create `feat/web-filter-panel-dismissal` off `main` before Task 1 and stay on it. Open a PR; do not fast-forward `main`.
- **Preact, not React.** Hooks import from `'react'` (aliased to `preact/compat` by `@preact/preset-vite` and by `vitest.config.ts`). Pure `.ts` hook files with no JSX may import from `'preact/hooks'`.
- `@/` path alias maps to `frontend/src/`.
- **This repo has no `eslint-plugin-react-hooks`.** Nothing lints dependency arrays — reason them by hand. And an `eslint-disable-next-line react-hooks/exhaustive-deps` directive is a **hard ESLint 9 error**, because the named rule is unregistered. Explain a deliberate dependency array in a plain comment.
- **jsdom has no layout.** `getBoundingClientRect()` returns all-zero rects, and `scrollIntoView` is not implemented at all (a guarded no-op lives in `src/__tests__/setup.ts`). Anything geometric must be stubbed explicitly, and anything only observable in a browser goes to Task 6 rather than a test that asserts intent.
- **Scroll corrections track a day section's `getBoundingClientRect().top` and `scrollBy` the delta.** Never save and restore a `scrollY` number — that invariant is wrong whenever content above the reader changes height, which is exactly what opening and closing this panel does. `useFilterPanel` already implements this correctly; do not regress it.
- **Frontend coverage floor is 74.3% lines** (`.coverage-floor.json`); `npm run lint` must produce zero output.
- **Verification before every commit**, from `frontend/`: `npm run build` (runs type-check + lint, then tests, then the bundle).
- **Verify on Node 24**, which is CI's stricter matrix leg:
  ```bash
  export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
  node --version    # v24.19.0
  ```
  The vitest binary is at the **repo root** `node_modules/.bin/vitest`, not under `frontend/`.
- **A test that would pass whether or not the code works is worse than no test.** Seven were caught on the preceding branch, four of them written by its plan. Prove every new test by breaking the source — confirm FAIL, restore, confirm PASS — and put both outputs in the report.

## Current state — read before starting

`frontend/src/app/page.tsx` around line 355:

- A zero-height `<div ref={filtersSentinelRef} aria-hidden="true" />` marks where the sticky container begins; `useScrolledPastFilters` observes it and yields `filtersScrolledPast`.
- `<div className="sticky top-0 z-30">` wraps **the filter card, then `<DayRail>`**.
- The filter card carries `id={filtersPanelId}`, `ref={filtersPanelRef}`, is `hidden` when `filtersScrolledPast && !filtersOpen`, and gets `max-h-[70vh] overflow-y-auto` when `filtersPanelOverlaying` (`= filtersScrolledPast && filtersOpen`, line 231).
- `useFilterPanel` (`frontend/src/hooks/useFilterPanel.ts`) owns `open`, `toggle`, `panelId`, `panelRef`, `toggleRef`, the reference-node scroll correction, focus-in on open, focus-return on `Escape`, and the `Escape` listener.
- `DayRail` renders the toggle from a `filtersToggle` prop (`open`, `onToggle`, `panelId`, `visible`, `toggleRef`), currently with the text `Filters`.

## File Structure

**New**

| File | Responsibility |
|---|---|
| `frontend/src/hooks/useDismissOnScrollGesture.ts` | Decides *when* a reader's scroll gesture should dismiss something. No knowledge of the panel. |
| `frontend/src/components/filters/FilterPanelCaret.tsx` | The bottom-edge close control. |
| `frontend/src/components/filters/FiltersIcon.tsx` | The funnel glyph, with its active-filter dot. |

**Changed**

| File | Change |
|---|---|
| `frontend/src/hooks/useFilterPanel.ts` | Consumes the gesture hook; gains the exit-animation state machine. |
| `frontend/src/app/page.tsx` | Passes the panel's exit state into the card's classes; renders the caret; feeds `hasFilters` to the toggle. |
| `frontend/src/components/calendar/DayRail.tsx` | Toggle renders the icon and the dot. |
| `frontend/src/app/globals.css` | The exit transition, behind `prefers-reduced-motion`. |
| `.superpowers/.../probes/verify-filter-reveal.mjs` | New gesture-dismissal checks (see Task 6). |

**Suggested PR boundary:** one PR. The pieces are individually small and only meaningful together.

---

### Task 1: `useDismissOnScrollGesture` — when a scroll gesture means "dismiss"

**Files:**
- Create: `frontend/src/hooks/useDismissOnScrollGesture.ts`
- Test: `frontend/src/__tests__/hooks/useDismissOnScrollGesture.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function useDismissOnScrollGesture(o: {
    active: boolean;
    onDismiss: () => void;
    isExempt: (target: EventTarget | null) => boolean;
  }): void
  ```

- [ ] **Step 1: Create the branch**

```bash
cd /Users/bernard/src/chq/chq-calendar
git checkout main && git pull
git checkout -b feat/web-filter-panel-dismissal
```

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/__tests__/hooks/useDismissOnScrollGesture.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/preact';
import { useDismissOnScrollGesture } from '@/hooks/useDismissOnScrollGesture';

afterEach(() => { document.body.innerHTML = ''; });

function setup(o: { active?: boolean; exempt?: HTMLElement } = {}) {
  const onDismiss = vi.fn();
  const isExempt = (t: EventTarget | null) =>
    !!o.exempt && t instanceof Node && o.exempt.contains(t);
  renderHook(() => useDismissOnScrollGesture({
    active: o.active ?? true, onDismiss, isExempt,
  }));
  return onDismiss;
}

describe('useDismissOnScrollGesture', () => {
  it('dismisses on a wheel gesture', () => {
    const onDismiss = setup();
    window.dispatchEvent(new Event('wheel'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on a touch gesture', () => {
    const onDismiss = setup();
    window.dispatchEvent(new Event('touchstart'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on a scrollbar drag', () => {
    const onDismiss = setup();
    window.dispatchEvent(new Event('mousedown'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on a navigation key', () => {
    const onDismiss = setup();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // Without this, deleting the SCROLL_KEYS guard entirely — so every keydown
  // dismisses — leaves every other test in this file passing. The narrowing
  // exists so that typing in the panel's own search field does not close it,
  // and this is the only test that covers that.
  it.each(['a', 'Tab'])('does not dismiss on the non-scroll key %s', (key) => {
    const onDismiss = setup();
    window.dispatchEvent(new KeyboardEvent('keydown', { key }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  // The single most important assertion in this file. Opening the panel fires
  // our own `scrollBy` correction, and a filter change reflows the list — both
  // emit `scroll`. A `scroll` listener would dismiss the panel in the frame it
  // opened, and again on the reader's first venue tick.
  it('does NOT dismiss on the scroll event', () => {
    const onDismiss = setup();
    window.dispatchEvent(new Event('scroll'));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('ignores a gesture that starts inside an exempt element', () => {
    const panel = document.createElement('div');
    const inner = document.createElement('button');
    panel.appendChild(inner);
    document.body.appendChild(panel);
    const onDismiss = setup({ exempt: panel });
    inner.dispatchEvent(new Event('wheel', { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('still dismisses for a gesture outside the exempt element', () => {
    const panel = document.createElement('div');
    const outside = document.createElement('div');
    document.body.append(panel, outside);
    const onDismiss = setup({ exempt: panel });
    outside.dispatchEvent(new Event('wheel', { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does nothing while inactive', () => {
    const onDismiss = setup({ active: false });
    window.dispatchEvent(new Event('wheel'));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('removes its listeners on unmount', () => {
    const onDismiss = vi.fn();
    const { unmount } = renderHook(() => useDismissOnScrollGesture({
      active: true, onDismiss, isExempt: () => false,
    }));
    unmount();
    window.dispatchEvent(new Event('wheel'));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `cd frontend && ../node_modules/.bin/vitest run src/__tests__/hooks/useDismissOnScrollGesture.test.ts`
Expected: FAIL — `Failed to resolve import "@/hooks/useDismissOnScrollGesture"`.

- [ ] **Step 4: Write the hook**

Create `frontend/src/hooks/useDismissOnScrollGesture.ts`:

```ts
import { useEffect } from 'react';

/**
 * Keys the reader deliberately scroll with. Deliberately narrow: a bare
 * letter or a Tab must not dismiss anything, since typing into the panel's
 * own search field would otherwise close it.
 */
const SCROLL_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar',
]);

/**
 * Calls `onDismiss` the first time the reader makes a gesture that scrolls
 * the page.
 *
 * **This listens for input events and never for `scroll`, and that is the
 * whole point of the hook.** Two things fire `scroll` that are emphatically
 * not the reader scrolling:
 *
 * - The filter panel's own opening correction calls `window.scrollBy` to hold
 *   the reader's position while the panel is inserted above them. A `scroll`
 *   listener would dismiss the panel in the same frame it opened.
 * - Changing a filter reflows the list, which can move `scrollY` on its own. A
 *   `scroll` listener would close the panel on the reader's first tick of a
 *   venue — contradicting the deliberate rule that picking a venue, a category
 *   and a week is one intent.
 *
 * `isExempt` receives the event target so the caller can spare gestures that
 * start inside the thing being dismissed (scrolling the panel's own overflow)
 * or on the control that toggles it (which would otherwise dismiss and reopen
 * in one tap).
 *
 * Listeners are attached only while `active`, and are passive: this must never
 * delay a scroll.
 */
export function useDismissOnScrollGesture({ active, onDismiss, isExempt }: {
  active: boolean;
  onDismiss: () => void;
  isExempt: (target: EventTarget | null) => boolean;
}): void {
  useEffect(() => {
    if (!active) return;

    const handle = (e: Event) => {
      if (e.type === 'keydown' && !SCROLL_KEYS.has((e as KeyboardEvent).key)) return;
      if (isExempt(e.target)) return;
      onDismiss();
    };

    const events = ['wheel', 'touchstart', 'touchmove', 'mousedown', 'keydown'] as const;
    for (const type of events) {
      window.addEventListener(type, handle, { passive: true, capture: true });
    }
    return () => {
      for (const type of events) {
        window.removeEventListener(type, handle, { capture: true });
      }
    };
  }, [active, onDismiss, isExempt]);
}
```

Note the `capture: true`: the panel's own controls call `stopPropagation` in places, and a bubbling listener would miss gestures those swallow. Capture also guarantees this runs before a chip's `click` handler starts a day navigation, which Task 3 depends on.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && ../node_modules/.bin/vitest run src/__tests__/hooks/useDismissOnScrollGesture.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Prove the central test can fail**

Temporarily add `'scroll'` to the `events` array. Re-run. Expected: `does NOT dismiss on the scroll event` FAILS. Restore, re-run, expect PASS. Put both outputs in the report.

- [ ] **Step 7: Full verification and commit**

```bash
cd frontend && npm run build
cd .. && git add frontend
git commit -m "feat(web): detect the scroll gestures that should dismiss a panel"
git push -u origin feat/web-filter-panel-dismissal
```

---

### Task 2: Dismiss the panel on a gesture

Wire Task 1 into `useFilterPanel`, with no animation yet — the panel simply disappears. Animation is Task 4, and keeping them apart means the behaviour is provable before any motion exists to obscure it.

**Files:**
- Modify: `frontend/src/hooks/useFilterPanel.ts`
- Modify: `frontend/src/app/page.tsx`
- Test: `frontend/src/__tests__/hooks/useFilterPanel.test.tsx`

**Interfaces:**
- Consumes: `useDismissOnScrollGesture` from Task 1.
- Produces: `useFilterPanel` unchanged in shape. It gains no new return value — the caller already has everything.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/__tests__/hooks/useFilterPanel.test.tsx` — note the
`.tsx` extension. **Read the file first and follow its existing style**: it
renders a `Harness()` component through `render()` rather than driving the hook
with `renderHook`, and it already provides `mockDaySectionTrackingPanel` (a day
section whose stubbed `top` changes with the panel's visibility, using numbers
measured from a real Chromium build) and `panelElementFor(toggle)`. Use those
rather than inventing parallel helpers; the sketch below is written against
`renderHook` for brevity and **must be adapted** to the `Harness` pattern:

```ts
describe('dismissal by scroll gesture', () => {
  it('closes when the reader makes a scroll gesture', () => {
    const { result } = renderHook(() => useFilterPanel());
    act(() => { result.current.toggle(); });
    expect(result.current.open).toBe(true);
    act(() => { window.dispatchEvent(new Event('wheel')); });
    expect(result.current.open).toBe(false);
  });

  // Our own opening correction calls `scrollBy`, which fires `scroll`.
  it('does not close itself on the scroll its own opening correction fires', () => {
    const { result } = renderHook(() => useFilterPanel());
    act(() => { result.current.toggle(); });
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(result.current.open).toBe(true);
  });

  it('ignores a gesture inside the panel', () => {
    const panel = document.createElement('div');
    const inner = document.createElement('input');
    panel.appendChild(inner);
    document.body.appendChild(panel);
    const { result } = renderHook(() => useFilterPanel());
    act(() => { result.current.panelRef(panel); });
    act(() => { result.current.toggle(); });
    act(() => { inner.dispatchEvent(new Event('wheel', { bubbles: true })); });
    expect(result.current.open).toBe(true);
  });

  // Without this the toggle's own mousedown dismisses, and its click reopens.
  it('ignores a gesture on the toggle itself', () => {
    const toggle = document.createElement('button');
    document.body.appendChild(toggle);
    const { result } = renderHook(() => useFilterPanel());
    act(() => { result.current.toggleRef(toggle); });
    act(() => { result.current.toggle(); });
    act(() => { toggle.dispatchEvent(new Event('mousedown', { bubbles: true })); });
    expect(result.current.open).toBe(true);
  });

  it('does nothing while closed', () => {
    const { result } = renderHook(() => useFilterPanel());
    expect(result.current.open).toBe(false);
    act(() => { window.dispatchEvent(new Event('wheel')); });
    expect(result.current.open).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd frontend && ../node_modules/.bin/vitest run src/__tests__/hooks/useFilterPanel.test.tsx -t 'dismissal by scroll gesture'`
Expected: FAIL — the panel stays open after the wheel event.

- [ ] **Step 3: Wire the hook in**

In `frontend/src/hooks/useFilterPanel.ts`, add the import and a dismissal path. Add beside `closeViaEscape`:

```ts
  // Closing by gesture takes the same scroll-correction capture as every
  // other close — the panel leaving shrinks content above the reader, and
  // holding them still is exactly as necessary here as on the other paths.
  // No focus return: a gesture means the reader's attention has already left
  // the panel, and yanking focus to the toggle would be its own surprise.
  // The one exception is focus that is still INSIDE the panel, which would
  // otherwise be stranded on a detached element.
  const closeViaGesture = useCallback(() => {
    captureScrollReference();
    setOpen(false);
    const panel = panelElRef.current;
    if (panel && document.activeElement && panel.contains(document.activeElement)) {
      toggleElRef.current?.focus({ preventScroll: true });
    }
  }, []);

  // A gesture that starts inside the panel is the reader scrolling the
  // panel's own overflow, not the list. A gesture on the toggle is the
  // reader closing it deliberately — dismissing here too would close on
  // `mousedown` and reopen on the following `click`.
  const isExempt = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Node)) return false;
    return !!panelElRef.current?.contains(target)
      || !!toggleElRef.current?.contains(target);
  }, []);

  useDismissOnScrollGesture({ active: open, onDismiss: closeViaGesture, isExempt });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && ../node_modules/.bin/vitest run src/__tests__/hooks/useFilterPanel.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Prove each new test can fail**

Break each mechanism in turn — remove the `isExempt` panel check, then the toggle check, then pass `active: true` unconditionally — confirming the matching test FAILS each time, restoring between. Both outputs per break in the report.

- [ ] **Step 6: Full verification and commit**

```bash
cd frontend && npm run build
cd .. && git add frontend
git commit -m "feat(web): dismiss the filter panel when the reader scrolls"
git push
```

---

### Task 3: Arbitrate dismissal against day navigation

Tapping a day chip while the panel is open is a gesture (dismiss) *and* a navigation (scroll to that day). Two scroll corrections in one interaction is the exact shape of the bug that cost the previous branch a review round, when `useDayAnchor`'s hold and `EventList`'s prepend settle both called `scrollBy` on one resize.

The animation architecture in Task 4 removes the panel from flow immediately, and Task 1's capture-phase listener runs before the chip's `click`. Together those *should* make the ordering correct by construction — dismissal settles the layout, then the day scroll runs against it. **This task exists to prove that rather than assume it**, and to pin it so a later change cannot quietly reorder them.

**Files:**
- Test: `frontend/src/__tests__/components/calendar/dayRailIntegration.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–2. No production change is expected. **If the test cannot be made to pass without one, stop and report** — that is a real finding about the ordering, not a licence to add a `setTimeout`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/__tests__/components/calendar/dayRailIntegration.test.tsx`. Read the file's existing `Harness` first — extend it to mount a filter panel alongside, rather than writing a second harness:

```ts
// A chip tap dismisses the panel AND navigates. Both correct scroll. If they
// run unordered the reader lands in neither place, so the dismissal must
// settle the layout before the day scroll measures it.
it('dismisses the panel before scrolling to the tapped day, not alongside it', () => {
  // …arrange: panel open, a day beyond the render window, scrollBy spied…
  // …act: tap the chip…
  // Assert the ORDER, not just that both happened: the panel's correction
  // must be recorded before the day-navigation scroll.
  expect(order).toEqual(['dismiss', 'navigate']);
});
```

Fill in the arrange/act from the file's existing patterns — it already mounts a real `EventList` under a real `useDayAnchor`, installs `installResizeObserverMock` and `installIntersectionObserverMock`, and stubs `scrollBy`. Record order by pushing a label from each correction's spy.

- [ ] **Step 2: Run it and see what happens**

Run: `cd frontend && ../node_modules/.bin/vitest run src/__tests__/components/calendar/dayRailIntegration.test.tsx -t 'dismisses the panel before'`

Two legitimate outcomes:
- **PASS** — the ordering already holds by construction. Good: the test now pins it. Say so in the report.
- **FAIL** — the ordering does not hold. **Stop and report the failure with the observed order** before changing production code. The fix is a design decision, not a mechanical one.

- [ ] **Step 3: Prove the test discriminates**

Whichever outcome, make the test fail deliberately by reversing the expected order, confirm it fails, restore. A test asserting an order that already holds is worth nothing unless you have seen it reject the wrong order.

- [ ] **Step 4: Full verification and commit**

```bash
cd frontend && npm run build
cd .. && git add frontend
git commit -m "test(web): pin that dismissal settles before the day scroll measures"
git push
```

---

### Task 4: The exit animation

**Files:**
- Modify: `frontend/src/hooks/useFilterPanel.ts`
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/app/globals.css`
- Test: `frontend/src/__tests__/hooks/useFilterPanel.test.tsx`

**Interfaces:**
- Produces: `useFilterPanel` returns an added `exiting: boolean` and `exitRect: DOMRect | null`. `page.tsx` uses them to render the leaving panel out of flow.

**The architecture, and why:** on dismiss the panel's rect is measured, it is switched to `position: fixed` at that rect, the in-flow placeholder is dropped **in the same commit**, the scroll correction runs once, and only then does the transition play. Animating `height` or `max-height` instead would relayout hundreds of event cards every frame and leave the scroll correction chasing a moving target rather than settling it once. **No DOM clone** — the element moves between layers, so the controls inside it are never duplicated.

- [ ] **Step 1: Write the failing tests**

```ts
describe('exit animation', () => {
  it('reports an exit rect captured before the panel leaves flow', () => {
    // Stub the panel's getBoundingClientRect, open, dismiss,
    // assert `exiting` is true and `exitRect` matches the stubbed rect.
  });

  it('clears exiting when the transition ends', () => {
    // Fire `transitionend` on the panel; assert `exiting` false, `exitRect` null.
  });

  // Reduced motion must remove it outright — no lingering fixed element.
  it('skips the animation under prefers-reduced-motion', () => {
    // setup.ts's matchMedia stub returns matches:false; override it to true
    // for this test, dismiss, and assert `exiting` is never true.
  });

  // A dismissal while one is already animating must not strand the first.
  it('does not strand a previous exit when dismissed twice quickly', () => {
    // open, dismiss, re-open before transitionend, dismiss again;
    // assert only one exit is live.
  });
});
```

Write these out fully against the file's existing `Harness` / `render` pattern
and its `mockDaySectionTrackingPanel` and `panelElementFor` helpers before
implementing — not with `renderHook`.

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd frontend && ../node_modules/.bin/vitest run src/__tests__/hooks/useFilterPanel.test.tsx -t 'exit animation'`
Expected: FAIL — `exiting` is not part of the hook's return.

- [ ] **Step 3: Implement the state machine**

In `useFilterPanel`, add `exiting`/`exitRect` state. On a close of any kind: if `prefers-reduced-motion: reduce` matches, close outright as today. Otherwise capture `panelElRef.current.getBoundingClientRect()`, set `exiting`, set `open` false in the same commit, and clear on `transitionend` (with a `setTimeout` fallback slightly longer than the transition, since `transitionend` does not fire if the element is never painted).

- [ ] **Step 4: Render the leaving panel out of flow**

In `page.tsx`, when `exiting`, render the card with `position: fixed` at `exitRect`'s coordinates and the exit class. Keep the in-flow slot empty in that same commit.

- [ ] **Step 5: Add the transition**

In `globals.css`:

```css
/*
 * The filter panel's exit. Compositor-only — `transform` and `opacity`
 * never trigger layout, which is the entire reason the panel is moved out
 * of flow before this runs rather than being collapsed in place.
 */
@media (prefers-reduced-motion: no-preference) {
  .filter-panel-exit {
    transition: transform 200ms ease-out, opacity 200ms ease-out;
    transform: translateY(-100%);
    opacity: 0;
  }
}
```

- [ ] **Step 6: Run the tests, prove each can fail, verify, commit**

```bash
cd frontend && npm run build
cd .. && git add frontend
git commit -m "feat(web): animate the filter panel out without relayout"
git push
```

---

### Task 5: The caret, the icon, and the active dot

**Files:**
- Create: `frontend/src/components/filters/FilterPanelCaret.tsx`
- Create: `frontend/src/components/filters/FiltersIcon.tsx`
- Modify: `frontend/src/components/calendar/DayRail.tsx`
- Modify: `frontend/src/app/page.tsx`
- Test: `frontend/src/__tests__/components/filters/FilterPanelCaret.test.tsx`
- Test: `frontend/src/__tests__/components/calendar/DayRail.test.tsx`

**Interfaces:**
- Produces: `FilterPanelCaret({ onClose })`; `FiltersIcon({ active }: { active: boolean })`.
- `DayRailFiltersToggleProps` gains `hasActiveFilters: boolean`.

- [ ] **Step 1: Write the failing tests**

Cover: the caret is a button named "Hide filters" and calls `onClose`; its hit area is at least 44px tall and full width (assert the classes that produce it, and say in a comment that jsdom cannot measure the rendered box); the toggle's accessible name is still exactly `Filters` after the text becomes an icon; the dot renders when `hasActiveFilters` and not otherwise; and the dot is `aria-hidden` so it does not pollute the accessible name.

- [ ] **Step 2: Run them to make sure they fail**

- [ ] **Step 3: Implement**

The caret goes at the panel's bottom edge inside the card, so Task 2's `isExempt` already spares it. The icon is an inline SVG funnel with `aria-hidden="true"`; the button keeps `aria-label="Filters"`, `aria-expanded`, `aria-controls`. The dot is a small absolutely-positioned span, `aria-hidden`.

Feed `hasActiveFilters={filters.hasFilters}` from `page.tsx` — that value already exists on `useFilterState`.

- [ ] **Step 4: Run the tests, prove each can fail, verify, commit**

```bash
cd frontend && npm run build
cd .. && git add frontend
git commit -m "feat(web): a caret to close the panel and a funnel toggle that shows when filters are on"
git push
```

---

### Task 6: Browser verification and the harness

Everything this plan risks is geometry, motion and event ordering. jsdom computes none of it. On the preceding branch the browser pass found three defects that eleven green task reviews had all missed.

**Files:**
- Modify: `.superpowers/sdd/2026-08-16-date-navigation-phase-3a-web-day-rail/probes/verify-filter-reveal.mjs`

- [ ] **Step 1: Update the existing checks**

Most of the 13 still hold. The one that does not is any assertion that the panel survives arbitrary interaction — re-read each against the new model before changing it, and **do not weaken a check that is still valid** just because it is adjacent to one that isn't.

- [ ] **Step 2: Add the new checks**

At 390×844, against a dev server:

1. A real `wheel` dismisses the panel.
2. A real touch gesture dismisses it.
3. **Opening does not dismiss it** — the guard against our own correction's `scroll`.
4. **A filter change does not dismiss it** — tick a venue, panel still open.
5. Scrolling inside the panel's own overflow does not dismiss it.
6. The reader's day section is stationary across dismissal (reference-node, not `scrollY` — `scrollY` *should* move).
7. The caret closes it, and its hit box is at least 44px tall.
8. After dismissal, scrolling back up does **not** bring it back.
9. Tapping a day chip while open leaves the reader at that day, not short of it.
10. With `prefers-reduced-motion: reduce` emulated, the panel is gone immediately and no fixed-position element is left behind.

- [ ] **Step 3: Run it and record the numbers**

```bash
cd frontend && npm run dev &
node .superpowers/sdd/2026-08-16-date-navigation-phase-3a-web-day-rail/probes/verify-filter-reveal.mjs
```

Every check reports the value it measured, not just a verdict. Record them in the report.

- [ ] **Step 4: Commit and open the PR**

```bash
git add -A frontend
git commit -m "docs: record the browser verification for panel dismissal"
git push
gh pr create --base main --title "feat(web): the filter panel leaves when you scroll" --body "…"
```

---

## Self-review notes

Checked against the spec, 2026-08-17:

- **Covered:** D1 and D2 (Task 2, gesture dismissal, any direction); D3 (nothing restores it — Task 6 check 8 pins that scrolling up does not); D4 (Task 5, caret and shadow); D5 (Task 5, icon and dot); the gesture-not-`scroll` rule (Task 1, with its own break-the-source proof); the arbitration requirement (Task 3); the animation architecture and reduced-motion (Task 4); the accessibility requirements (Task 5, plus focus-return on gesture dismissal in Task 2); and the testing split (jsdom for mechanism, Playwright for behaviour).
- **The shadow** from D4 is a one-class change folded into Task 5 rather than given a step of its own; it needs no test beyond the visual pass.
- **Deliberately unresolved:** Task 3 may pass without any production change. That is a real possible outcome, not a gap — the task's value is pinning an ordering that currently holds by construction, and it instructs the implementer to stop and report rather than invent a fix if it does not.
