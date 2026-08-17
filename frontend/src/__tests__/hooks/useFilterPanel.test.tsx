import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/preact';
import { useFilterPanel } from '@/hooks/useFilterPanel';

// jsdom logs "Not implemented: Window's scrollTo() method" on every real
// call — every toggle triggers one via the hook's scroll-restore effect, so
// this is stubbed globally rather than per-test. Individual tests below
// override it again (with `vi.spyOn`, layered on top of this one) where
// they need to assert on the call itself.
beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

// A minimal stand-in for the real toggle button + filter card: enough DOM
// (a focusable control inside the panel) to exercise the hook's focus
// management honestly, without pulling in the whole page.
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
    </div>
  );
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

  // jsdom has no layout, so `window.scrollTo` never actually moves
  // `scrollY` (confirmed directly: `scrollTo(0, 700)` leaves it at 0) — the
  // browser bug this mechanism defends against (scroll-anchoring silently
  // compensating for a layout height change, even inside an already-stuck
  // `position: sticky` container) cannot reproduce here at all. It was
  // verified separately against a real Chromium build via Playwright (see
  // the report). What jsdom *can* pin honestly is the mechanism itself:
  // stub the `scrollY` getter to a fixed value so the hook's read at
  // click-time is deterministic, then assert the exact restore call it
  // makes after the commit. Deleting the restore call (or reading `scrollY`
  // at the wrong time) fails this; a `scrollTo(0, 0)` assertion against an
  // unstubbed, always-zero jsdom `scrollY` would not have.
  it('captures scrollY before toggling and restores it via scrollTo after the panel opens', () => {
    render(<Harness />);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(700);
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));

    expect(scrollToSpy).toHaveBeenCalledWith(0, 700);
  });

  it('restores scrollY the same way on close', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle);

    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(1200);
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    fireEvent.click(toggle);

    expect(scrollToSpy).toHaveBeenCalledWith(0, 1200);
  });

  it('restores scrollY on an Escape close too', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));

    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(340);
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(scrollToSpy).toHaveBeenCalledWith(0, 340);
  });
});
