import { describe, expect, it, afterEach, vi } from 'vitest';
import { useLayoutEffect } from 'react';
import { render, fireEvent, screen, act, within } from '@testing-library/preact';
import { useFilterPanel } from '@/hooks/useFilterPanel';

afterEach(() => { vi.restoreAllMocks(); });

// A minimal stand-in for the real toggle button + filter card + a day
// section: enough DOM (a focusable control inside the panel, a
// `data-day-key` element for the scroll correction to reference) to
// exercise the hook's focus and scroll management honestly, without
// pulling in the whole page. jsdom's default `getBoundingClientRect()` is a
// stable all-zero rect, so the day section is a harmless no-op reference
// (delta always 0, `scrollBy` never called) in every test that doesn't
// explicitly mock it.
//
// `scrolledPast: true` throughout: the rail's toggle only exists once the
// reader has scrolled past the in-flow filter card, so that is the state
// every interaction modelled here happens in.
//
// The "Hide filters" button is the caret's stand-in — a control mounted
// INSIDE the panel that calls the same `toggle` the rail's button calls.
// Its placement is the whole point of the focus test below: when it fires,
// `document.activeElement` is guaranteed to be inside the panel that is
// about to be hidden.
function Harness() {
  const { open, toggle, panelId, panelRef, toggleRef, exiting, exitRect } = useFilterPanel({ scrolledPast: true });
  return (
    <div>
      <button ref={toggleRef} type="button" onClick={toggle} aria-expanded={open} aria-controls={panelId}>
        Filters
      </button>
      <div id={panelId} ref={panelRef} className={open ? '' : 'hidden'}>
        <input aria-label="Search" />
        <button type="button">A filter control</button>
        <button type="button" onClick={toggle}>Hide filters</button>
      </div>
      {/*
        A day-rail chip. The rail sits below the panel and stays
        keyboard-reachable while the panel is open, and it claims `Home` for
        its own focus movement — see the `isExempt` tests below.
      */}
      <button type="button" data-chip="2026-08-18">Aug 18</button>
      <div data-day-key="2026-08-18">day section</div>
      {/*
        The hook's `exiting`/`exitRect` are consumed by page.tsx to render a
        fixed-position, animating copy of this same element — rendering that
        here would duplicate page.tsx's own logic without testing the hook
        any more thoroughly. These two text nodes are just a window onto the
        hook's state, so the exit-animation tests below can assert on it
        directly instead of reverse-engineering it from page markup the hook
        itself knows nothing about.
      */}
      <div data-testid="exiting">{String(exiting)}</div>
      <div data-testid="exit-rect">
        {exitRect ? `${exitRect.top},${exitRect.left},${exitRect.width},${exitRect.height}` : 'none'}
      </div>
    </div>
  );
}

// A day section whose `getBoundingClientRect().top` reads out differently
// depending on whether the panel is currently visible — the same shape a
// real browser produces (the panel occupying real space above the list
// pushes everything below it down when nothing corrects for it). Numbers
// match a real Chromium build measured with `overflow-anchor: none` (see
// the report): 236px with the panel hidden, 517px with it shown — a 281px
// drift, exactly the panel's height. Reading off the panel's *current* DOM
// class (not a call counter) means this works correctly regardless of how
// many times the hook happens to call `getBoundingClientRect` on either
// side of the toggle.
function mockDaySectionTrackingPanel(panel: Element, daySection: HTMLElement) {
  daySection.getBoundingClientRect = () =>
    ({ top: panel.classList.contains('hidden') ? 236 : 517 }) as DOMRect;
}

function panelElementFor(toggle: HTMLElement): HTMLElement {
  return document.getElementById(toggle.getAttribute('aria-controls')!)!;
}

describe('useFilterPanel', () => {
  it('is closed by default, with aria-expanded false and the panel hidden', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByLabelText('Search').closest('[id]')).toHaveClass('hidden');
  });

  it('opening tracks aria-expanded and reveals the panel', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Search').closest('[id]')).not.toHaveClass('hidden');
  });

  it('clicking the toggle again closes it', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByLabelText('Search').closest('[id]')).toHaveClass('hidden');
  });

  // The caret (`FilterPanelCaret`) is a real <button> mounted INSIDE the
  // panel and wired to this same `toggle`. When it fires,
  // `document.activeElement` IS the caret, which is inside the element that
  // `toggle` is about to make `inert` + `aria-hidden` + `display: none` —
  // so focus drops to <body> and a keyboard or switch user who activated
  // "Hide filters" is thrown to the top of the document. `closeViaGesture`
  // and `closeViaEscape` both handle this; the one path where the stranding
  // is CERTAIN rather than merely possible did not.
  //
  // Asserting `activeElement` is the toggle (not merely "not body") is what
  // pins the fix rather than any focus movement at all.
  it('returns focus to the toggle when a control inside the panel closes it', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle); // open
    const caret = screen.getByRole('button', { name: 'Hide filters' });
    act(() => { caret.focus(); });
    expect(document.activeElement).toBe(caret);

    fireEvent.click(caret);

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  // The other half of the same containment check: a click on the rail's own
  // toggle already leaves focus on the toggle, so the check must be a no-op
  // there rather than an unconditional refocus that could fight it.
  it('leaves focus alone when the rail toggle closes it from outside the panel', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle); // open
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    act(() => { outside.focus(); });

    fireEvent.click(toggle); // close from outside the panel

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(outside);
  });

  it('opening moves focus to the first focusable control inside the panel', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Search'));
  });

  it('Escape closes the panel and returns focus to the toggle', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle);
    expect(document.activeElement).toBe(screen.getByLabelText('Search'));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('does not close on Escape while already closed (no listener attached)', () => {
    render(<Harness />);
    // No throw, no state change — Escape is a no-op when there is nothing open.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Filters' }).getAttribute('aria-expanded')).toBe('false');
  });

  // jsdom has no layout, so it cannot reproduce the real bug this mechanism
  // was rewritten to fix: a real Chromium build's own scroll-anchoring
  // *correctly* compensates for the panel's height, and an earlier version
  // of this hook that forced `scrollY` back to a saved pre-toggle number
  // undid that correct compensation (browser-verified — see the report).
  // The fix follows this branch's own established pattern for the same
  // failure class (`EventList`'s prepend correction, `useDayAnchor`'s settle
  // hold): track a day section's `getBoundingClientRect().top` and
  // `scrollBy` the delta, never `scrollTo` a saved number. What jsdom *can*
  // pin honestly is that mechanism: a day section is measured before the
  // toggle and re-measured after, and only `scrollBy` — never `scrollTo` —
  // is used to correct for any difference.
  it('corrects via scrollBy, keyed on a day section, when opening moves it', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    const panel = panelElementFor(toggle);
    const daySection = document.querySelector<HTMLElement>('[data-day-key]')!;
    mockDaySectionTrackingPanel(panel, daySection);

    const scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const scrollToSpy = vi.spyOn(window, 'scrollTo');

    fireEvent.click(toggle);

    expect(scrollBySpy).toHaveBeenCalledWith(0, 281);
    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it('corrects the same way on close', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    const panel = panelElementFor(toggle);
    const daySection = document.querySelector<HTMLElement>('[data-day-key]')!;
    mockDaySectionTrackingPanel(panel, daySection);
    const scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});

    fireEvent.click(toggle); // open
    scrollBySpy.mockClear();
    fireEvent.click(toggle); // close

    // Closing removes the panel's height, so the day section moves the
    // other way — back toward its hidden-state position (236), a -281 delta.
    expect(scrollBySpy).toHaveBeenCalledWith(0, -281);
  });

  it('corrects on an Escape close too', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    const panel = panelElementFor(toggle);
    const daySection = document.querySelector<HTMLElement>('[data-day-key]')!;
    mockDaySectionTrackingPanel(panel, daySection);
    const scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});

    fireEvent.click(toggle); // open
    scrollBySpy.mockClear();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(scrollBySpy).toHaveBeenCalledWith(0, -281);
  });

  // The case the coordinator's own review flagged by name: two mechanisms
  // both calling `scrollBy` on the same frame is the exact bug class this
  // branch already paid for once. If the reference day section hasn't
  // actually moved (the drift already corrected for some other reason, or
  // there was never one), this must not call `scrollBy` at all — a
  // zero-delta call would be a silent no-op in a real browser, but a test
  // that only checked "the argument was 0" would not catch a version of
  // this hook that calls `scrollBy` unconditionally.
  it('does not call scrollBy when the reference day section has not moved', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    const daySection = document.querySelector<HTMLElement>('[data-day-key]')!;
    daySection.getBoundingClientRect = () => ({ top: 236 }) as DOMRect; // same regardless of panel state

    const scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    fireEvent.click(toggle);

    expect(scrollBySpy).not.toHaveBeenCalled();
  });

  it('does nothing when there is no day section to use as a reference', () => {
    function HarnessNoSections() {
      const { open, toggle, panelId, panelRef, toggleRef } = useFilterPanel({ scrolledPast: true });
      return (
        <div>
          <button ref={toggleRef} type="button" onClick={toggle} aria-expanded={open} aria-controls={panelId}>
            Filters
          </button>
          <div id={panelId} ref={panelRef} className={open ? '' : 'hidden'}>
            <input aria-label="Search" />
          </div>
        </div>
      );
    }
    render(<HarnessNoSections />);
    const scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const toggle = screen.getByRole('button', { name: 'Filters' });

    fireEvent.click(toggle);

    // Not `expect(...).not.toThrow()` around the click: jsdom's event
    // dispatch swallows an exception thrown inside a listener and reports it
    // as an unhandled error rather than propagating it to the caller, so
    // that assertion would never actually fail here. Asserting the toggle
    // actually flipped is the real, reliable proof — a version of this hook
    // that crashes reading `.getBoundingClientRect()` off a `null` reference
    // throws before `setOpen` ever runs, leaving `aria-expanded` stuck at
    // `false`.
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(scrollBySpy).not.toHaveBeenCalled();
  });
});

describe('dismissal by scroll gesture', () => {
  it('closes when the reader makes a scroll gesture', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    act(() => { window.dispatchEvent(new Event('wheel')); });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  // Our own opening correction calls `scrollBy`, which fires `scroll`.
  it('does not close itself on the scroll its own opening correction fires', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle);

    act(() => { window.dispatchEvent(new Event('scroll')); });

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('ignores a gesture inside the panel', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    const panel = panelElementFor(toggle);
    fireEvent.click(toggle);
    const inner = panel.querySelector('input')!;

    act(() => { inner.dispatchEvent(new Event('wheel', { bubbles: true })); });

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  // The day rail sits below the panel, stays keyboard-reachable while the
  // panel is open, and claims `Home` to move focus to today's chip — the
  // same local job `ArrowLeft`/`ArrowRight` do there, and those are not
  // scroll keys at all. The dismiss listener is capture-phase, so without an
  // exemption it fires BEFORE the rail's own handler and slides the panel
  // away under a keypress that was never about the page.
  it('ignores Home pressed on a day-rail chip, which the rail claims for focus', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    const chip = screen.getByRole('button', { name: 'Aug 18' });
    fireEvent.click(toggle);

    act(() => { chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); });

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  // The exemption is that one key, not the rail. Focus parked on a chip does
  // not turn a genuine page scroll into a rail gesture.
  it('still dismisses on PageDown pressed on a day-rail chip', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    const chip = screen.getByRole('button', { name: 'Aug 18' });
    fireEvent.click(toggle);

    act(() => { chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true })); });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  // And a chip TAP must still dismiss — the reader has turned back to the
  // results. `dayRailIntegration` pins the same composition end to end;
  // exempting the rail wholesale would have broken it.
  it('still dismisses when a day-rail chip is tapped', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    const chip = screen.getByRole('button', { name: 'Aug 18' });
    fireEvent.click(toggle);

    act(() => { chip.dispatchEvent(new Event('mousedown', { bubbles: true })); });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  // Home elsewhere on the page is an ordinary jump to the top, and does
  // dismiss — the exemption is scoped to the rail's own chips.
  it('still dismisses on Home pressed outside the rail', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle);

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' })); });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  // Without this the toggle's own mousedown dismisses, and its click reopens.
  it('ignores a gesture on the toggle itself', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle);

    act(() => { toggle.dispatchEvent(new Event('mousedown', { bubbles: true })); });

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  // The normal case: a gesture means the reader's attention already left the
  // panel, so closing must not yank focus to the toggle. Only the case where
  // focus is still stranded inside the (now-hidden) panel gets a return —
  // proven separately below.
  it('leaves focus alone on a gesture close when focus was already outside the panel', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    act(() => { outside.focus(); });
    expect(document.activeElement).toBe(outside);

    act(() => { window.dispatchEvent(new Event('wheel')); });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(outside);
  });

  // Opening moves focus into the panel (the Search field). If the reader
  // then makes a gesture without ever moving focus themselves, closing the
  // panel would otherwise strand focus on a now-hidden element.
  it('returns focus to the toggle on a gesture close when focus was still inside the panel', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle);
    expect(document.activeElement).toBe(screen.getByLabelText('Search'));

    act(() => { window.dispatchEvent(new Event('wheel')); });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  // Not just "`open` stays false" — that would hold even if the listeners
  // were wired unconditionally, since closing an already-closed panel is a
  // no-op state update. Focusing an element inside the (unopened, merely
  // hidden-by-class) panel and checking it does NOT get yanked to the toggle
  // is the one observable difference: `active: open` never attaches the
  // listeners while closed, so the gesture reaches nobody.
  it('does nothing while closed', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    const search = screen.getByLabelText('Search');
    act(() => { search.focus(); });
    expect(document.activeElement).toBe(search);

    act(() => { window.dispatchEvent(new Event('wheel')); });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(search);
  });
});

describe('exit animation', () => {
  // Note on what this does NOT prove: `getBoundingClientRect` is stubbed to
  // return a constant, so this can't distinguish a rect read before `open`
  // flips from one read after — a stub that returned different values
  // depending on the panel's own `hidden` class (as
  // `mockDaySectionTrackingPanel` does for the day-section case above) would
  // be needed for that, and isn't worth building for a browser-verifiable
  // ordering concern (see the report). What this honestly pins: the value
  // `getBoundingClientRect()` returns really does flow through to `exitRect`
  // unchanged, and the in-flow panel really does drop out of flow (`hidden`)
  // in the very same commit that `exiting` turns on — not a later render.
  it('surfaces the panel rect as exitRect and drops the in-flow panel, both in the dismissal commit', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle); // open
    const panel = panelElementFor(toggle);
    const stubbedRect = { top: 64, left: 0, width: 390, height: 281 } as DOMRect;
    panel.getBoundingClientRect = () => stubbedRect;

    fireEvent.click(toggle); // dismiss

    // The state machine lives in the hook, not in any DOM the harness
    // renders, so it's asserted through the harness's own exposed markers
    // rather than through page structure the hook knows nothing about.
    expect(screen.getByTestId('exiting').textContent).toBe('true');
    expect(screen.getByTestId('exit-rect').textContent).toBe('64,0,390,281');
    // And the in-flow panel is gone from flow in the same commit — the
    // architecture the whole task turns on. Confirming a class change here
    // isn't circular: page.tsx (Task 4's other file) reads this same
    // `exiting` flag to decide whether to render fixed, but the Harness's
    // own consumption of it (the `open`-driven `hidden` class) is a second,
    // independent witness that `open` really did flip in the same commit
    // that `exiting` turned on.
    expect(panel).toHaveClass('hidden');
  });

  it('clears exiting when the transition ends', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle); // open
    fireEvent.click(toggle); // dismiss
    expect(screen.getByTestId('exiting').textContent).toBe('true');
    const panel = panelElementFor(toggle);

    act(() => { panel.dispatchEvent(new Event('transitionend')); });

    expect(screen.getByTestId('exiting').textContent).toBe('false');
    expect(screen.getByTestId('exit-rect').textContent).toBe('none');
  });

  // `transitionend` bubbles. The panel's own subtree has real, unrelated
  // Tailwind transitions on it (chip hover colours, chevron rotations), and
  // a gesture dismissal typically produces a hover-out on whatever was
  // under the pointer at the same moment — so a listener that doesn't check
  // `event.target` would finish the exit on a ~150ms colour transition
  // completing on a filter control, unmounting the ghost a third of the way
  // through its own ~200ms slide. Firing the event from a descendant (not
  // the panel itself) and asserting the exit survives is what a target-blind
  // listener fails here.
  it('ignores a transitionend that bubbles up from a descendant', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle); // open
    fireEvent.click(toggle); // dismiss
    expect(screen.getByTestId('exiting').textContent).toBe('true');
    const panel = panelElementFor(toggle);
    const descendant = within(panel).getByRole('button', { name: 'A filter control' });

    act(() => { descendant.dispatchEvent(new Event('transitionend', { bubbles: true })); });

    expect(screen.getByTestId('exiting').textContent).toBe('true');
  });

  // transitionend never fires if the element is never painted (a background
  // tab, some reduced-motion paths a browser takes on its own) — proven by
  // firing nothing and advancing time instead of dispatching the event.
  it('clears exiting via the fallback timer when transitionend never fires', () => {
    vi.useFakeTimers();
    try {
      render(<Harness />);
      const toggle = screen.getByRole('button', { name: 'Filters' });
      fireEvent.click(toggle); // open
      fireEvent.click(toggle); // dismiss
      expect(screen.getByTestId('exiting').textContent).toBe('true');

      act(() => { vi.advanceTimersByTime(1000); });

      expect(screen.getByTestId('exiting').textContent).toBe('false');
      expect(screen.getByTestId('exit-rect').textContent).toBe('none');
    } finally {
      vi.useRealTimers();
    }
  });

  // Pins the fallback timer against the CSS transition duration (200ms in
  // globals.css), not just against some generously long window: without
  // this, `EXIT_FALLBACK_MS` could be set to e.g. 20ms and every other test
  // here — including the 1000ms advance above — would stay green while
  // every real exit got truncated to a 20ms flash. Advancing to exactly
  // 200ms (the CSS duration, well short of the fallback's own 400ms budget)
  // and requiring `exiting` to still be true is what a too-short fallback
  // fails.
  it('does not clear exiting before the CSS transition duration has elapsed', () => {
    vi.useFakeTimers();
    try {
      render(<Harness />);
      const toggle = screen.getByRole('button', { name: 'Filters' });
      fireEvent.click(toggle); // open
      fireEvent.click(toggle); // dismiss

      act(() => { vi.advanceTimersByTime(200); });

      expect(screen.getByTestId('exiting').textContent).toBe('true');
    } finally {
      vi.useRealTimers();
    }
  });

  // Reduced motion must remove the panel outright: no fixed-position ghost
  // left animating (or stranded) on screen for a reader who asked for none.
  it('skips the animation under prefers-reduced-motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList);

    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle); // open
    fireEvent.click(toggle); // dismiss

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('exiting').textContent).toBe('false');
    expect(screen.getByTestId('exit-rect').textContent).toBe('none');
  });

  // A dismissal while one is already animating must not strand the first:
  // reopening reuses the same element the first exit was playing on (no DOM
  // clone), so the first exit's fallback timer has to be cancelled on
  // reopen, not merely superseded by state that gets overwritten later.
  // Proven with fake timers on a precise schedule, not just "state looks
  // right after both clicks": if the first timer survives the reopen
  // uncancelled, it fires at its own original deadline and clears the
  // SECOND exit's state out from under it while that exit still has time
  // left — which is exactly what this pins.
  it('does not strand a previous exit when dismissed twice quickly', () => {
    vi.useFakeTimers();
    try {
      render(<Harness />);
      const toggle = screen.getByRole('button', { name: 'Filters' });
      const panel = panelElementFor(toggle);
      let rectCall = 0;
      panel.getBoundingClientRect = () => {
        rectCall += 1;
        return (rectCall === 1
          ? { top: 10, left: 0, width: 390, height: 281 }
          : { top: 20, left: 0, width: 390, height: 281 }) as DOMRect;
      };

      fireEvent.click(toggle); // open
      fireEvent.click(toggle); // dismiss #1 at t=0 -> fallback timer A due ~t=400
      expect(screen.getByTestId('exit-rect').textContent).toBe('10,0,390,281');

      act(() => { vi.advanceTimersByTime(50); }); // t=50, well before A fires
      fireEvent.click(toggle); // re-open at t=50: must cancel A
      expect(screen.getByTestId('exiting').textContent).toBe('false');
      expect(screen.getByTestId('exit-rect').textContent).toBe('none');

      fireEvent.click(toggle); // dismiss #2 at t=50 -> fallback timer B due ~t=450
      expect(screen.getByTestId('exit-rect').textContent).toBe('20,0,390,281');

      // t=420: past A's original t=400 deadline, short of B's t=450 one. A
      // surviving the reopen would have fired here and cleared `exiting` —
      // this is the assertion a stray, uncancelled timer A fails.
      act(() => { vi.advanceTimersByTime(370); });
      expect(screen.getByTestId('exiting').textContent).toBe('true');
      expect(screen.getByTestId('exit-rect').textContent).toBe('20,0,390,281');

      // B fires on its own schedule and cleans up normally.
      act(() => { vi.advanceTimersByTime(60); });
      expect(screen.getByTestId('exiting').textContent).toBe('false');
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * `page.tsx`'s own composition of the hook's exit state, reproduced
 * minimally: `exitingVisible`, the `hidden` class it suppresses, and the
 * `filter-panel-exit` class plus `position: fixed` it turns on. Nothing else
 * about the page is here.
 *
 * Reproducing it is the point rather than a shortcut. The bug this exists to
 * pin is not visible in the hook's own state — every value the hook exposes
 * settles correctly within a commit or two either way. It is visible only in
 * what the consumer *commits to the DOM in the first frame of the exit*, so
 * the consumer's rule is what has to be exercised.
 *
 * `commits` collects one entry per committed render via a dep-less
 * `useLayoutEffect`, which is what makes intermediate commits observable at
 * all: asserting on the final DOM cannot fail here, because a state latch
 * that is one commit late still lands on the right answer by the time
 * `fireEvent` returns. That is precisely why the defect shipped.
 */
function PageShapedHarness({ commits }: { commits: { exiting: boolean; className: string }[] }) {
  const { open, toggle, panelId, panelRef, toggleRef, exiting, exitRect, exitScrolledPast } =
    useFilterPanel({ scrolledPast: true });
  const exitingVisible = exiting && exitScrolledPast && exitRect !== null;
  const className = [
    !open && !exitingVisible ? 'hidden' : '',
    exitingVisible ? 'filter-panel-exit' : '',
  ].filter(Boolean).join(' ');
  useLayoutEffect(() => { commits.push({ exiting, className }); });
  return (
    <div>
      <button ref={toggleRef} type="button" onClick={toggle} aria-expanded={open} aria-controls={panelId}>
        Filters
      </button>
      <div
        id={panelId}
        ref={panelRef}
        data-testid="panel"
        className={className}
        style={exitingVisible ? { position: 'fixed', top: `${exitRect!.top}px` } : undefined}
      >
        <input aria-label="Search" />
      </div>
      <div data-day-key="2026-08-18">day section</div>
    </div>
  );
}

describe('the first dismissal of a session', () => {
  // The defect: the overlay state driving `exitingVisible` was derived in a
  // passive `useEffect` in the consumer, one commit behind `exiting` and
  // `exitRect`. On the FIRST dismissal after the reader crosses the sentinel
  // it is still at its initial `false`, so the exit's opening commit renders
  // the panel `display: none` — and **a CSS transition cannot start from
  // `display: none`**: there is no before-change style, so the element jumps
  // straight to `translateY(-100%); opacity: 0`, `transitionend` never
  // fires, and the panel blinks out in a single frame with no slide. Every
  // dismissal after the first looks right, because the latch stays true,
  // which is exactly why nothing caught it. It recurs whenever the latch is
  // reset — a dismissal at the top of the page.
  //
  // A layout-effect latch does not fix it either: it still commits the
  // `display: none` DOM first and then corrects it. This test fails against
  // both.
  it('renders the exit out of flow in the very commit the exit begins', () => {
    const commits: { exiting: boolean; className: string }[] = [];
    render(<PageShapedHarness commits={commits} />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle); // open
    const panel = screen.getByTestId('panel');
    panel.getBoundingClientRect = () => ({ top: 64, left: 0, width: 390, height: 281 }) as DOMRect;
    commits.length = 0;

    fireEvent.click(toggle); // the FIRST dismissal from this mount

    const firstExitCommit = commits.find(c => c.exiting);
    expect(firstExitCommit).toBeDefined();
    // Not `display: none` — a transition has to have a frame to start from.
    expect(firstExitCommit!.className).not.toContain('hidden');
    // And already carrying the transition, in that same commit.
    expect(firstExitCommit!.className).toContain('filter-panel-exit');
    // The settled DOM agrees, so this isn't pinning a transient the browser
    // would never paint.
    expect(panel.style.position).toBe('fixed');
  });
});
