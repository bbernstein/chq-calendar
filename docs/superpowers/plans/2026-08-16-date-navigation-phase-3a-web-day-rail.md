# Date navigation phase 3a — web day rail + scope set — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn phase 2's dark render window into shipped behaviour, and give the
web a sticky day rail plus the converged scope set (Now · Today · All Season ·
All Year), so a reader can move by a day or a week without re-picking a date.

**Architecture:** Three layers, in order. (1) The upward-prepend scroll
correction stops measuring total document height and tracks a specific day
section's `getBoundingClientRect().top` instead — a prerequisite for the rail,
because a sticky rail is exactly the kind of height change the old approach
mis-attributes. (2) `VITE_NAV_V2` and the legacy list container are deleted, so
there is one list path to build the rail on. (3) The rail itself: a `DayRail`
presentational component over `dayChips`, a `useDayAnchor` hook that derives the
highlighted day from scroll position and scrolls to a day on tap, and a
`--day-rail-h` custom property maintained by a `ResizeObserver` so the already-
sticky day headers stack under it at any text zoom.

**Tech Stack:** Vite 7 + Preact 10 + TypeScript 5 + Tailwind 4; Vitest +
`@testing-library/preact`; jsdom.

**Spec:** `docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md`

**Scope:** This plan is **3a — web only**, as decided 2026-08-16. The iOS rail
(`DayRailView` over `MyDayChipContent`, `.safeAreaInset` mounting, deleting
`showNextDay()`) becomes 3b and folds into phase 4's iOS consolidation. Nothing
in this plan touches `ios/`, so `.github/workflows/app-store-assets.yml` does not
apply and no screenshot regeneration is owed.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Never commit to `main`.** Create `feat/date-nav-phase-3a-web-day-rail` off
  `main` before Task 1 and stay on it. Open a PR; do not fast-forward `main`.
- **Preact, not React.** Anything wiring DOM event handlers imports hooks from
  `'react'` (aliased to `preact/compat` by `@preact/preset-vite` and by
  `vitest.config.ts`). This is the project convention — see `CLAUDE.md`. Pure
  `.ts` hook files with no JSX may import from `'preact/hooks'`.
- **`@/` path alias** maps to `frontend/src/`. Use it in every import.
- **Day keys are `yyyy-mm-dd`, local time, zero-padded** (`DayKey` in
  `dayWindow.ts`). Lexicographic order is chronological — plain string
  comparison is a correct date comparison. Never do 86,400,000 ms arithmetic on
  a day; use `addDays`, which is DST-safe by construction.
- **Windows are half-open**: `start <= x < endExclusive`. Never inclusive with a
  subtracted epsilon.
- **Session-only window state.** `windowStartDay` / `windowEndDay` are absent
  from the `localStorage` payload in `useFilterState.ts` and must stay absent.
  The anchor day is view state and is never persisted and never filters.
- **`'this-week'` stays in the `DateFilter` union.** This phase removes a
  **button**, not a union member, so a value persisted in `localStorage` keeps
  working and renders as the current week highlighted on the strip. Mirrors iOS,
  where `.thisWeek` is in the enum but absent from `DateFilterSheet.visibleScopes`.
- **Coverage floors are enforced** — `.coverage-floor.json` is
  `{"backend":{"lines":81.1},"frontend":{"lines":74.3}}`. Deleting the legacy
  list path (Task 3) removes both covered code and its tests; re-check the floor
  after that task specifically.
- **Verification before every commit**, from `frontend/`:
  `npm run build` (runs `validate` = type-check + lint, then tests, then bundle).
  Frontend `lint` does not fail on warnings, but do not add new ones.
- **jsdom has no layout.** `getBoundingClientRect()` returns all-zero rects and
  `scrollIntoView` is a no-op. Every test that depends on geometry must stub it
  explicitly. A test that would pass whether or not the code works is worse than
  no test — three such tests shipped in phase 2. Where a behaviour is only
  observable in a real browser, the plan says so and routes it to Task 12
  instead of pretending a jsdom test covers it.

---

## File Structure

**New**

| File | Responsibility |
|---|---|
| `frontend/src/lib/utils/daySections.ts` | The DOM contract between the list and everything that scrolls to a day: the `data-day-key` attribute name, the element lookup, and the `scroll-margin-top` custom property. Pure DOM, no Preact. |
| `frontend/src/components/calendar/DayRail.tsx` | Presentational rail: chevrons, chip strip, `⟳ Now`. No scroll logic, no filter state. |
| `frontend/src/hooks/useDayAnchor.ts` | Derives the anchor day from scroll position; exposes `scrollToDay`. |
| `frontend/src/hooks/useDayRailHeight.ts` | Maintains `--day-rail-h` on `:root` from a `ResizeObserver` on the rail element. |

**Changed**

| File | Change |
|---|---|
| `frontend/src/components/calendar/EventListWindowed.tsx` | Scroll correction rewritten (Tasks 1–2); renamed to `EventList.tsx` in Task 3. |
| `frontend/src/components/calendar/EventListView.tsx` | Day sections gain `data-day-key` and the sticky offset. |
| `frontend/src/components/calendar/EventList.tsx` | Becomes the windowed list itself; the flag dispatcher is deleted. |
| `frontend/src/components/calendar/EventListLegacy.tsx` | **Deleted** (Task 3). |
| `frontend/src/lib/featureFlags.ts` | `isNavV2Enabled` **deleted** (Task 3); file survives only if another flag is added later — it is deleted here because it holds nothing else. |
| `frontend/src/lib/utils/dayWindow.ts` | `'season'` base window; `dayChips`; `formatDayRange`. |
| `frontend/src/hooks/useFilterState.ts` | `DateFilter` gains `'season'`. |
| `frontend/src/hooks/useScrollState.ts` | `'season'` joins the relative-filter set in `handleWeekTap`. |
| `frontend/src/components/filters/DateFilter.tsx` | Four scope buttons; This Week button and `SelectedFilterInfo` removed. |
| `frontend/src/components/filters/buildActiveChips.ts` | Date chip names the actual window; `✕` resets the window when it has grown. |
| `frontend/src/app/page.tsx` | Rail wiring, anchor wiring, legacy props removed. |
| `frontend/src/app/globals.css` | `--day-rail-h` default. |
| `frontend/src/app/about/aboutContent.ts` | Web guide copy for the new date story. |
| `frontend/.env.example` | `VITE_NAV_V2` entry removed. |

**Suggested PR boundaries** (each is green on its own): PR A = Tasks 1–3
(scroll fix + release). PR B = Tasks 4–6 (scope set). PR C = Tasks 7–12 (the
rail). A single PR for all twelve is acceptable if the reviewer prefers it, but
PR A is worth landing alone — it is the release of phase 2.

---

### Task 1: Anchor the upward-prepend correction on a day section, not on document height

The shipped correction compares `document.documentElement.scrollHeight` before
and after the prepend. That assumes every height change happened *above* the
reader and had *already landed* when the layout effect measured. Neither is
guaranteed, and the instrumented phase-2 evidence is a `scrollTo(0, 1053)`
computed against a `scrollHeight` of 7618 while the document measured ~7677
about 300ms later — ~59px the correction never saw. Tracking one node's `top`
is correct regardless of what else changes height, and stays correct once Task 9
adds a sticky rail above the day headers.

**Files:**
- Create: `frontend/src/lib/utils/daySections.ts`
- Create: `frontend/src/__tests__/lib/utils/daySections.test.ts`
- Modify: `frontend/src/components/calendar/EventListView.tsx:34-36`
- Modify: `frontend/src/components/calendar/EventListWindowed.tsx:162-187`
- Test: `frontend/src/__tests__/components/calendar/EventListWindowed.test.tsx`

**Interfaces:**
- Produces: `DAY_SECTION_ATTR: 'data-day-key'`;
  `daySectionElement(key: string): HTMLElement | null`;
  `daySectionTop(key: string): number | null`.
- Consumes: `DayGroup` from `@/lib/utils/eventHelpers` (`{ key, baseLabel, weekNumbers, events }`).

- [ ] **Step 1: Create the branch**

```bash
cd /Users/bernard/src/chq/chq-calendar
git checkout main && git pull
git checkout -b feat/date-nav-phase-3a-web-day-rail
```

- [ ] **Step 2: Write the failing test for the day-section lookup**

Create `frontend/src/__tests__/lib/utils/daySections.test.ts`:

```ts
import { describe, expect, it, afterEach } from 'vitest';
import { DAY_SECTION_ATTR, daySectionElement, daySectionTop } from '@/lib/utils/daySections';

function mount(keys: string[]) {
  document.body.innerHTML = keys
    .map(k => `<div ${DAY_SECTION_ATTR}="${k}"></div>`)
    .join('');
}

afterEach(() => { document.body.innerHTML = ''; });

describe('daySectionElement', () => {
  it('finds the section for a day key', () => {
    mount(['2026-06-27', '2026-06-28']);
    expect(daySectionElement('2026-06-28')?.getAttribute(DAY_SECTION_ATTR)).toBe('2026-06-28');
  });

  it('returns null for a day that is not mounted', () => {
    mount(['2026-06-27']);
    expect(daySectionElement('2026-06-28')).toBeNull();
  });

  // groupEventsByDay emits this key for an unparseable startDate. It must not
  // be able to break the selector — a thrown SyntaxError here would take the
  // whole list down rather than degrade one row.
  it('does not throw on the NaN key groupEventsByDay can emit', () => {
    mount(['NaN-NaN-NaN']);
    expect(daySectionElement('NaN-NaN-NaN')).not.toBeNull();
  });
});

describe('daySectionTop', () => {
  it('reports the viewport-relative top of a mounted section', () => {
    mount(['2026-06-27']);
    const el = daySectionElement('2026-06-27')!;
    // jsdom has no layout, so every rect is zero. Stub the one value under test.
    el.getBoundingClientRect = () => ({ top: 412 }) as DOMRect;
    expect(daySectionTop('2026-06-27')).toBe(412);
  });

  it('returns null when the section is not mounted', () => {
    mount([]);
    expect(daySectionTop('2026-06-27')).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/daySections.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/utils/daySections"`.

- [ ] **Step 4: Write the module**

Create `frontend/src/lib/utils/daySections.ts`:

```ts
/**
 * The DOM contract for a day section.
 *
 * One attribute, declared once, consumed by three unrelated things: the
 * upward-prepend scroll correction, the day rail's scrollspy, and its
 * scroll-to. Keeping the name here rather than inline at each site is what
 * stops a rename in the list from silently disabling navigation — every
 * consumer imports the same constant, so a rename is a compile error.
 *
 * A day key is `yyyy-mm-dd`, or the literal `NaN-NaN-NaN` that
 * `groupEventsByDay` emits for an unparseable `startDate`. Both are made
 * entirely of digits, letters and hyphens, so neither needs escaping inside
 * an attribute selector. `CSS.escape` is deliberately not used: it is absent
 * from some jsdom versions, and adding a dependency on it to defend against
 * a value shape that cannot occur trades a real portability risk for an
 * imaginary safety one.
 */
export const DAY_SECTION_ATTR = 'data-day-key';

export function daySectionElement(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${DAY_SECTION_ATTR}="${key}"]`);
}

/**
 * The viewport-relative top of a mounted day section, or `null`.
 *
 * This is the measurement the prepend correction is built on: it moves by
 * exactly the height inserted above it, whatever inserted it and whatever
 * else on the page changed size at the same time. Total document height
 * cannot make that distinction.
 */
export function daySectionTop(key: string): number | null {
  const el = daySectionElement(key);
  return el ? el.getBoundingClientRect().top : null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/daySections.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Tag the day sections in the DOM**

Modify `frontend/src/components/calendar/EventListView.tsx`. Add the import at
the top, next to the existing ones:

```tsx
import { DAY_SECTION_ATTR } from '@/lib/utils/daySections';
```

and change the section wrapper (currently line 35) from:

```tsx
        <div key={dayGroup.key}>
```

to:

```tsx
        // The day-key attribute is the anchor every scroll consumer resolves
        // against — the prepend correction, the rail's scrollspy, and its
        // scroll-to. It is on the section wrapper rather than the sticky
        // header, because a sticky header's rect stops reporting the
        // section's real position the moment it sticks.
        <div key={dayGroup.key} {...{ [DAY_SECTION_ATTR]: dayGroup.key }}>
```

- [ ] **Step 7: Write the failing test for the rewritten correction**

Append to `frontend/src/__tests__/components/calendar/EventListWindowed.test.tsx`.
First read the file's existing helpers — it already has a `makeGroups`-style
builder and `installIntersectionObserverMock` from
`@/__tests__/helpers/intersectionObserver`; reuse them rather than duplicating.
Add this `describe` block, adapting the group-builder call to whatever the file
already defines:

```tsx
describe('upward prepend scroll correction', () => {
  /**
   * Drives the one thing jsdom can express about this: that the correction
   * is computed from a day section's own rect, not from document height.
   * Layout is faked by handing each mounted section a fixed height and
   * deriving `top` from the number of sections above it — so a prepend
   * genuinely moves the reference section down, exactly as a browser would.
   */
  function stubLayout(sectionHeight: number) {
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: HTMLElement) {
        const sections = Array.from(document.querySelectorAll(`[${DAY_SECTION_ATTR}]`));
        const idx = sections.indexOf(this);
        const top = idx < 0 ? 0 : idx * sectionHeight - window.scrollY;
        return { top, bottom: top + sectionHeight, height: sectionHeight } as DOMRect;
      },
    });
  }

  afterEach(() => {
    // @ts-expect-error — restoring the prototype method jsdom shipped.
    delete HTMLElement.prototype.getBoundingClientRect;
  });

  it('scrolls by how far the reference day moved, not by the document delta', async () => {
    stubLayout(100);
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    Object.defineProperty(window, 'scrollY', { value: 250, writable: true, configurable: true });

    const initial = makeGroups(['2026-07-02', '2026-07-03']);
    const { rerender } = render(
      <EventListWindowed {...baseProps} groupedEvents={initial} resetKey="k"
        earlierDay="2026-07-01" onShowEarlier={() => {}} />
    );

    fireEvent.click(screen.getByRole('button', { name: /show earlier/i }));

    // The page prepends one day: the reference section (2026-07-02) is now
    // 100px further down than it was.
    rerender(
      <EventListWindowed {...baseProps}
        groupedEvents={makeGroups(['2026-07-01', '2026-07-02', '2026-07-03'])}
        resetKey="k" earlierDay={null} onShowEarlier={() => {}} />
    );

    expect(scrollBy).toHaveBeenCalledWith(0, 100);
  });

  it('does not correct when a filter change landed between the click and the prepend', async () => {
    stubLayout(100);
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);

    const { rerender } = render(
      <EventListWindowed {...baseProps} groupedEvents={makeGroups(['2026-07-02'])}
        resetKey="k" earlierDay="2026-07-01" onShowEarlier={() => {}} />
    );
    fireEvent.click(screen.getByRole('button', { name: /show earlier/i }));

    // The reference day MUST still be present after the rerender. Dropping it
    // would let the `top === null` guard produce this same assertion on its
    // own, and the test would then pass with the `resetKey` check deleted —
    // testing nothing. Only `resetKey` changes here, so a pass genuinely
    // depends on the cancellation guard.
    rerender(
      <EventListWindowed {...baseProps} groupedEvents={makeGroups(['2026-07-02', '2026-08-01'])}
        resetKey="DIFFERENT" earlierDay={null} onShowEarlier={() => {}} />
    );

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('does not correct when the reference day has left the list entirely', async () => {
    stubLayout(100);
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);

    const { rerender } = render(
      <EventListWindowed {...baseProps} groupedEvents={makeGroups(['2026-07-02'])}
        resetKey="k" earlierDay="2026-07-01" onShowEarlier={() => {}} />
    );
    fireEvent.click(screen.getByRole('button', { name: /show earlier/i }));

    // Same resetKey, but a background refresh dropped the reference day. A
    // correction computed against a missing node would scroll by whatever
    // the fallback rect happens to be — do nothing instead.
    rerender(
      <EventListWindowed {...baseProps} groupedEvents={makeGroups(['2026-07-05'])}
        resetKey="k" earlierDay={null} onShowEarlier={() => {}} />
    );

    expect(scrollBy).not.toHaveBeenCalled();
  });
});
```

Add to that file's imports: `import { DAY_SECTION_ATTR } from '@/lib/utils/daySections';`

- [ ] **Step 8: Run it to make sure it fails**

Run: `cd frontend && npx vitest run src/__tests__/components/calendar/EventListWindowed.test.tsx -t 'upward prepend'`
Expected: FAIL — `scrollBy` is never called (the component still calls `scrollTo`).

- [ ] **Step 9: Rewrite the correction**

In `frontend/src/components/calendar/EventListWindowed.tsx`, add the import:

```tsx
import { daySectionTop } from '@/lib/utils/daySections';
```

Replace the `pendingPrependRef` declaration, `handleShowEarlier`, and the
`useLayoutEffect` (currently lines 162–187) with:

```tsx
  // Growing the list upward pushes everything already on screen down by the
  // height of what was inserted. Measure before the change, correct after —
  // in a layout effect, so the correction lands before the browser paints
  // and the reader never sees the jump.
  //
  // The measurement is one day section's viewport-relative `top`, NOT the
  // document's total height. Total height silently assumes two things that
  // are not true: that every height change between the two measurements
  // happened above the reader, and that all of it had already landed when
  // the layout effect ran. A single node's `top` needs neither assumption —
  // it moves by exactly what was inserted above it — and it stays correct
  // once a sticky rail sits above the day headers, which is precisely the
  // kind of height change "everything above the reader" mis-classifies.
  //
  // The reference is `groupedEvents[0]`, the first day the view window
  // produced. Growth is one-way and the render window always starts at
  // index 0, so that day is mounted before the prepend and still mounted
  // after it, with every prepended day above it.
  const pendingPrependRef = useRef<{ key: string; top: number; resetKey: string } | null>(null);

  const handleShowEarlier = useCallback(() => {
    if (!onShowEarlier) return;
    const key = groupedEvents[0]?.key;
    const top = key ? daySectionTop(key) : null;
    // No measurable reference means no correction rather than a wrong one.
    pendingPrependRef.current = key && top !== null ? { key, top, resetKey } : null;
    onShowEarlier();
  }, [onShowEarlier, resetKey, groupedEvents]);

  useLayoutEffect(() => {
    const pending = pendingPrependRef.current;
    if (!pending) return;
    pendingPrependRef.current = null;
    // A filter change that landed between the click and the prepend means
    // this is a different list, and correcting against the old one would
    // scroll the reader into the middle of a result set they never asked
    // for. The reset effect cannot do this cancelling for us: layout
    // effects run before passive effects in the same commit, so by the time
    // it fired the correction would already be on screen.
    if (pending.resetKey !== resetKey) return;
    const top = daySectionTop(pending.key);
    // The reference day left the list — a background refresh, not a
    // prepend. Correcting against a node that is gone is guesswork.
    if (top === null) return;
    const delta = top - pending.top;
    if (delta !== 0) window.scrollBy(0, delta);
  }, [groupedEvents, resetKey]);
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/components/calendar/EventListWindowed.test.tsx`
Expected: PASS — the three new tests plus every pre-existing one in the file.
If a pre-existing test asserted on `window.scrollTo`, update it to `scrollBy`
with the equivalent delta; do not weaken an assertion to make it pass.

- [ ] **Step 11: Full verification**

Run: `cd frontend && npm run build`
Expected: type-check, lint, all tests, and the bundle all succeed.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/lib/utils/daySections.ts \
        frontend/src/__tests__/lib/utils/daySections.test.ts \
        frontend/src/components/calendar/EventListView.tsx \
        frontend/src/components/calendar/EventListWindowed.tsx \
        frontend/src/__tests__/components/calendar/EventListWindowed.test.tsx
git commit -m "fix(web): correct the upward prepend against a day section, not document height"
git push -u origin feat/date-nav-phase-3a-web-day-rail
```

---

### Task 2: Keep correcting until the prepended region stops changing height

Task 1 fixes attribution. It does not fix *timing*: a height change that lands
after the layout effect still moves the reader.

**This task is no longer conditional — it is justified by measurement.** A
Playwright probe against the dev server with Task 1's code in place
(`.superpowers/sdd/<this plan>/probes/`, and the numbers reproduced below)
establishes all of the following:

- **Task 1's correction is exactly right at the instant it runs.** Instrumenting
  `window.scrollBy` shows the reference day's `top` going 547 → 1600 on the
  prepend and back to **exactly 547** after the correction. Zero error.
- **One frame later, content above the reader grows**, and the reader moves with
  it. Sampling every `requestAnimationFrame`: the prepended day goes 1029 →
  1133px (+104) and the day below it 2956 → 3003px (+47) between frame 0 and
  frame 1, then is **stable for at least a second**. Net drift is **+103.5px**
  from an unscrolled start and **−48px** from a scrolled one.
- **The recorded suspect is wrong.** Zero images were hidden by `onError`, a
  `MutationObserver` recorded no DOM additions after the prepend's own cards,
  and `document.fonts.status` is `loaded` with only `Arial, Helvetica,
  sans-serif` in use. So it is neither the image-404 theory this plan first
  carried, nor a web-font swap. It is a pure re-layout one frame after the
  commit, cause not yet identified — and deliberately not chased further,
  because the fix does not depend on knowing it.

That last point is what makes a settle window the right shape of fix rather
than a targeted one: it re-asserts the reference day's position whenever the
list's height changes, without needing to know what changed it.

Because the change lands **one frame** after the commit rather than hundreds of
milliseconds later, a `ResizeObserver` on the list root sees it immediately —
the observer fires on the same layout pass that produced the growth.

**Files:**
- Modify: `frontend/src/components/calendar/EventListWindowed.tsx`
- Test: `frontend/src/__tests__/components/calendar/EventListWindowed.test.tsx`

**Interfaces:**
- Consumes: `daySectionTop` from Task 1.
- Produces: no new exports — the settle window is internal to the component.

- [ ] **Step 1: Write the failing test**

Append to the `upward prepend scroll correction` describe block from Task 1:

```tsx
  it('re-corrects when the prepended region changes height after the commit', async () => {
    // `stubLayout`'s `top` is relative to `window.scrollY`, and a sibling
    // test in this block leaves it nonzero — harmless there, because a delta
    // between two measurements at the same `scrollY` cancels it out, but this
    // test changes `scrollY` partway through and so needs a known start.
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
    stubLayout(100);
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    const resize = installResizeObserverMock();

    const { rerender } = render(
      <EventListWindowed {...baseProps} groupedEvents={makeGroups(['2026-07-02'])}
        resetKey="k" earlierDay="2026-07-01" onShowEarlier={() => {}} />
    );
    fireEvent.click(screen.getByRole('button', { name: /show earlier/i }));
    rerender(
      <EventListWindowed {...baseProps} groupedEvents={makeGroups(['2026-07-01', '2026-07-02'])}
        resetKey="k" earlierDay={null} onShowEarlier={() => {}} />
    );
    expect(scrollBy).toHaveBeenCalledWith(0, 100);

    // `scrollBy` is a bare spy, so it never moves `window.scrollY` — and
    // `stubLayout`'s `top` subtracts `scrollY`. Without simulating the real
    // scroll, every later measurement re-reports the PRE-correction position
    // no matter what changed, which makes the re-assert delta structurally
    // non-negative and a negative expectation unreachable by any conforming
    // implementation. Advance it by hand so the next measurement reflects a
    // page that has actually been corrected once.
    Object.defineProperty(window, 'scrollY', { value: 100, writable: true, configurable: true });

    // Content above the reader changes height one frame late — measured at
    // ~104px of growth in the browser. Modelled here as a 60px shrink so the
    // expected correction is signed and unambiguous: the reference day moves
    // UP by 60, so the re-assert scrolls by -60.
    stubLayout(40);
    resize.trigger();

    expect(scrollBy).toHaveBeenLastCalledWith(0, -60);
  });

  it('stops re-correcting once the reader interacts', async () => {
    stubLayout(100);
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    const resize = installResizeObserverMock();

    const { rerender } = render(
      <EventListWindowed {...baseProps} groupedEvents={makeGroups(['2026-07-02'])}
        resetKey="k" earlierDay="2026-07-01" onShowEarlier={() => {}} />
    );
    fireEvent.click(screen.getByRole('button', { name: /show earlier/i }));
    rerender(
      <EventListWindowed {...baseProps} groupedEvents={makeGroups(['2026-07-01', '2026-07-02'])}
        resetKey="k" earlierDay={null} onShowEarlier={() => {}} />
    );
    scrollBy.mockClear();

    // Any deliberate scroll gesture ends the settle window: a correction
    // applied after the reader has taken over fights them for the viewport,
    // which is strictly worse than the drift it would remove.
    fireEvent.wheel(window);
    stubLayout(70);
    resize.trigger();

    expect(scrollBy).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Write the ResizeObserver test helper**

Create `frontend/src/__tests__/helpers/resizeObserver.ts`:

```ts
import { vi } from 'vitest';
import { act } from '@testing-library/preact';

/**
 * A controllable `ResizeObserver`. jsdom ships none, and jsdom has no layout
 * to observe even if it did — so the tests fire the callback by hand after
 * changing whatever rect stub stands in for layout.
 *
 * `trigger()` fires every observer that has not been disconnected, because a
 * real resize notifies all of them.
 */
export function installResizeObserverMock() {
  const instances: { callback: () => void; disconnected: boolean }[] = [];

  class MockResizeObserver {
    private instance: { callback: () => void; disconnected: boolean };
    constructor(callback: () => void) {
      this.instance = { callback, disconnected: false };
      instances.push(this.instance);
    }
    observe() {}
    unobserve() {}
    disconnect() { this.instance.disconnected = true; }
  }

  vi.stubGlobal('ResizeObserver', MockResizeObserver);

  return {
    trigger() {
      const live = instances.filter(i => !i.disconnected);
      if (live.length === 0) throw new Error('no live ResizeObserver to trigger');
      act(() => { live.forEach(i => i.callback()); });
    },
    get liveCount() { return instances.filter(i => !i.disconnected).length; },
  };
}
```

Import it in the test file:
`import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';`

- [ ] **Step 3: Run the tests to make sure they fail**

Run: `cd frontend && npx vitest run src/__tests__/components/calendar/EventListWindowed.test.tsx -t 're-corrects'`
Expected: FAIL — `scrollBy` is called once only; there is no settle loop.

- [ ] **Step 4: Implement the settle window**

In `EventListWindowed.tsx`, add a ref for the list root and the settle state.
First give the outer `<div className="space-y-4 sm:space-y-6">` a ref:

```tsx
  const listRef = useRef<HTMLDivElement>(null);
```
```tsx
    <div ref={listRef} className="space-y-4 sm:space-y-6">
```

Then add, immediately after the `useLayoutEffect` from Task 1:

```tsx
  // What the reference day's `top` should stay at until the reader takes
  // over. Set by the correction above; cleared by the first deliberate
  // scroll gesture.
  const settleRef = useRef<{ key: string; top: number } | null>(null);

  useEffect(() => {
    const settle = settleRef.current;
    if (!settle) return;
    const root = listRef.current;
    if (!root) return;

    // The correction above is right about *where* the reference day should
    // be — measured, it lands the reference day back on its exact original
    // `top` — and it runs before paint. What it cannot cover is height that
    // arrives afterwards. Measurably, some does: sampling every frame after
    // a prepend, the day above the reader grows ~104px between frame 0 and
    // frame 1 and then holds steady, with no DOM mutation, no font load and
    // no failed image to explain it. Re-asserting the reference day's
    // position on every resize of the list absorbs that without needing to
    // know what caused it — which is the point, because a targeted fix for
    // a cause we have not identified would be a guess.
    const reassert = () => {
      const current = settleRef.current;
      if (!current) return;
      const top = daySectionTop(current.key);
      if (top === null) { settleRef.current = null; return; }
      const delta = top - current.top;
      if (delta !== 0) window.scrollBy(0, delta);
    };

    // Any deliberate scroll gesture ends the settle window. Deliberately NOT
    // the `scroll` event: our own `scrollBy` fires that, so listening to it
    // would cancel the settle window with the very correction that opened
    // it. These three are inputs the reader produces and we never do.
    const stop = () => { settleRef.current = null; };

    const observer = new ResizeObserver(reassert);
    observer.observe(root);
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', stop);
    return () => {
      observer.disconnect();
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
    };
  }, [groupedEvents, resetKey]);
```

and rewrite the Task 1 layout effect so it both arms `settleRef` on success
**and clears it on every early return**:

```tsx
  useLayoutEffect(() => {
    // A settle window belongs to exactly one prepend. Any commit that does
    // not produce a fresh correction ends it — otherwise the window outlives
    // the layout change it was armed for and starts fighting an unrelated
    // one. The reachable case: a reader clicks "Show earlier", then toggles
    // a filter without scrolling, and the new `groupedEvents` still contains
    // the reference day; a surviving `settleRef` would hold that day at its
    // pre-filter-change position against a legitimate new layout.
    const pending = pendingPrependRef.current;
    if (!pending) { settleRef.current = null; return; }
    pendingPrependRef.current = null;
    if (pending.resetKey !== resetKey) { settleRef.current = null; return; }
    const top = daySectionTop(pending.key);
    if (top === null) { settleRef.current = null; return; }
    const delta = top - pending.top;
    if (delta !== 0) window.scrollBy(0, delta);
    // Hold this position against late height changes until the reader
    // scrolls. `pending.top` — not `top` — because that is where the
    // reference day was before the prepend, and putting it back there is
    // the whole point of the correction.
    settleRef.current = { key: pending.key, top: pending.top };
  }, [groupedEvents, resetKey]);
```

`settleRef` must be declared *above* that layout effect for this to compile —
move its declaration up next to `pendingPrependRef`.

Add a regression test for the staleness case: arm the settle window with a
successful prepend, rerender with a **changed `resetKey`** whose `groupedEvents`
still contains the reference day, `resize.trigger()`, and assert no further
`scrollBy`. That commit hits the `!pending` branch, because the prior commit
already consumed `pendingPrependRef`.

Give the describe block a `beforeEach` that resets `window.scrollY` to 0. The
settle tests deliberately move it mid-test, and an unreset global leaking into
the next test is the exact footgun this block already documents.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/components/calendar/EventListWindowed.test.tsx`
Expected: PASS, all tests in the file.

- [ ] **Step 6: Full verification and commit**

```bash
cd frontend && npm run build
cd .. && git add frontend/src/components/calendar/EventListWindowed.tsx \
        frontend/src/__tests__/components/calendar/EventListWindowed.test.tsx \
        frontend/src/__tests__/helpers/resizeObserver.ts
git commit -m "fix(web): hold the prepend correction against late height changes"
git push
```

---

### Task 3: Delete `VITE_NAV_V2` and the legacy list path

Phase 2 shipped dark. This task is the release. The flag is deleted rather than
set, because `VITE_*` flags are **build-time**: flipping one still requires a
redeploy, so it buys no rollback advantage over `git revert`, which the spec
already names as the rollback procedure. Keeping it would instead force every
later task to gate the rail on it and to keep two list containers working.

**Files:**
- Delete: `frontend/src/components/calendar/EventListLegacy.tsx`
- Delete: `frontend/src/lib/featureFlags.ts`
- Delete: `frontend/src/lib/__tests__/featureFlags.test.ts`
- Delete: `frontend/src/__tests__/components/calendar/EventList.legacy.test.tsx`
- Delete: `frontend/src/__tests__/components/calendar/EventList.types.test.tsx`
- Rename: `frontend/src/components/calendar/EventListWindowed.tsx` → `EventList.tsx` (overwriting the dispatcher)
- Rename: `frontend/src/__tests__/components/calendar/EventListWindowed.test.tsx` → `EventList.test.tsx`
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/.env.example`
- Modify: `frontend/src/app/about/aboutContent.ts` (the `web-show-next-day` entry describes a button that no longer exists)

**Interfaces:**
- Produces: `EventList` (was `EventListWindowed`) with props
  `{ groupedEvents: DayGroup[]; resetKey: string; canExpandEnd?: boolean; onExpandEnd?: () => void; earlierDay?: string | null; onShowEarlier?: () => void }`
  plus everything in `Omit<EventListViewProps, 'groups'>`. `navV2`, `dateFilter`,
  `onShowNextDay` and `hasMoreDays` are gone.

- [ ] **Step 1: Verify the flag is not set anywhere in CI or deploy**

Run: `grep -rn "NAV_V2" .github/ scripts/ infrastructure/ 2>/dev/null`
Expected: no output. This confirms deletion changes no workflow — the flag was
never set, so production is running the legacy path and this commit is what
changes that.

- [ ] **Step 2: Move the windowed container into `EventList`**

```bash
cd /Users/bernard/src/chq/chq-calendar/frontend
git rm src/components/calendar/EventListLegacy.tsx \
       src/lib/featureFlags.ts \
       src/lib/__tests__/featureFlags.test.ts \
       src/__tests__/components/calendar/EventList.legacy.test.tsx \
       src/__tests__/components/calendar/EventList.types.test.tsx
git mv -f src/components/calendar/EventListWindowed.tsx src/components/calendar/EventList.tsx
git mv src/__tests__/components/calendar/EventListWindowed.test.tsx \
       src/__tests__/components/calendar/EventList.test.tsx
```

- [ ] **Step 3: Rename the symbols**

In `src/components/calendar/EventList.tsx`, rename `EventListWindowedProps` →
`EventListProps` and `EventListWindowed` → `EventList`, and update the doc
comment's opening line from:

```tsx
 * The list under `VITE_NAV_V2`: a day-granular render window over the day
```

to:

```tsx
 * The event list: a day-granular render window over the day
```

In `src/__tests__/components/calendar/EventList.test.tsx`, update the import and
every `<EventListWindowed` / `EventListWindowedProps` reference to `EventList`.

- [ ] **Step 4: Drop the legacy wiring from the page**

In `frontend/src/app/page.tsx`:

- Remove `import { isNavV2Enabled } from '@/lib/featureFlags';`
- Remove `const navV2 = isNavV2Enabled();` (line 139)
- Remove the `hasMoreDays` memo (lines 186–189) and the `showNextDay` callback
  (lines 194–197). Remove `addDays` from the `dayWindow` import if nothing else
  in the file uses it — Task 10 adds it back, so leave the import line alone if
  removing it is the only change to it.
- In the `navEventDays` memo, drop the `if (!navV2) return [];` guard and remove
  `navV2` from the dependency array.
- Replace the whole `loading ? … : navV2 ? (…) : (…)` ternary (lines 270–288)
  with the single windowed arm:

```tsx
            {loading ? <LoadingSpinner /> : filteredEvents.length === 0 ? <EmptyState /> : (
              <EventList groupedEvents={groupedEvents} expandedDescriptions={filters.expandedDescriptions}
                onToggleDescription={filters.toggleDescription} onToggleTag={filters.toggleTag} isTagSelected={filters.isTagSelected}
                favoriteIds={favorites.favoriteIds} onToggleFavorite={favorites.toggleFavorite}
                weeklyThemes={weeklyThemes} articleLinks={articleLinks} programLinks={programLinks}
                resetKey={listResetKey}
                earlierDay={earlierDay}
                onShowEarlier={showEarlier}
                canExpandEnd={!!laterDay}
                onExpandEnd={expandEnd} />
            )}
```

- [ ] **Step 5: Remove the flag from `.env.example`**

Delete these four lines from `frontend/.env.example`:

```
# Date-navigation phase 2: day-granular list growth, automatic forward
# expansion past the end of the current scope, and a "Show earlier" control.
# When unset or "false", the list behaves exactly as it did before.
VITE_NAV_V2=false
```

- [ ] **Step 6: Update the web guide's now-false claim**

In `frontend/src/app/about/aboutContent.ts`, replace the `web-show-next-day`
entry (around line 355) with the behaviour that actually shipped:

```ts
  { id: 'web-show-more', group: 'Dates & weeks', title: 'The list keeps going', notObvious: true,
    blurb: 'Scroll past the end of what you asked for and the next day loads on its own. Going backwards stays deliberate — a “Show earlier” button at the top names the day it is about to add.' },
```

- [ ] **Step 7: Run the full suite**

Run: `cd frontend && npm run build`
Expected: PASS. If type-check reports an unused import in `page.tsx`, remove it.

- [ ] **Step 8: Confirm the coverage floor still holds**

Run: `cd frontend && npm run test:coverage` (or whatever
`frontend/package.json` names the coverage script — check `scripts` and use it)
Expected: frontend line coverage ≥ **74.3**. This task deletes both code and
tests, so the ratio can move in either direction. If it dropped below the floor,
do **not** lower the floor — add tests to `EventList.test.tsx` for the branches
that lost their legacy-path coverage.

- [ ] **Step 9: Commit**

```bash
git add -A frontend
git commit -m "feat(web): release the day-granular list and delete VITE_NAV_V2"
git push
```

---

### Task 4: Add the `'season'` scope to the window model

The scope set converges on iOS's four. `'season'` is the only new member; `'all'`
already exists and is merely relabelled at the UI layer in Task 5.

**Files:**
- Modify: `frontend/src/hooks/useFilterState.ts:4`
- Modify: `frontend/src/lib/utils/dayWindow.ts:173-250`
- Modify: `frontend/src/hooks/useScrollState.ts` (`handleWeekTap`)
- Test: `frontend/src/__tests__/lib/utils/dayWindow.test.ts`
- Test: `frontend/src/__tests__/hooks/useWeekDragSelection.test.ts`

**Interfaces:**
- Produces: `DateFilter = 'all' | 'today' | 'next' | 'this-week' | 'season'`;
  `WindowOptions.dateFilter` widened to match; `baseWindow` handles `'season'`.
- Consumes: `SeasonWeek = { number: number; start: Date; end: Date; label: string }`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/__tests__/lib/utils/dayWindow.test.ts`. Reuse the file's
existing `seasonWeeks` / `bounds` / `NOW` fixtures:

```ts
describe("baseWindow: 'season'", () => {
  it('spans the first week start to the last week end', () => {
    const w = baseWindow({
      dateFilter: 'season', seasonWeeks, currentWeekNumber, now: NOW, bounds,
    })!;
    expect(w.start).toEqual(seasonWeeks[0].start);
    expect(w.endExclusive).toEqual(seasonWeeks[seasonWeeks.length - 1].end);
    expect(w.startDay).toBe(dayKeyOf(seasonWeeks[0].start));
    expect(w.endDay).toBe(lastDayCovered(seasonWeeks[seasonWeeks.length - 1].end));
  });

  // The season's own dates are the caller's array. Handing them back by
  // reference would let one mutation of a returned window corrupt every
  // later window derived from the same season — the same defensive-copy
  // rule 'all' and 'this-week' already follow.
  it('copies the season dates rather than aliasing seasonWeeks', () => {
    const w = baseWindow({
      dateFilter: 'season', seasonWeeks, currentWeekNumber, now: NOW, bounds,
    })!;
    expect(w.start).not.toBe(seasonWeeks[0].start);
    expect(w.endExclusive).not.toBe(seasonWeeks[seasonWeeks.length - 1].end);
  });

  // Season is absolute, not time-relative, so it is meaningful in an
  // archived year and must not be null there.
  it('is non-null regardless of whether the season is in progress', () => {
    const offSeason = new Date(2026, 0, 15, 12, 0, 0);
    expect(baseWindow({
      dateFilter: 'season', seasonWeeks, currentWeekNumber: null, now: offSeason, bounds,
    })).not.toBeNull();
  });

  it('is widened by navigation exactly as every other scope is', () => {
    const w = viewWindow({
      dateFilter: 'season', seasonWeeks, currentWeekNumber, now: NOW, bounds,
      expandedStartDay: null, expandedEndDay: bounds.endDay,
    })!;
    expect(w.endDay).toBe(bounds.endDay);
  });
});
```

Append to `frontend/src/__tests__/hooks/useWeekDragSelection.test.ts`:

```ts
  it('replaces an active "All Season" filter with the tapped week', () => {
    const { result } = renderHook(() =>
      useHarness({ dateFilter: 'season', selectedWeeks: [], currentWeekNumber: 3 }),
    );
    act(() => { result.current.handleWeekTap(6); });
    expect(result.current.dateFilter).toBe('all');
    expect(result.current.selectedWeeks).toEqual([6]);
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/dayWindow.test.ts src/__tests__/hooks/useWeekDragSelection.test.ts`
Expected: FAIL — TypeScript rejects `'season'` as a `dateFilter`, and the week-tap
test leaves `dateFilter` at `'season'`.

- [ ] **Step 3: Widen the union**

`frontend/src/hooks/useFilterState.ts:4`:

```ts
export type DateFilter = 'all' | 'today' | 'next' | 'this-week' | 'season';
```

`frontend/src/lib/utils/dayWindow.ts`, in `WindowOptions`:

```ts
  dateFilter: 'all' | 'today' | 'next' | 'this-week' | 'season';
```

- [ ] **Step 4: Add the `'season'` case to `baseWindow`**

Insert before the `'this-week'` case in `dayWindow.ts`:

```ts
    case 'season': {
      // The whole season, absolute. Unlike 'next'/'today'/'this-week' this
      // says nothing about *now*, so it is meaningful in an archived year and
      // is never downgraded — which is exactly why the scope set needed it:
      // 'all' was previously the only non-time-relative scope, and it means
      // the whole year, not the season.
      //
      // Copied, not aliased: these `Date`s belong to the caller's
      // `seasonWeeks` array, and returning them by reference would let a
      // mutation of the returned window reach back into it.
      const first = o.seasonWeeks[0];
      const last = o.seasonWeeks[o.seasonWeeks.length - 1];
      return {
        startDay: dayKeyOf(first.start),
        endDay: lastDayCovered(last.end),
        start: new Date(first.start),
        endExclusive: new Date(last.end),
      };
    }
```

- [ ] **Step 5: Teach the week strip that season is a scope to replace**

In `frontend/src/hooks/useScrollState.ts`, in `handleWeekTap`, extend the
relative-filter check:

```ts
    // Touch has no shift/cmd modifiers, so tapping a week while a scope is
    // active should replace that scope with the single tapped week —
    // matching desktop click behavior. 'season' is in this set for the same
    // reason the others are: it is a scope, and scopes are mutually
    // exclusive with the week strip.
    const isRelativeFilterActive =
      dateFilter === 'next' || dateFilter === 'today' || dateFilter === 'this-week'
      || dateFilter === 'season';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/dayWindow.test.ts src/__tests__/hooks/useWeekDragSelection.test.ts`
Expected: PASS.

- [ ] **Step 7: Full verification and commit**

```bash
cd frontend && npm run build
cd .. && git add frontend
git commit -m "feat(web): add the All Season scope to the window model"
git push
```

---

### Task 5: Four scope buttons; retire the This Week button and the `Selected:` line

`Now` · `Today` · `All Season` · `All Year`. `all` stops being only the neutral
"off" state and gains an explicit button, because a reader has no other way to
ask for the whole year once `All Season` exists beside it. The This Week
**button** goes: `isThisWeek` and `isInChautauquaWeek` compute identical bounds,
and tapping the current week on the strip has always been the same operation.
The `Selected: …` line goes because the active-filter chip says the same thing
(Task 6) and D4 spends that vertical space on the rail.

**Files:**
- Modify: `frontend/src/components/filters/DateFilter.tsx`
- Modify: `frontend/src/app/page.tsx` (the `isThisWeekButtonActive` prop is no longer needed)
- Test: `frontend/src/__tests__/components/filters/DateFilter.test.tsx` (create)

**Interfaces:**
- Produces: `DateFilter` component props lose **both** `isThisWeekButtonActive`
  and `currentWeekNumber`. `SelectedFilterInfo` was `currentWeekNumber`'s only
  consumer — `WeekSelector` does not take it, and the current-week highlight
  comes through the `isWeekHighlighted` callback the page owns — so leaving it
  declared would be an unused prop. `seasonWeeks` stays; the week strip needs it.
- Consumes: `DateFilter` type from Task 4.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/components/filters/DateFilter.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { DateFilter } from '@/components/filters/DateFilter';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';

const seasonWeeks = getChautauquaSeasonWeeks(2026);

const weekDrag = {
  isDragging: false,
  handleWeekMouseDown: vi.fn(),
  handleWeekMouseEnter: vi.fn(),
  handleWeekMouseUp: vi.fn(),
  handleWeekTap: vi.fn(),
};

function renderFilter(overrides: Partial<Parameters<typeof DateFilter>[0]> = {}) {
  const setDateFilter = vi.fn();
  const setSelectedWeeks = vi.fn();
  render(
    <DateFilter
      dateFilter="next" setDateFilter={setDateFilter}
      selectedWeeks={[]} setSelectedWeeks={setSelectedWeeks}
      seasonWeeks={seasonWeeks}
      weekDrag={weekDrag}
      isWeekHighlighted={(_n, s) => s}
      showFavoritesOnly={false} onToggleFavoritesOnly={vi.fn()} favoriteCount={0}
      isCurrentYear
      {...overrides}
    />
  );
  return { setDateFilter, setSelectedWeeks };
}

describe('DateFilter scope buttons', () => {
  it('offers exactly the four converged scopes in the current year', () => {
    renderFilter();
    for (const label of ['Now', 'Today', 'All Season', 'All Year']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('no longer offers a This Week button', () => {
    renderFilter();
    expect(screen.queryByRole('button', { name: 'This Week' })).toBeNull();
  });

  it('hides only the time-relative scopes on an archived year', () => {
    renderFilter({ isCurrentYear: false, dateFilter: 'all' });
    expect(screen.queryByRole('button', { name: 'Now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
    // Season and All Year are absolute — they mean the same thing in 2019 as
    // they do this week, so hiding them would strand an archived season with
    // no scope control at all.
    expect(screen.getByRole('button', { name: 'All Season' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All Year' })).toBeTruthy();
  });

  it('selecting a scope clears any selected weeks', () => {
    const { setDateFilter, setSelectedWeeks } = renderFilter({ dateFilter: 'all', selectedWeeks: [4] });
    fireEvent.click(screen.getByRole('button', { name: 'All Season' }));
    expect(setDateFilter).toHaveBeenCalledWith('season');
    expect(setSelectedWeeks).toHaveBeenCalledWith([]);
  });

  it('re-pressing the active scope returns to All Year rather than doing nothing', () => {
    const { setDateFilter } = renderFilter({ dateFilter: 'today' });
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(setDateFilter).toHaveBeenCalledWith('all');
  });

  it('marks All Year active when no scope and no weeks are set', () => {
    renderFilter({ dateFilter: 'all', selectedWeeks: [] });
    expect(screen.getByRole('button', { name: 'All Year' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('does not mark All Year active while weeks are selected', () => {
    renderFilter({ dateFilter: 'all', selectedWeeks: [4] });
    expect(screen.getByRole('button', { name: 'All Year' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('no longer renders the static Selected: line', () => {
    renderFilter({ dateFilter: 'today' });
    expect(screen.queryByText(/^Selected:/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npx vitest run src/__tests__/components/filters/DateFilter.test.tsx`
Expected: FAIL — no `All Season` / `All Year` buttons, `This Week` still present,
`Selected:` still rendered, no `aria-pressed`.

- [ ] **Step 3: Rewrite the component**

Replace `frontend/src/components/filters/DateFilter.tsx` entirely:

```tsx
import type { SeasonWeek } from '@/lib/types';
import type { DateFilter as DateFilterValue } from '@/hooks/useFilterState';
import { WeekSelector } from './WeekSelector';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';

interface DateFilterProps {
  dateFilter: DateFilterValue;
  setDateFilter: (filter: DateFilterValue) => void;
  selectedWeeks: number[];
  setSelectedWeeks: React.Dispatch<React.SetStateAction<number[]>>;
  seasonWeeks: SeasonWeek[];
  weekDrag: {
    isDragging: boolean;
    handleWeekMouseDown: (weekNum: number, e: React.MouseEvent) => void;
    handleWeekMouseEnter: (weekNum: number) => void;
    handleWeekMouseUp: (weekNum: number) => void;
    handleWeekTap: (weekNum: number) => void;
  };
  isWeekHighlighted: (weekNumber: number, isSelected: boolean) => boolean;
  showFavoritesOnly: boolean;
  onToggleFavoritesOnly: () => void;
  favoriteCount: number;
  isCurrentYear: boolean;
  weeklyThemes?: Record<number, WeekTheme>;
}

function DateFilterButton({ label, title, isActive, onClick, ariaLabel }: {
  label: string; title: string; isActive: boolean; onClick: () => void; ariaLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={isActive}
      className={`px-2 py-1 sm:px-4 sm:py-2 rounded-md border transition-all text-xs sm:text-sm whitespace-nowrap ${
        isActive
          ? 'bg-blue-600 text-white border-blue-600'
          : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-gray-600'
      }`}
    >
      {label}
    </button>
  );
}

/**
 * The scope row.
 *
 * Four scopes, converged with iOS: Now · Today · All Season · All Year. The
 * first two are time-relative and are hidden on an archived year, where they
 * mean nothing; the last two are absolute and are always offered, so an
 * archived season is never left without a scope control.
 *
 * There is deliberately no "This Week" button. `isThisWeek` and
 * `isInChautauquaWeek` compute identical bounds, so tapping the current week
 * on the strip has always been the same operation — iOS reached this
 * conclusion first and keeps `.thisWeek` out of `visibleScopes`. The
 * `'this-week'` value stays in the `DateFilter` union so a value persisted in
 * localStorage keeps working and renders as the current week highlighted on
 * the strip.
 */
export function DateFilter({
  dateFilter, setDateFilter, selectedWeeks, setSelectedWeeks,
  seasonWeeks, weekDrag, isWeekHighlighted,
  showFavoritesOnly, onToggleFavoritesOnly, favoriteCount,
  isCurrentYear, weeklyThemes,
}: DateFilterProps) {
  // Selecting a scope clears the weeks; re-pressing the active scope returns
  // to All Year. Both halves of the mutual exclusion iOS already enforces in
  // `setWeekSelection` — the other half (selecting weeks forces the scope to
  // 'all') lives in useScrollState.
  const selectScope = (filter: DateFilterValue) => {
    setDateFilter(dateFilter === filter ? 'all' : filter);
    if (dateFilter !== filter) setSelectedWeeks([]);
  };

  // 'all' means "no date narrowing at all", so a week selection contradicts
  // it even though `dateFilter` is still 'all' underneath.
  const isAllYearActive = dateFilter === 'all' && selectedWeeks.length === 0;

  return (
    <div className="mb-2 sm:mb-4">
      {/* Mobile Week Selector */}
      <div className="mb-2 sm:mb-0 block sm:hidden">
        <div className="flex items-center gap-1 sm:gap-2 justify-start">
          <span className="text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap mr-2">Weeks:</span>
          <WeekSelector
            seasonWeeks={seasonWeeks}
            selectedWeeks={selectedWeeks}
            isDragging={weekDrag.isDragging}
            isWeekHighlighted={isWeekHighlighted}
            onMouseDown={weekDrag.handleWeekMouseDown}
            onMouseEnter={weekDrag.handleWeekMouseEnter}
            onMouseUp={weekDrag.handleWeekMouseUp}
            onTap={weekDrag.handleWeekTap}
            size="sm"
            themes={weeklyThemes}
          />
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto">
        {isCurrentYear && (
          <>
            <DateFilterButton label="Now" title="Events starting from now, through enough days to be worth reading" isActive={dateFilter === 'next'} onClick={() => selectScope('next')} />
            <DateFilterButton label="Today" title="Everything on today" isActive={dateFilter === 'today'} onClick={() => selectScope('today')} />
          </>
        )}
        <DateFilterButton label="All Season" title="The whole Chautauqua season" isActive={dateFilter === 'season'} onClick={() => selectScope('season')} />
        <DateFilterButton label="All Year" title="Every event in this year, in or out of season" isActive={isAllYearActive} onClick={() => selectScope('all')} />
        <DateFilterButton
          label={`★ ${favoriteCount}`}
          title={favoriteCount > 0 ? 'Show favorited events only' : 'No favorites saved yet'}
          isActive={showFavoritesOnly}
          onClick={onToggleFavoritesOnly}
          ariaLabel={showFavoritesOnly ? 'Stop showing favorites only' : 'Show favorites only'}
        />

        {/* Desktop Week Selector */}
        <div className="hidden sm:flex items-center gap-1 sm:gap-2">
          <span className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">Weeks:</span>
          <WeekSelector
            seasonWeeks={seasonWeeks}
            selectedWeeks={selectedWeeks}
            isDragging={weekDrag.isDragging}
            isWeekHighlighted={isWeekHighlighted}
            onMouseDown={weekDrag.handleWeekMouseDown}
            onMouseEnter={weekDrag.handleWeekMouseEnter}
            onMouseUp={weekDrag.handleWeekMouseUp}
            onTap={weekDrag.handleWeekTap}
            size="lg"
            themes={weeklyThemes}
          />
        </div>
      </div>
    </div>
  );
}
```

Note: `selectScope('all')` when `dateFilter` is already `'all'` dispatches
`setDateFilter('all')`, which the reducer's same-value guard turns into a no-op
— it deliberately does **not** clear the window. Clearing the window is the date
chip's job (Task 6).

- [ ] **Step 4: Drop the removed prop at the call site**

In `frontend/src/app/page.tsx`, remove **both** `isThisWeekButtonActive={isThisWeekActive}`
and `currentWeekNumber={currentWeekNumber}` from the `<DateFilter …>` element,
and delete the now-unused `const isThisWeekActive = …` line (line 213). Keep the
`currentWeekNumber` memo itself — `useWeekDragSelection` and the `dateWindow`
derivation both still use it. Leave `isWeekHighlighted` (line 214) alone: the
strip still highlights the current week when a persisted `'this-week'` is in
force, and that closure is where the current week is consulted now.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/components/filters/DateFilter.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 6: Full verification and commit**

```bash
cd frontend && npm run build
cd .. && git add frontend
git commit -m "feat(web): converge the scope set on Now, Today, All Season, All Year"
git push
```

---

### Task 6: The date chip names the actual window, and its ✕ resets it

Once the window grows past the scope's base, the chip that says "When: Now" is
lying — the list runs three days past "now". D3 gives the chip the job of naming
what is actually on screen, and gives its `✕` the job of putting the window back
to the scope's base. The scope-clearing meaning of `✕` is kept for the case
where the window has *not* grown, so the existing escape does not change under
anyone who never navigates.

**Files:**
- Modify: `frontend/src/lib/utils/dayWindow.ts` (add `formatDayRange`)
- Modify: `frontend/src/components/filters/buildActiveChips.ts`
- Modify: `frontend/src/app/page.tsx` (pass the window and `resetWindow`)
- Test: `frontend/src/__tests__/lib/utils/dayWindow.test.ts`
- Test: `frontend/src/__tests__/components/filters/buildActiveChips.test.ts`

**Interfaces:**
- Produces: `formatDayRange(from: DayKey, through: DayKey): string`;
  `buildActiveChips` args gain `windowExpanded: boolean`, `windowStartDay: string | null`,
  `windowEndDay: string | null` — no, see Step 3: they gain
  `viewWindow: ViewWindow | null`, `windowExpanded: boolean`, `resetWindow: () => void`.
- Consumes: `ViewWindow` from `@/lib/utils/dayWindow`; `formatDayLabel` (already exported).

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/__tests__/lib/utils/dayWindow.test.ts`:

```ts
describe('formatDayRange', () => {
  it('names a single day once', () => {
    expect(formatDayRange('2026-07-04', '2026-07-04')).toBe('Sat, Jul 4');
  });

  it('elides the repeated month within one month', () => {
    expect(formatDayRange('2026-07-04', '2026-07-09')).toBe('Sat, Jul 4 – Thu, Jul 9');
  });

  it('keeps both months across a month boundary', () => {
    expect(formatDayRange('2026-07-28', '2026-08-02')).toBe('Tue, Jul 28 – Sun, Aug 2');
  });

  it('returns an empty string for an inverted range rather than a nonsense one', () => {
    expect(formatDayRange('2026-07-09', '2026-07-04')).toBe('');
  });
});
```

Append to `frontend/src/__tests__/components/filters/buildActiveChips.test.ts`
(reuse the file's existing `baseArgs` helper, extending it with the three new
fields):

```ts
describe('date chip and the view window', () => {
  const window = {
    startDay: '2026-07-04', endDay: '2026-07-09',
    start: new Date(2026, 6, 4), endExclusive: new Date(2026, 6, 10),
  };

  it('names the scope while the window is still the scope’s own', () => {
    const chips = buildActiveChips(baseArgs({
      dateFilter: 'next', viewWindow: window, windowExpanded: false,
    }));
    expect(chips.find(c => c.category === 'date')?.label).toBe('Now');
  });

  it('names the actual days once the window has grown past the scope', () => {
    const chips = buildActiveChips(baseArgs({
      dateFilter: 'next', viewWindow: window, windowExpanded: true,
    }));
    expect(chips.find(c => c.category === 'date')?.label).toBe('Sat, Jul 4 – Thu, Jul 9');
  });

  it('clears the scope when the window has not grown', () => {
    const setDateFilter = vi.fn();
    const resetWindow = vi.fn();
    const chips = buildActiveChips(baseArgs({
      dateFilter: 'next', viewWindow: window, windowExpanded: false,
      setDateFilter, resetWindow,
    }));
    chips.find(c => c.category === 'date')!.onRemove();
    expect(setDateFilter).toHaveBeenCalledWith('all');
    expect(resetWindow).not.toHaveBeenCalled();
  });

  // Two distinct escapes, deliberately not conflated: ✕ on a grown window
  // puts the window back to the scope's base and leaves the scope alone.
  it('resets the window without touching the scope once it has grown', () => {
    const setDateFilter = vi.fn();
    const resetWindow = vi.fn();
    const chips = buildActiveChips(baseArgs({
      dateFilter: 'next', viewWindow: window, windowExpanded: true,
      setDateFilter, resetWindow,
    }));
    chips.find(c => c.category === 'date')!.onRemove();
    expect(resetWindow).toHaveBeenCalled();
    expect(setDateFilter).not.toHaveBeenCalled();
  });

  it('shows a date chip for a grown window even on the All Year scope', () => {
    const chips = buildActiveChips(baseArgs({
      dateFilter: 'all', viewWindow: window, windowExpanded: true,
    }));
    expect(chips.find(c => c.category === 'date')?.label).toBe('Sat, Jul 4 – Thu, Jul 9');
  });

  it('shows no date chip on All Year with an untouched window', () => {
    const chips = buildActiveChips(baseArgs({
      dateFilter: 'all', viewWindow: window, windowExpanded: false,
    }));
    expect(chips.find(c => c.category === 'date')).toBeUndefined();
  });

  it('names the new All Season scope', () => {
    const chips = buildActiveChips(baseArgs({
      dateFilter: 'season', viewWindow: window, windowExpanded: false,
    }));
    expect(chips.find(c => c.category === 'date')?.label).toBe('All Season');
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/dayWindow.test.ts src/__tests__/components/filters/buildActiveChips.test.ts`
Expected: FAIL — `formatDayRange` is not exported; `buildActiveChips` rejects the
new args.

- [ ] **Step 3: Add `formatDayRange`**

Append to `frontend/src/lib/utils/dayWindow.ts`:

```ts
/** `"Sat, Jul 4 – Thu, Jul 9"` — how the date chip names the window it covers. */
export function formatDayRange(from: DayKey, through: DayKey): string {
  // An inverted range is not representable as a sentence; an empty string is
  // what the caller can test for. This is defensive rather than expected:
  // `viewWindow` only ever widens, so start <= end holds for every window it
  // returns.
  if (from > through) return '';
  const fmt = (key: DayKey) =>
    startOfDay(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  if (from === through) return fmt(from);
  return `${fmt(from)} – ${fmt(through)}`;
}
```

- [ ] **Step 4: Rewrite the date chip**

In `frontend/src/components/filters/buildActiveChips.ts`, replace the
`DATE_LABELS` map, extend `BuildArgs`, and replace the date-chip block:

```ts
import { formatDayRange, type ViewWindow } from '@/lib/utils/dayWindow';

const DATE_LABELS: Record<Exclude<DateFilter, 'all'>, string> = {
  next: 'Now',
  today: 'Today',
  'this-week': 'This Week',
  season: 'All Season',
};
```

Add to `BuildArgs`:

```ts
  /** The window the list is actually showing, or null if the scope matches nothing. */
  viewWindow: ViewWindow | null;
  /** True once navigation has grown the window past the scope's own bounds. */
  windowExpanded: boolean;
  resetWindow: () => void;
```

Replace the existing `if (args.dateFilter !== 'all') { … }` block with:

```ts
  // Two chips' worth of meaning in one chip, because they are never both
  // true. An untouched window is exactly the scope, so the chip says the
  // scope's name and its ✕ clears the scope — unchanged behaviour for anyone
  // who never navigates. A window that has grown is no longer the scope, so
  // saying "Now" would be a lie about what is on screen; the chip names the
  // days instead and its ✕ puts the window back to the scope's base, leaving
  // the scope alone. That is the first of D3's two distinct escapes; the
  // second is ⟳ Now, which moves the reader without touching any filter.
  if (args.windowExpanded && args.viewWindow) {
    chips.push({
      key: 'date-window',
      category: 'date',
      prefix: 'When',
      label: formatDayRange(args.viewWindow.startDay, args.viewWindow.endDay),
      onRemove: () => args.resetWindow(),
    });
  } else if (args.dateFilter !== 'all') {
    chips.push({
      key: `date-${args.dateFilter}`,
      category: 'date',
      prefix: 'When',
      label: DATE_LABELS[args.dateFilter],
      onRemove: () => args.setDateFilter('all'),
    });
  }
```

- [ ] **Step 5: Wire the page**

In `frontend/src/app/page.tsx`, add to the `buildActiveChips` call and its
dependency array:

```tsx
    viewWindow: dateWindow,
    windowExpanded: filters.windowStartDay !== null || filters.windowEndDay !== null,
    resetWindow: filters.resetWindow,
```
```tsx
    dateWindow, filters.windowStartDay, filters.windowEndDay, filters.resetWindow,
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/dayWindow.test.ts src/__tests__/components/filters/buildActiveChips.test.ts`
Expected: PASS.

- [ ] **Step 7: Full verification and commit**

```bash
cd frontend && npm run build
cd .. && git add frontend
git commit -m "feat(web): the date chip names the window it is actually showing"
git push
```

---

### Task 7: `useDayAnchor` — which day am I looking at, and take me to one

The rail's highlight tracks the topmost day header under the sticky chrome, and
tapping a chip scrolls there. Both are pure view concerns; neither touches
filter state. Implemented with a rAF-throttled `scroll` listener rather than an
`IntersectionObserver`: "the topmost section whose top has passed the sticky
offset" is a *position* question, and IO answers a *visibility* question — it
reports intersection changes, which phase 2 already learned is not the same
thing.

**Files:**
- Create: `frontend/src/hooks/useDayAnchor.ts`
- Test: `frontend/src/__tests__/hooks/useDayAnchor.test.ts`

**Interfaces:**
- Consumes: `daySectionElement`, `daySectionTop` from `@/lib/utils/daySections`.
- Produces:
  ```ts
  export function useDayAnchor(renderedDayKeys: string[]): {
    anchorDay: string | null;
    scrollToDay: (key: string) => void;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/hooks/useDayAnchor.test.ts`:

```ts
import { describe, expect, it, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useDayAnchor } from '@/hooks/useDayAnchor';
import { DAY_SECTION_ATTR } from '@/lib/utils/daySections';

/**
 * jsdom has no layout, so "which section is under the sticky chrome" has to
 * be stated outright: each key is given the viewport-relative top it would
 * have. A test that skipped this would pass on all-zero rects whether or not
 * the hook worked.
 */
function mountWithTops(tops: Record<string, number>) {
  document.body.innerHTML = Object.keys(tops)
    .map(k => `<div ${DAY_SECTION_ATTR}="${k}"></div>`)
    .join('');
  for (const [key, top] of Object.entries(tops)) {
    const el = document.querySelector<HTMLElement>(`[${DAY_SECTION_ATTR}="${key}"]`)!;
    el.getBoundingClientRect = () => ({ top }) as DOMRect;
  }
}

afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('useDayAnchor', () => {
  it('anchors on the last day whose top has passed the sticky offset', () => {
    mountWithTops({ '2026-07-04': -300, '2026-07-05': -20, '2026-07-06': 400 });
    const { result } = renderHook(() => useDayAnchor(['2026-07-04', '2026-07-05', '2026-07-06']));
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(result.current.anchorDay).toBe('2026-07-05');
  });

  it('anchors on the first rendered day when nothing has scrolled past yet', () => {
    mountWithTops({ '2026-07-04': 120, '2026-07-05': 900 });
    const { result } = renderHook(() => useDayAnchor(['2026-07-04', '2026-07-05']));
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(result.current.anchorDay).toBe('2026-07-04');
  });

  it('is null when no day is rendered', () => {
    mountWithTops({});
    const { result } = renderHook(() => useDayAnchor([]));
    expect(result.current.anchorDay).toBeNull();
  });

  it('re-derives without a scroll when the rendered days change', () => {
    mountWithTops({ '2026-07-04': -300, '2026-07-05': -20 });
    const { result, rerender } = renderHook(
      ({ keys }) => useDayAnchor(keys),
      { initialProps: { keys: ['2026-07-04', '2026-07-05'] } }
    );
    expect(result.current.anchorDay).toBe('2026-07-05');
    // A prepend puts an earlier day above the reader without any scroll
    // event: the anchor must follow the content, not wait for a gesture.
    mountWithTops({ '2026-07-03': -700, '2026-07-04': -300, '2026-07-05': 40 });
    rerender({ keys: ['2026-07-03', '2026-07-04', '2026-07-05'] });
    expect(result.current.anchorDay).toBe('2026-07-04');
  });

  it('scrollToDay scrolls the section into view', () => {
    mountWithTops({ '2026-07-04': 0, '2026-07-09': 3000 });
    const scrollIntoView = vi.fn();
    document.querySelector<HTMLElement>(`[${DAY_SECTION_ATTR}="2026-07-09"]`)!.scrollIntoView = scrollIntoView;
    const { result } = renderHook(() => useDayAnchor(['2026-07-04', '2026-07-09']));
    act(() => { result.current.scrollToDay('2026-07-09'); });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
  });

  it('scrollToDay is a no-op for a day that is not mounted', () => {
    mountWithTops({ '2026-07-04': 0 });
    const { result } = renderHook(() => useDayAnchor(['2026-07-04']));
    expect(() => act(() => { result.current.scrollToDay('2026-08-30'); })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npx vitest run src/__tests__/hooks/useDayAnchor.test.ts`
Expected: FAIL — `Failed to resolve import "@/hooks/useDayAnchor"`.

- [ ] **Step 3: Write the hook**

Create `frontend/src/hooks/useDayAnchor.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { daySectionElement } from '@/lib/utils/daySections';

/**
 * How far below the viewport top a day header counts as "the one I'm reading".
 *
 * Read from `--day-rail-h` rather than hardcoded: the rail's height changes
 * with browser text zoom, and a hardcoded offset would put the highlight one
 * day out of step for anyone who zooms — the same reason the sticky offset
 * itself is a custom property.
 */
function stickyOffset(): number {
  if (typeof document === 'undefined') return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--day-rail-h');
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The day the reader is currently looking at, and a way to go to another one.
 *
 * Pure view state. The anchor is derived from scroll position, is never
 * persisted, and never participates in filtering — a navigation control that
 * mutated a filter would put the reader back in the walled-garden this whole
 * initiative exists to escape.
 *
 * Driven by a rAF-throttled `scroll` listener rather than an
 * `IntersectionObserver`. "The last section whose top has passed the sticky
 * chrome" is a question about position; IO answers a question about
 * visibility, and reports only *changes* in it. Phase 2 already paid for
 * that distinction once.
 */
export function useDayAnchor(renderedDayKeys: string[]): {
  anchorDay: string | null;
  scrollToDay: (key: string) => void;
} {
  const [anchorDay, setAnchorDay] = useState<string | null>(null);

  // Serialized so the effect below re-runs when the *contents* change, not on
  // every render that hands down a new array identity.
  const keysId = renderedDayKeys.join(',');

  useEffect(() => {
    if (renderedDayKeys.length === 0) { setAnchorDay(null); return; }

    let frame = 0;
    const measure = () => {
      frame = 0;
      const limit = stickyOffset() + 1;
      // Walk forward and keep the last one that has passed the chrome. The
      // first rendered day is the fallback: before any scroll, nothing has
      // passed, and the reader is plainly looking at the top of the list.
      let next = renderedDayKeys[0];
      for (const key of renderedDayKeys) {
        const el = daySectionElement(key);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= limit) next = key;
        else break;
      }
      setAnchorDay(next);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    // Measure once immediately: a prepend or an auto-expand moves content
    // past the reader without producing any scroll event, and an anchor that
    // waited for a gesture would sit on a day that is no longer on screen.
    measure();
    // Passive: this listener must never delay a scroll.
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysId]);

  const scrollToDay = useCallback((key: string) => {
    // `scroll-margin-top` on the section is what keeps the target from
    // landing underneath the sticky rail — see `globals.css`. Doing the
    // offset arithmetic here instead would duplicate a number CSS already
    // owns and get it wrong at any text zoom.
    daySectionElement(key)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  return { anchorDay, scrollToDay };
}
```

Note on `requestAnimationFrame` in jsdom: it is implemented, and
`@testing-library/preact`'s `act` flushes it. The test's `measure()`-on-mount
path is what the first three assertions exercise; the `scroll` dispatch drives
the same code through the throttle.

If the rAF throttle makes the scroll-dispatch assertions flaky, call `measure()`
directly in `onScroll` when `requestAnimationFrame` is undefined — do **not**
weaken the assertions.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/hooks/useDayAnchor.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Full verification and commit**

```bash
cd frontend && npm run build
cd .. && git add frontend
git commit -m "feat(web): derive the anchor day from scroll position"
git push
```

---

### Task 8: `dayChips` — what a rail chip says

The rail spans the **navigable bounds**, independent of the current scope: it is
a navigation surface, not a filter readout, so in `Today` scope it still shows
the week around you. Chip content is the weekday abbreviation, the day of month,
the month when it changes or on the first chip, and a count of matching events.
An empty day gets the dashed treatment, mirroring iOS's `MyDayChipContent`.

**Files:**
- Modify: `frontend/src/lib/utils/dayWindow.ts`
- Test: `frontend/src/__tests__/lib/utils/dayWindow.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DayChip {
    key: DayKey;
    weekday: string;   // 'Sun'
    dayOfMonth: string; // '4'
    month: string | null; // 'Jul' on the first chip and whenever it changes
    count: number;
    label: string;     // full accessible name: 'Go to Sunday, July 4, 4 events'
  }
  export function dayChips(days: DayKey[], countsByDay: Map<DayKey, number>): DayChip[]
  export function eventCountsByDay(groups: DayCountable[]): Map<DayKey, number>
  ```
- Consumes: nothing new. **`eventCountsByDay` must NOT import `DayGroup`** —
  `eventHelpers.ts:2` already imports `dayKeyOf` from `dayWindow.ts`, so an
  import back the other way is a module cycle. It is declared structurally
  instead (`DayCountable`), which `DayGroup` satisfies without either module
  knowing about the other.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/__tests__/lib/utils/dayWindow.test.ts`:

```ts
describe('dayChips', () => {
  const counts = new Map([['2026-07-04', 12], ['2026-08-01', 3]]);

  it('shows the month on the first chip', () => {
    expect(dayChips(['2026-07-04'], counts)[0].month).toBe('Jul');
  });

  it('omits the month while it has not changed', () => {
    const chips = dayChips(['2026-07-04', '2026-07-05'], counts);
    expect(chips[1].month).toBeNull();
  });

  it('shows the month again when it changes', () => {
    const chips = dayChips(['2026-07-31', '2026-08-01'], counts);
    expect(chips[1].month).toBe('Aug');
  });

  it('carries the weekday abbreviation and day of month', () => {
    const [chip] = dayChips(['2026-07-04'], counts);
    expect(chip.weekday).toBe('Sat');
    expect(chip.dayOfMonth).toBe('4');
  });

  it('carries the count of matching events', () => {
    expect(dayChips(['2026-07-04'], counts)[0].count).toBe(12);
  });

  it('reports zero for a day with no matching events', () => {
    expect(dayChips(['2026-07-06'], counts)[0].count).toBe(0);
  });

  // Controls are labelled by target, never by direction — "next" tells a
  // screen-reader user nothing about where they are going.
  it('labels a chip by its target and its count', () => {
    expect(dayChips(['2026-07-04'], counts)[0].label).toBe('Go to Saturday, July 4, 12 events');
  });

  it('says so when the target day has no matches', () => {
    expect(dayChips(['2026-07-06'], counts)[0].label).toBe('Go to Monday, July 6, no events');
  });

  it('uses the singular for exactly one event', () => {
    expect(dayChips(['2026-08-01'], new Map([['2026-08-01', 1]]))[0].label)
      .toBe('Go to Saturday, August 1, 1 event');
  });
});

describe('eventCountsByDay', () => {
  it('counts each day group’s events under its key', () => {
    const counts = eventCountsByDay([
      { key: '2026-07-04', events: [{}, {}] },
      { key: '2026-07-05', events: [{}] },
    ]);
    expect(counts.get('2026-07-04')).toBe(2);
    expect(counts.get('2026-07-05')).toBe(1);
  });
});
```

Note the fixtures are bare `{ key, events }` objects, not `DayGroup`s — that is
the point of the structural parameter type, and the test would not compile
against them if the signature named `DayGroup`.

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/dayWindow.test.ts -t 'dayChips'`
Expected: FAIL — `dayChips` is not exported.

- [ ] **Step 3: Implement**

Append to `frontend/src/lib/utils/dayWindow.ts`:

```ts
/**
 * The shape `eventCountsByDay` needs from a day group.
 *
 * Declared structurally rather than importing `DayGroup`: `eventHelpers.ts`
 * already imports `dayKeyOf` from this module, so importing back the other
 * way would make a cycle. `DayGroup` satisfies this without either module
 * having to know the other exists.
 */
export interface DayCountable {
  key: DayKey;
  events: unknown[];
}

/** One day on the rail. */
export interface DayChip {
  key: DayKey;
  /** `'Sat'` */
  weekday: string;
  /** `'4'` — no leading zero; this is display text, not a key. */
  dayOfMonth: string;
  /** `'Jul'` on the first chip and whenever the month changes; else `null`. */
  month: string | null;
  /** Matching events on that day under the current non-date filters. */
  count: number;
  /** The full accessible name — labelled by target, never by direction. */
  label: string;
}

/** How many events each day group holds, by day key. */
export function eventCountsByDay(groups: DayCountable[]): Map<DayKey, number> {
  const counts = new Map<DayKey, number>();
  for (const group of groups) counts.set(group.key, group.events.length);
  return counts;
}

export function dayChips(days: DayKey[], countsByDay: Map<DayKey, number>): DayChip[] {
  let lastMonth: string | null = null;
  return days.map((key) => {
    const date = startOfDay(key);
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    // The month rides the first chip and every change after it — without the
    // first-chip rule a rail scrolled to mid-July would show no month at all,
    // which is exactly the disorientation the rail exists to fix.
    const showMonth = month !== lastMonth;
    lastMonth = month;
    const count = countsByDay.get(key) ?? 0;
    const spoken = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const events = count === 0 ? 'no events' : count === 1 ? '1 event' : `${count} events`;
    return {
      key,
      weekday: date.toLocaleDateString('en-US', { weekday: 'short' }),
      dayOfMonth: String(date.getDate()),
      month: showMonth ? month : null,
      count,
      label: `Go to ${spoken}, ${events}`,
    };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/dayWindow.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Full verification and commit**

```bash
cd frontend && npm run build
cd .. && git add frontend
git commit -m "feat(web): derive day-rail chips from the navigable bounds"
git push
```

---

### Task 9: The `DayRail` component

Presentational only: chips in, callbacks out. No scroll logic and no filter
state, so it can be tested without any layout stub.

**Files:**
- Create: `frontend/src/components/calendar/DayRail.tsx`
- Test: `frontend/src/__tests__/components/calendar/DayRail.test.tsx`

**Interfaces:**
- Consumes: `DayChip` from `@/lib/utils/dayWindow` (Task 8).
- Produces:
  ```ts
  export interface DayRailProps {
    chips: DayChip[];
    anchorDay: string | null;
    /** Today's key when the current year is selected; null on an archived one. */
    todayKey: string | null;
    onSelectDay: (key: string) => void;
    onStepDay: (delta: -1 | 1) => void;
    onGoToToday: () => void;
  }
  export function DayRail(props: DayRailProps): JSX.Element | null
  ```

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/components/calendar/DayRail.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { DayRail } from '@/components/calendar/DayRail';
import { dayChips } from '@/lib/utils/dayWindow';

const chips = dayChips(
  ['2026-07-04', '2026-07-05', '2026-07-06'],
  new Map([['2026-07-04', 12], ['2026-07-05', 1]]),
);

function renderRail(overrides: Partial<Parameters<typeof DayRail>[0]> = {}) {
  const props = {
    chips, anchorDay: '2026-07-05', todayKey: '2026-07-05',
    onSelectDay: vi.fn(), onStepDay: vi.fn(), onGoToToday: vi.fn(),
    ...overrides,
  };
  render(<DayRail {...props} />);
  return props;
}

describe('DayRail', () => {
  // role="group" with an aria-label, NOT role="menu" (a menu of navigation
  // targets is not a menu) and not a bare div with an aria-label (which
  // assistive technology drops). Both lessons are already recorded from
  // PR #228/#219.
  it('is a labelled group, not a menu', () => {
    renderRail();
    const rail = screen.getByRole('group', { name: /days/i });
    expect(rail).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('labels each chip by its target and event count', () => {
    renderRail();
    expect(screen.getByRole('button', { name: 'Go to Saturday, July 4, 12 events' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to Monday, July 6, no events' })).toBeTruthy();
  });

  it('marks the anchor day as current', () => {
    renderRail();
    expect(screen.getByRole('button', { name: /July 5/ }).getAttribute('aria-current')).toBe('date');
    expect(screen.getByRole('button', { name: /July 4/ }).getAttribute('aria-current')).toBeNull();
  });

  it('reports the tapped day', () => {
    const { onSelectDay } = renderRail();
    fireEvent.click(screen.getByRole('button', { name: /July 6/ }));
    expect(onSelectDay).toHaveBeenCalledWith('2026-07-06');
  });

  it('steps one calendar day from the chevrons', () => {
    const { onStepDay } = renderRail();
    fireEvent.click(screen.getByRole('button', { name: 'Go to the previous day' }));
    expect(onStepDay).toHaveBeenCalledWith(-1);
    fireEvent.click(screen.getByRole('button', { name: 'Go to the next day' }));
    expect(onStepDay).toHaveBeenCalledWith(1);
  });

  it('disables the chevrons at the ends of the navigable range', () => {
    renderRail({ anchorDay: '2026-07-04' });
    expect(screen.getByRole('button', { name: 'Go to the previous day' })
      .hasAttribute('disabled')).toBe(true);
    renderRail({ anchorDay: '2026-07-06' });
    const forward = screen.getAllByRole('button', { name: 'Go to the next day' }).pop()!;
    expect(forward.hasAttribute('disabled')).toBe(true);
  });

  it('offers ⟳ Now while the anchor is not today', () => {
    const { onGoToToday } = renderRail({ anchorDay: '2026-07-04', todayKey: '2026-07-05' });
    fireEvent.click(screen.getByRole('button', { name: 'Go to today' }));
    expect(onGoToToday).toHaveBeenCalled();
  });

  it('hides ⟳ Now once the anchor is already today', () => {
    renderRail({ anchorDay: '2026-07-05', todayKey: '2026-07-05' });
    expect(screen.queryByRole('button', { name: 'Go to today' })).toBeNull();
  });

  it('hides ⟳ Now entirely on an archived year', () => {
    renderRail({ anchorDay: '2026-07-04', todayKey: null });
    expect(screen.queryByRole('button', { name: 'Go to today' })).toBeNull();
  });

  it('moves focus along the rail with the arrow keys', () => {
    renderRail();
    const first = screen.getByRole('button', { name: /July 4/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('aria-label')).toContain('July 5');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement?.getAttribute('aria-label')).toContain('July 4');
  });

  it('jumps focus to today with Home', () => {
    renderRail({ todayKey: '2026-07-05' });
    const first = screen.getByRole('button', { name: /July 4/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'Home' });
    expect(document.activeElement?.getAttribute('aria-label')).toContain('July 5');
  });

  it('renders nothing when there are no days to show', () => {
    const { container } = render(
      <DayRail chips={[]} anchorDay={null} todayKey={null}
        onSelectDay={vi.fn()} onStepDay={vi.fn()} onGoToToday={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npx vitest run src/__tests__/components/calendar/DayRail.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/calendar/DayRail"`.

- [ ] **Step 3: Write the component**

Create `frontend/src/components/calendar/DayRail.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import type { DayChip } from '@/lib/utils/dayWindow';

export interface DayRailProps {
  chips: DayChip[];
  anchorDay: string | null;
  /** Today's key when the current year is selected; null on an archived one. */
  todayKey: string | null;
  onSelectDay: (key: string) => void;
  onStepDay: (delta: -1 | 1) => void;
  onGoToToday: () => void;
}

/**
 * The day rail — the fine-grained half of D4's two strips, sticky beneath
 * the week strip.
 *
 * Purely presentational: chips in, callbacks out. Scroll position lives in
 * `useDayAnchor`, the window lives in `useFilterState`, and the rail knows
 * about neither — which is what lets it be tested without a layout stub.
 *
 * It spans the navigable bounds, **not** the current scope. It is a
 * navigation surface, not a filter readout: in `Today` scope it still shows
 * the week around you, because "where am I in the season" is the question it
 * exists to answer.
 *
 * Accessibility: `role="group"` with an `aria-label`. Not `role="menu"` — a
 * row of navigation targets is not a menu — and not a bare `<div>` carrying
 * an `aria-label`, which assistive technology drops. Both are recorded
 * lessons from PR #228/#219. Every control is labelled by its **target**
 * ("Go to Sunday, August 16, 4 events"), never by direction, and a day with
 * no matches says so.
 */
export function DayRail({
  chips, anchorDay, todayKey, onSelectDay, onStepDay, onGoToToday,
}: DayRailProps) {
  const stripRef = useRef<HTMLDivElement>(null);

  const anchorIdx = anchorDay ? chips.findIndex(c => c.key === anchorDay) : -1;
  const canStepBack = anchorIdx > 0;
  const canStepForward = anchorIdx >= 0 && anchorIdx < chips.length - 1;

  // Keep the highlighted chip in view as the reader scrolls the list. The
  // rail scrolls itself horizontally; it never scrolls the page.
  useEffect(() => {
    if (!anchorDay) return;
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-chip="${anchorDay}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [anchorDay]);

  // Left/Right move focus along the rail, Home jumps to today. Focus only —
  // activating is Enter/Space on the focused chip, which a <button> already
  // does. Moving the window on mere focus would make arrowing through the
  // rail refilter the list on every keystroke.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const strip = stripRef.current;
    if (!strip) return;
    const buttons = Array.from(strip.querySelectorAll<HTMLElement>('[data-chip]'));
    const current = buttons.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = Math.min(current + 1, buttons.length - 1);
    else if (e.key === 'ArrowLeft') next = Math.max(current - 1, 0);
    else if (e.key === 'Home') next = todayKey ? buttons.findIndex(b => b.dataset.chip === todayKey) : 0;
    else return;
    if (next < 0) return;
    e.preventDefault();
    buttons[next].focus();
  };

  if (chips.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Days"
      data-day-rail
      onKeyDown={onKeyDown}
      className="sticky top-0 z-20 flex items-center gap-1 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-1 py-1"
    >
      <button
        type="button"
        aria-label="Go to the previous day"
        disabled={!canStepBack}
        onClick={() => onStepDay(-1)}
        className="shrink-0 px-2 py-1 text-gray-600 dark:text-gray-300 disabled:opacity-30 disabled:cursor-default"
      >
        ‹
      </button>

      <div ref={stripRef} className="flex-1 flex items-center gap-1 overflow-x-auto scrollbar-hide">
        {chips.map((chip) => {
          const isAnchor = chip.key === anchorDay;
          return (
            <button
              key={chip.key}
              type="button"
              data-chip={chip.key}
              aria-label={chip.label}
              aria-current={isAnchor ? 'date' : undefined}
              onClick={() => onSelectDay(chip.key)}
              className={`shrink-0 min-w-11 px-2 py-1 rounded-md text-center leading-tight transition-colors ${
                isAnchor
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-gray-700'
              } ${
                // An empty day is still navigable — it is a calendar day, and
                // the rail steps by calendar days. The dashed border says
                // "nothing here" without removing the target, mirroring
                // iOS's MyDayChipContent.isEmpty.
                chip.count === 0 ? 'border border-dashed border-gray-300 dark:border-gray-600' : 'border border-transparent'
              }`}
            >
              {chip.month && (
                <span className="block text-[10px] font-semibold uppercase opacity-70">{chip.month}</span>
              )}
              <span className="block text-[10px] uppercase opacity-70" aria-hidden="true">{chip.weekday}</span>
              <span className="block text-sm font-semibold" aria-hidden="true">{chip.dayOfMonth}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        aria-label="Go to the next day"
        disabled={!canStepForward}
        onClick={() => onStepDay(1)}
        className="shrink-0 px-2 py-1 text-gray-600 dark:text-gray-300 disabled:opacity-30 disabled:cursor-default"
      >
        ›
      </button>

      {/*
        ⟳ Now is navigation, never a filter change: it moves the reader to
        today and widens the window if today is not in it, and touches no
        scope, week, category or search. Hidden once the anchor is already
        today, and absent entirely on an archived year, where "today" is not
        a place in the season being read.
      */}
      {todayKey && anchorDay !== todayKey && (
        <button
          type="button"
          aria-label="Go to today"
          onClick={onGoToToday}
          className="shrink-0 px-2 py-1 text-sm rounded-md bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-gray-600"
        >
          ⟳ Now
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/components/calendar/DayRail.test.tsx`
Expected: PASS, 12 tests.

- [ ] **Step 5: Full verification and commit**

```bash
cd frontend && npm run build
cd .. && git add frontend
git commit -m "feat(web): add the day rail component"
git push
```

---

### Task 10: Wire the rail into the page

`GO_TO_DAY` in the spec expands the window to *contain* the target day and does
nothing else; the scroll that follows is `useDayAnchor`'s job. That decomposes
into the two `EXPAND_WINDOW_*` actions the reducer already has, so no new
reducer action is needed — expand toward whichever edge the target falls
outside, then scroll.

**Files:**
- Create: `frontend/src/hooks/useDayRailHeight.ts`
- Modify: `frontend/src/app/page.tsx`
- Test: `frontend/src/__tests__/hooks/useDayRailHeight.test.ts`
- Test: `frontend/src/__tests__/components/calendar/dayRailIntegration.test.tsx` (create)

**Interfaces:**
- Consumes: `dayChips`, `eventCountsByDay`, `dayKeys`, `addDays`, `dayKeyOf`
  from `@/lib/utils/dayWindow`; `useDayAnchor` (Task 7); `DayRail` (Task 9).
- Produces: `useDayRailHeight(): (el: HTMLElement | null) => void` — a callback
  ref that keeps `--day-rail-h` on `document.documentElement` in sync.

- [ ] **Step 1: Write the failing test for the height observer**

Create `frontend/src/__tests__/hooks/useDayRailHeight.test.ts`:

```ts
import { describe, expect, it, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useDayRailHeight } from '@/hooks/useDayRailHeight';
import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';

afterEach(() => { vi.unstubAllGlobals(); document.documentElement.style.removeProperty('--day-rail-h'); });

describe('useDayRailHeight', () => {
  it('publishes the rail height as a custom property', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useDayRailHeight());
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ height: 56 }) as DOMRect;
    act(() => { result.current(el); });
    expect(document.documentElement.style.getPropertyValue('--day-rail-h')).toBe('56px');
  });

  it('republishes when the rail resizes', () => {
    const resize = installResizeObserverMock();
    const { result } = renderHook(() => useDayRailHeight());
    const el = document.createElement('div');
    let height = 56;
    el.getBoundingClientRect = () => ({ height }) as DOMRect;
    act(() => { result.current(el); });
    // Browser text zoom grows the chips; a hardcoded offset would leave every
    // scroll target landing underneath the rail from here on.
    height = 84;
    resize.trigger();
    expect(document.documentElement.style.getPropertyValue('--day-rail-h')).toBe('84px');
  });

  it('drops back to zero when the rail unmounts', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useDayRailHeight());
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ height: 56 }) as DOMRect;
    act(() => { result.current(el); });
    act(() => { result.current(null); });
    expect(document.documentElement.style.getPropertyValue('--day-rail-h')).toBe('0px');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npx vitest run src/__tests__/hooks/useDayRailHeight.test.ts`
Expected: FAIL — `Failed to resolve import "@/hooks/useDayRailHeight"`.

- [ ] **Step 3: Write the hook**

Create `frontend/src/hooks/useDayRailHeight.ts`:

```ts
import { useCallback, useRef } from 'react';

const PROPERTY = '--day-rail-h';

/**
 * Publishes the rail's measured height as `--day-rail-h` on `:root`.
 *
 * Three unrelated things need this number: the day headers' own sticky
 * `top`, every day section's `scroll-margin-top`, and `useDayAnchor`'s
 * sticky offset. Hardcoding it would put all three one text-zoom step out of
 * true — the gotcha #225 called out by name — so it is measured rather than
 * declared, and re-measured on every resize.
 *
 * Returned as a **callback ref** rather than an effect over an object ref so
 * it fires on mount, on unmount, and on any element swap, with no dependency
 * array to get wrong.
 */
export function useDayRailHeight() {
  const observerRef = useRef<ResizeObserver | null>(null);

  return useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!el) {
      // No rail (an archived year with no navigable days, or a render
      // before mount) means no offset — not a stale one from last render.
      document.documentElement.style.setProperty(PROPERTY, '0px');
      return;
    }

    const publish = () => {
      document.documentElement.style.setProperty(
        PROPERTY, `${el.getBoundingClientRect().height}px`
      );
    };
    publish();

    // `ResizeObserver` is absent in some older browsers and in jsdom without
    // a stub. Publishing once is still correct there; only zoom-time updates
    // are lost, which is strictly better than throwing on mount.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    observerRef.current = observer;
  }, []);
}
```

- [ ] **Step 4: Run the hook tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/hooks/useDayRailHeight.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing integration test**

Create `frontend/src/__tests__/components/calendar/dayRailIntegration.test.tsx`.
This pins the *wiring rules* — the parts that are pure logic and therefore
testable in jsdom. Geometry is Task 12's job.

```tsx
import { describe, expect, it } from 'vitest';
import { railTarget } from '@/app/dayRailNavigation';

describe('railTarget', () => {
  const bounds = { startDay: '2026-06-27', endDay: '2026-08-30' };

  it('expands the start when the target is before the window', () => {
    expect(railTarget({ target: '2026-07-01', window: { startDay: '2026-07-04', endDay: '2026-07-09' }, bounds }))
      .toEqual({ expandStart: '2026-07-01', expandEnd: null, scrollTo: '2026-07-01' });
  });

  it('expands the end when the target is after the window', () => {
    expect(railTarget({ target: '2026-07-20', window: { startDay: '2026-07-04', endDay: '2026-07-09' }, bounds }))
      .toEqual({ expandStart: null, expandEnd: '2026-07-20', scrollTo: '2026-07-20' });
  });

  // D1: stepping scrolls if it can, and widens only if it must. A target
  // already inside the window is a scroll and nothing else — dispatching an
  // expansion for it would refilter the whole list for no reason and, worse,
  // mark the window "expanded" so the date chip starts naming a range the
  // reader never asked for.
  it('only scrolls when the target is already inside the window', () => {
    expect(railTarget({ target: '2026-07-06', window: { startDay: '2026-07-04', endDay: '2026-07-09' }, bounds }))
      .toEqual({ expandStart: null, expandEnd: null, scrollTo: '2026-07-06' });
  });

  it('refuses a target outside the navigable bounds', () => {
    expect(railTarget({ target: '2026-12-25', window: { startDay: '2026-07-04', endDay: '2026-07-09' }, bounds }))
      .toBeNull();
  });

  it('handles a null window by expanding both edges to the target', () => {
    // Reachable for 'this-week' outside the season, where the scope matches
    // nothing at all and there is no window to compare against.
    expect(railTarget({ target: '2026-07-06', window: null, bounds }))
      .toEqual({ expandStart: '2026-07-06', expandEnd: '2026-07-06', scrollTo: '2026-07-06' });
  });
});
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `cd frontend && npx vitest run src/__tests__/components/calendar/dayRailIntegration.test.tsx`
Expected: FAIL — `Failed to resolve import "@/app/dayRailNavigation"`.

- [ ] **Step 7: Write the navigation rule**

Create `frontend/src/app/dayRailNavigation.ts`:

```ts
import type { DayKey, NavigableBounds, ViewWindow } from '@/lib/utils/dayWindow';

export interface RailTargetInput {
  target: DayKey;
  window: Pick<ViewWindow, 'startDay' | 'endDay'> | null;
  bounds: NavigableBounds;
}

export interface RailTarget {
  expandStart: DayKey | null;
  expandEnd: DayKey | null;
  scrollTo: DayKey;
}

/**
 * What tapping a rail chip does: D1, expressed once.
 *
 * *Take me to that day.* If it is already in the loaded window this is a
 * scroll and nothing more; if it lies past an edge, that edge grows to
 * include it and then we scroll. The window only ever grows — the scope
 * button you started from is what shrinks it back — so "widen or move" never
 * arises.
 *
 * Returns `null` for a target outside the navigable bounds. The reducer
 * would clamp such a value anyway, but clamping would move the window to an
 * edge and then scroll to a day that is not there; refusing is honest.
 */
export function railTarget(o: RailTargetInput): RailTarget | null {
  if (o.target < o.bounds.startDay || o.target > o.bounds.endDay) return null;
  if (!o.window) {
    // The scope matches nothing (off-season 'this-week'), so there is no
    // window to compare against — open one on the target itself.
    return { expandStart: o.target, expandEnd: o.target, scrollTo: o.target };
  }
  return {
    expandStart: o.target < o.window.startDay ? o.target : null,
    expandEnd: o.target > o.window.endDay ? o.target : null,
    scrollTo: o.target,
  };
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/components/calendar/dayRailIntegration.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 9: Let the list reveal a day the render window has not reached**

Widening the *view* window is not enough to scroll to a day. The **render**
window only grows forward from its anchor, one sentinel step at a time, so a
chip tapped ten days ahead produces a day group that exists in `groupedEvents`
and has no DOM node — and `scrollToDay` would silently do nothing. The render
window needs to be told to reach that day.

Write the failing test first. Append to
`frontend/src/__tests__/components/calendar/EventList.test.tsx`:

```tsx
describe('revealDay', () => {
  it('mounts through to a day past the render window', () => {
    // 20 single-event days: the initial 50-event fill stops well short of the
    // end, so 2026-07-20 is in groupedEvents but not in the DOM.
    const keys = Array.from({ length: 20 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);
    const { container, rerender } = render(
      <EventList {...baseProps} groupedEvents={makeGroups(keys)} resetKey="k" />
    );
    expect(container.querySelector(`[${DAY_SECTION_ATTR}="2026-07-20"]`)).toBeNull();

    rerender(
      <EventList {...baseProps} groupedEvents={makeGroups(keys)} resetKey="k" revealDay="2026-07-20" />
    );
    expect(container.querySelector(`[${DAY_SECTION_ATTR}="2026-07-20"]`)).not.toBeNull();
  });

  it('never shrinks the render window back', () => {
    const keys = Array.from({ length: 20 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);
    const { container, rerender } = render(
      <EventList {...baseProps} groupedEvents={makeGroups(keys)} resetKey="k" revealDay="2026-07-20" />
    );
    // Revealing an earlier day must not unmount what revealing a later one
    // already brought in — growth is one-way, and the reader may be reading
    // any of it.
    rerender(
      <EventList {...baseProps} groupedEvents={makeGroups(keys)} resetKey="k" revealDay="2026-07-02" />
    );
    expect(container.querySelector(`[${DAY_SECTION_ATTR}="2026-07-20"]`)).not.toBeNull();
  });

  it('ignores a reveal target that is not in the day groups', () => {
    const keys = ['2026-07-01', '2026-07-02'];
    expect(() => render(
      <EventList {...baseProps} groupedEvents={makeGroups(keys)} resetKey="k" revealDay="2026-09-09" />
    )).not.toThrow();
  });
});
```

Run: `cd frontend && npx vitest run src/__tests__/components/calendar/EventList.test.tsx -t 'revealDay'`
Expected: FAIL — `revealDay` is not a prop.

Then add the prop to `frontend/src/components/calendar/EventList.tsx`. In
`EventListProps`:

```tsx
  /**
   * A day the render window must reach, whatever its own growth has managed.
   *
   * The render window grows forward one sentinel step at a time, so a rail
   * chip tapped ten days ahead widens the *view* window and still has no DOM
   * node to scroll to. This is the one input that lets navigation outrun
   * scrolling. It only ever grows the window — revealing an earlier day is a
   * no-op, because the reader may be reading anything already mounted.
   */
  revealDay?: string | null;
```

and immediately after the existing latch effect:

```tsx
  useEffect(() => {
    if (!revealDay) return;
    const idx = groupedEvents.findIndex(g => g.key === revealDay);
    // Not in the groups at all: the day has no matching events, so there is
    // nothing to reveal and nothing to wait for.
    if (idx < 0) return;
    if (idx <= endIdx) return;
    setAnchor({ key: revealDay, resetKey });
  }, [revealDay, groupedEvents, endIdx, resetKey]);
```

Add `revealDay` to the destructured props.

Run: `cd frontend && npx vitest run src/__tests__/components/calendar/EventList.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 10: Wire it all into `page.tsx`**

Add the imports:

```tsx
import { navigableBounds, viewWindow, addDays, dayKeyOf, dayKeys, dayChips, eventCountsByDay, eventDayKeys, navigationTargets } from '@/lib/utils/dayWindow';
import { useDayAnchor } from '@/hooks/useDayAnchor';
import { useDayRailHeight } from '@/hooks/useDayRailHeight';
import { DayRail } from '@/components/calendar/DayRail';
import { railTarget } from '@/app/dayRailNavigation';
```

Add after the `groupedEvents` memo:

```tsx
  // The rail spans the navigable bounds, independent of the current scope:
  // it is a navigation surface, not a filter readout, so in Today scope it
  // still shows the week around you.
  const railChips = useMemo(
    () => dayChips(dayKeys(navBounds.startDay, navBounds.endDay), eventCountsByDay(groupedEvents)),
    [navBounds, groupedEvents]
  );

  const renderedDayKeys = useMemo(() => groupedEvents.map(g => g.key), [groupedEvents]);
  const { anchorDay, scrollToDay } = useDayAnchor(renderedDayKeys);
  const railRef = useDayRailHeight();

  const todayKey = isCurrentYear ? dayKeyOf(new Date()) : null;

  // Expanding, then scrolling, is deliberately three steps, and each waits on
  // the one before: the reducer widens the *view* window (it never knows about
  // scroll position), `revealDay` makes the *render* window mount that far,
  // and only then can we scroll to a node that exists. `pendingScroll` is
  // state rather than a ref precisely because it has to drive `revealDay` as
  // a prop — a ref would not re-render the list.
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);

  const goToDay = useCallback((target: string) => {
    const plan = railTarget({ target, window: dateWindow, bounds: navBounds });
    if (!plan) return;
    if (plan.expandStart) filters.expandWindowStart(plan.expandStart);
    if (plan.expandEnd) filters.expandWindowEnd(plan.expandEnd);
    // Set it even when no expansion was needed: the day is inside the view
    // window but may still be past the render window's current reach, and
    // `revealDay` is what closes that gap. The effect below scrolls and
    // clears on the very next commit if the node is already there.
    setPendingScroll(plan.scrollTo);
  }, [dateWindow, navBounds, filters.expandWindowStart, filters.expandWindowEnd]);

  useEffect(() => {
    if (!pendingScroll) return;
    if (groupedEvents.some(g => g.key === pendingScroll)) {
      setPendingScroll(null);
      scrollToDay(pendingScroll);
      return;
    }
    // Not in the day groups. Two very different reasons, and only one is
    // worth waiting for.
    //
    // If the view window already covers the target, the day simply has no
    // matching events — an empty day under the current filters. That is not a
    // failure; it is what "the rail moves by calendar day" means. Give up, or
    // the pending target would survive forever and hijack a later commit.
    //
    // If the window does not cover it yet, the expansion dispatched above has
    // not landed in this commit. Keep waiting — the next one will have it.
    const covered = dateWindow
      && pendingScroll >= dateWindow.startDay && pendingScroll <= dateWindow.endDay;
    if (covered) setPendingScroll(null);
  }, [pendingScroll, groupedEvents, dateWindow, scrollToDay]);

  const stepDay = useCallback((delta: -1 | 1) => {
    if (!anchorDay) return;
    goToDay(addDays(anchorDay, delta));
  }, [anchorDay, goToDay]);

  // ⟳ Now is navigation, never a filter change: it widens the window to
  // contain today if it has to, and touches no scope, week, category or
  // search.
  const goToToday = useCallback(() => {
    if (todayKey) goToDay(todayKey);
  }, [todayKey, goToDay]);
```

Render the rail immediately above the list card, inside `<main>`:

```tsx
        <div ref={railRef}>
          <DayRail
            chips={railChips}
            anchorDay={anchorDay}
            todayKey={todayKey}
            onSelectDay={goToDay}
            onStepDay={stepDay}
            onGoToToday={goToToday}
          />
        </div>
```

and pass the reveal target to the list, adding to the existing `<EventList …>`
element from Task 3:

```tsx
                revealDay={pendingScroll}
```

`useState` must be added to the `'react'` import at the top of `page.tsx`.

- [ ] **Step 11: Full verification and commit**

```bash
cd frontend && npm run build
cd .. && git add frontend
git commit -m "feat(web): wire the day rail to the window and the list"
git push
```

---

### Task 11: Sticky stacking — the day headers move out from under the rail

Three stacked sticky layers on a small viewport is risk #4 in the spec. The
headers are already `sticky top-0`; with a sticky rail above them they overlap.
Every scroll target also needs `scroll-margin-top`, or it lands underneath the
rail — the gotcha #225 called out by name.

**Files:**
- Modify: `frontend/src/app/globals.css`
- Modify: `frontend/src/components/calendar/EventListView.tsx`
- Test: `frontend/src/__tests__/components/calendar/EventListView.sticky.test.tsx` (create)

**Interfaces:**
- Consumes: `--day-rail-h` published by `useDayRailHeight` (Task 10).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/components/calendar/EventListView.sticky.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/preact';
import { EventListView } from '@/components/calendar/EventListView';
import { DAY_SECTION_ATTR } from '@/lib/utils/daySections';

const groups = [
  { key: '2026-07-04', baseLabel: 'Saturday, July 4, 2026', weekNumbers: [2], events: [] },
];

function renderView() {
  return render(
    <EventListView groups={groups as never} expandedDescriptions={new Set()}
      onToggleDescription={() => {}} onToggleTag={() => {}} isTagSelected={() => false}
      favoriteIds={new Set()} onToggleFavorite={() => {}} />
  );
}

describe('EventListView sticky stacking', () => {
  // jsdom computes no layout, so this asserts the *declaration* — that the
  // offset is expressed in terms of the measured custom property rather than
  // a hardcoded pixel value. Whether the result actually clears the rail at a
  // given text zoom is a browser question, checked in the phase's manual pass.
  it('offsets the day header by the measured rail height', () => {
    const { container } = renderView();
    const header = container.querySelector<HTMLElement>('.sticky')!;
    expect(header.style.top).toBe('var(--day-rail-h)');
  });

  it('gives the section a scroll margin so a scroll target clears the rail', () => {
    const { container } = renderView();
    const section = container.querySelector<HTMLElement>(`[${DAY_SECTION_ATTR}]`)!;
    expect(section.style.scrollMarginTop).toBe('var(--day-rail-h)');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npx vitest run src/__tests__/components/calendar/EventListView.sticky.test.tsx`
Expected: FAIL — both `style` values are empty strings.

- [ ] **Step 3: Declare the default**

In `frontend/src/app/globals.css`, after the `@import "tailwindcss";` line, add:

```css
:root {
  /*
   * The measured height of the sticky day rail, republished on every resize
   * by `useDayRailHeight`. Declared here so the day headers and every scroll
   * target have a sane value on the first paint, before the rail has
   * mounted and measured — and so a page that renders no rail at all (an
   * archived year with no navigable days) still resolves the property.
   */
  --day-rail-h: 0px;
}
```

- [ ] **Step 4: Apply the offsets**

In `frontend/src/components/calendar/EventListView.tsx`, change the section
wrapper and its header:

```tsx
        <div
          key={dayGroup.key}
          {...{ [DAY_SECTION_ATTR]: dayGroup.key }}
          // Without this, `scrollIntoView({ block: 'start' })` puts the day
          // header exactly at the viewport top — underneath the sticky rail.
          // Expressed as the measured custom property rather than a pixel
          // literal so it stays right at any browser text zoom.
          style={{ scrollMarginTop: 'var(--day-rail-h)' }}
        >
          <div
            className="sticky bg-white dark:bg-gray-800 z-10 border-b border-gray-200 dark:border-gray-700 pb-1 sm:pb-2 mb-2 sm:mb-4"
            // `top-0` is dropped from the class list in favour of this: two
            // sticky layers both pinned at 0 overlap, and the header is the
            // one that has to give way. `z-10` keeps it below the rail's
            // `z-20`.
            style={{ top: 'var(--day-rail-h)' }}
          >
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/components/calendar/EventListView.sticky.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Full verification and commit**

```bash
cd frontend && npm run build
cd .. && git add frontend
git commit -m "feat(web): stack the day headers under the sticky rail"
git push
```

---

### Task 12: About copy on both guides, and the manual browser pass

The web guide currently promises "Three buttons cover the questions people
actually ask" and a "Show next day" button. Both are false after this phase. The
guide copy is a deliverable, not a comment.

Then the part no jsdom test can do: this phase's whole risk surface is geometry,
and jsdom computes none. Phase 2's browser pass found a 3,903px jump that three
green unit tests had no opinion about.

**Files:**
- Modify: `frontend/src/app/about/aboutContent.ts`
- Modify: `docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md` (status banner)

- [ ] **Step 1: Update the web guide's Dates & weeks group**

In `frontend/src/app/about/aboutContent.ts`, replace the `web-date-quick` entry
and add the rail:

```ts
  { id: 'web-date-quick', group: 'Dates & weeks', title: 'Now, Today, All Season, or All Year',
    blurb: 'Four scopes cover the questions people actually ask — and the same four the iPhone app uses, so your laptop and your phone speak the same vocabulary.' },
  { id: 'web-day-rail', group: 'Dates & weeks', title: 'A day rail under the week strip', notObvious: true,
    blurb: 'A strip of days that highlights whichever day you have scrolled to. Tap one to jump there, or use the chevrons to move a single day at a time — including days with nothing on them.' },
  { id: 'web-go-to-today', group: 'Dates & weeks', title: '⟳ Now takes you back to today', notObvious: true,
    blurb: 'Wherever you have wandered in the season, one tap returns you to today without changing a single filter.' },
```

- [ ] **Step 2: Check the web scenarios for the same claims**

Run: `grep -n "This Week\|three buttons\|Three buttons\|Show next day" frontend/src/app/about/aboutContent.ts`
Expected: no hits. If any survive in `WEB_SCENARIOS` prose, rewrite them to
describe the four scopes and the rail. Do **not** touch the `ios-` entries —
those describe iOS as it stands today, and the iOS rail is phase 3b.

- [ ] **Step 3: Run the guide tests**

Run: `cd frontend && npx vitest run src/app/about`
Expected: PASS. The `aboutContent` suite enforces unique ids, non-empty
titles/blurbs, and group ordering; a new id must not collide with an existing one.

- [ ] **Step 4: Full verification**

Run: `cd frontend && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit the copy**

```bash
git add frontend/src/app/about/aboutContent.ts
git commit -m "docs(about): document the four scopes and the day rail on the web guide"
git push
```

- [ ] **Step 6: Run the dev server and do the manual pass**

```bash
cd frontend && npm run dev
```

Then visit `http://localhost:3000` and check each of these. **Record the actual
observed number or behaviour next to each, not a tick.** Anything that fails
goes back to the task that owns it.

1. **Scopes.** All four buttons render; `Now` and `Today` disappear when an
   archived year is selected in the header; `All Season` and `All Year` do not.
2. **Mutual exclusion.** Pressing a scope clears the week strip; selecting a week
   clears the scope highlight. Shift-click and ⌘-click ranges on the strip still
   work (`useScrollState.ts:87-181` was not touched, so this is a regression
   check, not a new feature).
3. **`'this-week'` migration.** In DevTools, set
   `localStorage['chq-calendar-user-state']` to a payload with
   `"dateFilter":"this-week"` and `"lastSaved":Date.now()`, reload, and confirm
   the current week is highlighted on the strip and the list is filtered to it,
   with no This Week button anywhere.
4. **Show earlier, no scroll.** Load the page, and *without scrolling at all*
   press "Show earlier". Nothing already on screen may unmount, and the day you
   were reading must not move. This is the exact case that produced the 3,903px
   jump in phase 2.
5. **Show earlier, scrolled.** Scroll a few days down, press "Show earlier", and
   measure the drift: note `window.scrollY` and the reading position before and
   after. **Target is 0px.** If it is not, the residual is Task 2's, and the
   settle window either was skipped or is not firing — check whether the drift
   coincides with a broken image disappearing.
6. **Auto-expand forward.** Scroll to the bottom of a `Today` scope and confirm
   the next day loads on its own, with no button, and that the date chip stops
   saying "Today" and starts naming the actual range.
7. **Chip escapes.** With a grown window, the date chip's `✕` returns the list
   to the scope's base without changing the scope. With an untouched window, the
   chip's `✕` still clears the scope.
8. **Rail highlight tracks scroll.** Scroll slowly through several days; the
   highlighted chip changes exactly when the corresponding day header reaches
   the bottom of the rail — not one day early, not one late.
9. **Rail tap.** Tap a chip several days ahead. The list widens, then scrolls, and
   the target day's header lands **below** the rail with its text fully visible.
   Repeat with a chip *behind* you.
10. **Chevrons.** `‹` and `›` move exactly one calendar day, including onto a day
    with no events (which renders as an empty day, not a skip). Both disable at
    the season edges.
11. **⟳ Now.** Wander several days away, press it, and confirm you land on today
    with the scope, weeks, categories and search all unchanged. Confirm it
    disappears once you are on today, and is absent entirely on an archived year.
12. **Sticky stack at 320px and at 200% text zoom.** Narrow the viewport to
    320px: rail, day header and cards must not overlap. Then set browser zoom to
    200% and repeat items 8 and 9 — this is what `--day-rail-h` exists for, and a
    hardcoded offset would pass at 100% and fail here.
13. **Keyboard.** Tab into the rail; Left/Right move focus without refiltering,
    Enter activates, Home jumps to today.
14. **Screen reader.** With VoiceOver on, confirm the rail announces as a group
    named "Days", that a chip announces its full target and count, and that an
    empty day says "no events".

- [ ] **Step 7: Update the spec's status banner**

Replace the first paragraph of
`docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md`
with the shipped state — that phases 0, 1a, 1b, 2 and **3a (web)** are merged,
that `VITE_NAV_V2` is deleted and the legacy list container with it, and what
the browser pass measured for the prepend drift. Record the ~55–59px residual's
confirmed cause (or that it was already gone after the reference-node rewrite)
— the spec currently carries a theory, and a theory that survives to phase 3b
becomes a false lesson.

Note in the banner that **the spec's claim that the reference-node fix is
"correct regardless of what else changes height … asynchronously after the
measurement" is an overstatement**: a single measurement in a layout effect
cannot see a height change that has not happened yet. Task 2's settle window is
what covers the asynchronous case.

- [ ] **Step 8: Commit and open the PR**

```bash
git add docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md
git commit -m "docs: record phase 3a as shipped and correct the scroll-fix claim"
git push

gh pr create --title "feat(web): day rail, converged scope set, and the phase 2 release" --body "$(cat <<'EOF'
## Summary
Phase 3a of the cross-platform date-navigation initiative — web only.

- Rewrites the upward-prepend scroll correction to track a day section's own
  `getBoundingClientRect().top` instead of total document height, and holds
  that position against late height changes (broken hotlinked images).
- Deletes `VITE_NAV_V2` and the legacy list container. Phase 2 was merged dark
  on 2026-08-16; this is its release. A build-time flag buys no rollback that
  `git revert` does not, and keeping it would have forced the rail to be gated
  too.
- Converges the scope set on Now · Today · All Season · All Year. The This Week
  **button** goes; the `'this-week'` union member stays, so a persisted value
  keeps working. Mirrors iOS.
- Adds the sticky day rail: chips over the navigable bounds, highlight tracking
  the anchor day, ±1 calendar-day chevrons, and `⟳ Now`.
- The date chip now names the window the list is actually showing, and its `✕`
  resets the window rather than the scope once you have navigated.

## Verification
`npm run build` green in `frontend/`. Manual browser pass covering all 14 items
in the plan's Task 12, including 320px width and 200% text zoom — results are in
the PR thread.

iOS is untouched, so no screenshot regeneration is owed.
[skip-screenshots: web-only change, no iOS pixels touched]

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01XMxQocbmXTw5K2fF4RPmb2
EOF
)"
```

---

## Carried forward, deliberately not in this plan

Three items the phase-2 wrap-up asked phase 3 to "carry in". Each is recorded
here with the reason it is not a task, so dropping them is a decision rather
than an oversight.

1. **Expansion granularity.** Widening the view window currently advances one
   *event day* per refilter, so reaching a day a week away costs ~4–6 refilters
   of ~1,470 events. "Widen to the next day that adds at least a batch" would
   collapse that to one. It is not here because the rail changes the shape of
   the problem: after Task 10 the common long jump is a chip tap, which is a
   single `railTarget` expansion to the exact target regardless of distance.
   Re-measure the sentinel path *after* the rail ships, and only then decide.
2. **The empty-scope dead end.** A scope with zero matches renders `EmptyState`
   — no list, so no sentinel, so no control to escape with. The rail fixes this
   as a side effect: it spans the navigable bounds independent of the scope and
   is rendered outside the list card, so it is present and usable on an empty
   result. **Confirm this in Task 12** by selecting `Today` on a day with no
   matching events under an active category filter, and check the rail is still
   there and still moves you. If it is not, that is a Task 10 bug (the rail is
   inside the `loading`/`EmptyState` ternary), not a new feature.
3. **#234 — re-tapping the active scope keeps a widened window.** Filed against
   iOS. The web equivalent is narrower: `selectScope` turns a re-tap of any
   scope into `setDateFilter('all')`, which the reducer treats as a change and
   which therefore *does* clear the window. The one surviving case is tapping
   **All Year while already on All Year** — the reducer's same-value guard makes
   it a no-op and the window survives. That is not a dead end (the date chip's
   `✕` resets the window, Task 6) and fixing it properly means resolving #234's
   cross-platform question, which belongs with phase 3b.

## Self-review notes

Checked against the spec, 2026-08-16:

- **Covered:** the scope-set convergence (Task 5), `'season'` in the window model
  (Task 4), `'this-week'` staying in the union (Global Constraints + Task 5),
  mutual exclusion both ways (Task 4 Step 5 + Task 5), the rail's span/highlight/
  tap/chip-content/chevrons/accessibility bullets (Tasks 8–10), `⟳ Now` as
  navigation not filtering (Tasks 9–10), the two D3 escapes (Task 6), gotcha #2
  upward prepend (Tasks 1–2), gotcha #3 sticky stacking with a `ResizeObserver`-
  maintained `--day-rail-h` (Tasks 10–11), the About-copy obligation (Task 12),
  and the "next calendar day vs next day with results" resolution — the rail
  steps by calendar day and an empty day renders as empty (Task 8's zero-count
  chip, Task 12 item 10).
- **Deliberately out of this plan:** everything iOS (phase 3b), which the spec
  lists under phase 3 and which the user split out on 2026-08-16. Also
  `useDayAnchor`'s `GO_TO_DAY` reducer action — the spec names one, but it
  decomposes exactly into the two `EXPAND_WINDOW_*` actions that already exist,
  so adding a third would be a synonym. That deviation is recorded in Task 10's
  preamble.
- **Correction to the spec:** the durable-fix paragraph claims the reference-node
  approach is correct for height changes that land *asynchronously after the
  measurement*. It is not — that is Task 2's job, and Task 12 Step 7 records it.
