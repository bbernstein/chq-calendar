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
  const instances: { callback: () => void; disconnected: boolean; targets: Element[] }[] = [];

  class MockResizeObserver {
    private instance: { callback: () => void; disconnected: boolean; targets: Element[] };
    constructor(callback: () => void) {
      this.instance = { callback, disconnected: false, targets: [] };
      instances.push(this.instance);
    }
    observe(el: Element) { this.instance.targets.push(el); }
    unobserve(el: Element) {
      this.instance.targets = this.instance.targets.filter(t => t !== el);
    }
    disconnect() { this.instance.disconnected = true; }
  }

  vi.stubGlobal('ResizeObserver', MockResizeObserver);

  return {
    trigger() {
      const live = instances.filter(i => !i.disconnected);
      if (live.length === 0) throw new Error('no live ResizeObserver to trigger');
      act(() => { live.forEach(i => i.callback()); });
    },
    /**
     * Whether anything live is observing this element.
     *
     * WHICH element is observed can be the whole point: `--filter-card-h`
     * has to re-publish when the filter card's margin changes at a
     * breakpoint, and `ResizeObserver` never reports a margin — so an
     * observer on the card would never fire, while one on the header
     * container (card + margin + rail) does. A test that only exercises the
     * measurement cannot tell those apart.
     */
    isObserving(el: Element) {
      return instances.some(i => !i.disconnected && i.targets.includes(el));
    },
    get liveCount() { return instances.filter(i => !i.disconnected).length; },
  };
}
