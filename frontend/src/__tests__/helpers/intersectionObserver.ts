import { vi } from 'vitest';
import { act } from '@testing-library/preact';

type Entry = { isIntersecting: boolean };
type Callback = (entries: Entry[]) => void;

interface Instance {
  callback: Callback;
  disconnected: boolean;
  targets: Element[];
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
      this.instance = { callback, disconnected: false, targets: [] };
      instances.push(this.instance);
    }
    observe(el: Element) { this.instance.targets.push(el); }
    unobserve(el: Element) {
      this.instance.targets = this.instance.targets.filter(t => t !== el);
    }
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
    /**
     * Fire the observer watching a SPECIFIC element.
     *
     * `trigger()` fires the newest live observer, which is unambiguous only
     * while one is installed. A page renders several — the filter sentinel,
     * the filter card, the list's own window — and "newest" then depends on
     * render order, so a test using it is asserting against whichever
     * observer happened to mount last. Name the element instead.
     */
    triggerFor(el: Element, isIntersecting = true) {
      const live = instances.filter(i => !i.disconnected && i.targets.includes(el));
      if (!live.length) {
        throw new Error(`no live IntersectionObserver is observing ${el.nodeName}${el.id ? `#${el.id}` : ''}`);
      }
      act(() => { for (const i of live) i.callback([{ isIntersecting }]); });
    },
    get liveCount() { return instances.filter(i => !i.disconnected).length; },
    get totalCreated() { return instances.length; },
  };
}
