import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/preact';
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
function Harness() {
  const { open, toggle, panelId, panelRef, toggleRef } = useFilterPanel();
  return (
    <div>
      <button ref={toggleRef} type="button" onClick={toggle} aria-expanded={open} aria-controls={panelId}>
        Filters
      </button>
      <div id={panelId} ref={panelRef} className={open ? '' : 'hidden'}>
        <input aria-label="Search" />
        <button type="button">A filter control</button>
      </div>
      <div data-day-key="2026-08-18">day section</div>
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
      const { open, toggle, panelId, panelRef, toggleRef } = useFilterPanel();
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
