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
