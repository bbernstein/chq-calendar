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

  // `touchmove` is listened for alongside `touchstart`, and was the one
  // registered event type in the list with no coverage at all — dropping it
  // from the array would have gone unnoticed. It is not merely redundant
  // with `touchstart`: a `touchstart` whose default is prevented by a
  // carousel or a drag handler still produces `touchmove` when the reader
  // flicks, and the spec names both.
  it('dismisses on a touchmove', () => {
    const onDismiss = setup();
    window.dispatchEvent(new Event('touchmove'));
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

  // The single most important assertion in this file. Opening the panel fires
  // our own `scrollBy` correction, and a filter change reflows the list — both
  // emit `scroll`. A `scroll` listener would dismiss the panel in the frame it
  // opened, and again on the reader's first venue tick.
  it('does NOT dismiss on the scroll event', () => {
    const onDismiss = setup();
    window.dispatchEvent(new Event('scroll'));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  // SCROLL_KEYS exists so that typing in the panel's own search field can't
  // close it. A bare letter or Tab must be ignored on keydown.
  it('does NOT dismiss on a non-scroll key', () => {
    const onDismiss = setup();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
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
