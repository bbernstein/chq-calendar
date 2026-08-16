import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/preact';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// JSDOM does not implement window.matchMedia. Default to `matches: false` so
// CSS media-query feature checks (e.g. responsive layouts in admin pages)
// don't crash under test. Individual tests can override per-case if needed.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// JSDOM does not implement Element.prototype.scrollIntoView at all — calling
// it throws a TypeError rather than silently no-opping, because jsdom has no
// layout for it to consult. Nothing in src/ currently calls it: DayRail uses
// its own `scrollLeft`, and useDayAnchor computes a delta and calls
// `window.scrollBy` instead (see the comments on both explaining why
// `scrollIntoView` was deliberately not used). This is a defensive guard
// against that gap, not a workaround for an existing caller — kept so a
// future native scroll (an anchor jump, a `focus()`-driven scroll) doesn't
// fail every test that touches it for a reason that takes a jsdom deep-dive
// to explain. A no-op on the prototype is enough: it makes the call safe
// everywhere, and a test that actually cares whether scrolling happened
// stubs `scrollIntoView` on its own element (an own-property assignment
// shadows this prototype one), as DayRail.test.tsx does.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {};
}

// Clean up between tests so DOM and storage don't bleed across cases.
afterEach(() => {
  cleanup();
  localStorage.clear();
});
