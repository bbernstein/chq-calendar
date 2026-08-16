import { vi } from 'vitest';
import { act } from '@testing-library/preact';

type Entry = { isIntersecting: boolean };
type Callback = (entries: Entry[]) => void;

interface Instance {
  callback: Callback;
  disconnected: boolean;
}

/**
 * A controllable `IntersectionObserver`.
 *
 * jsdom ships none, and the component under test grows its render window
 * from the observer callback — so the tests drive intersection by hand.
 * `trigger()` fires the newest observer that has not been disconnected,
 * which is the one the current render installed.
 *
 * Call `vi.unstubAllGlobals()` in `afterEach` (or let the suite's own
 * teardown do it) to remove the stub.
 */
export function installIntersectionObserverMock() {
  const instances: Instance[] = [];

  class MockIntersectionObserver {
    private instance: Instance;
    constructor(callback: Callback) {
      this.instance = { callback, disconnected: false };
      instances.push(this.instance);
    }
    observe() {}
    unobserve() {}
    takeRecords(): Entry[] { return []; }
    disconnect() { this.instance.disconnected = true; }
  }

  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

  return {
    trigger(isIntersecting = true) {
      const live = instances.filter(i => !i.disconnected);
      const newest = live[live.length - 1];
      if (!newest) throw new Error('no live IntersectionObserver to trigger');
      act(() => { newest.callback([{ isIntersecting }]); });
    },
    get liveCount() { return instances.filter(i => !i.disconnected).length; },
    get totalCreated() { return instances.length; },
  };
}
