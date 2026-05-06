/**
 * Test render helper.
 *
 * Wraps @testing-library/preact's render so we have a single seam for any
 * future context providers. Also exposes a navigation stub since the portal
 * pages call `window.location.href = ...` and `window.location.replace(...)`
 * which jsdom can't actually navigate but does record.
 */

import type { VNode } from 'preact';
import { render as tlpRender, type RenderResult } from '@testing-library/preact';

export function renderPage(node: VNode): RenderResult {
  return tlpRender(node);
}

// Recorded URLs from `window.location.href = ...` and `.replace(...)` /
// `.assign(...)`. installNavigationStub returns a getter and a clearer.
export interface NavigationStub {
  navigations: () => string[];
  reset: () => void;
  uninstall: () => void;
}

interface NavigatedLocation {
  // Subset of Location we override. Other reads still go through the real
  // jsdom window.location via the proxy.
  href: string;
  replace: (url: string | URL) => void;
  assign: (url: string | URL) => void;
}

/**
 * Replaces window.location with a Proxy that records assignments and calls.
 * jsdom otherwise throws "Not implemented: navigation" when production code
 * sets location.href, so we need to stub anyway.
 *
 * Returns a handle that exposes the recorded URLs and lets the test undo
 * the stub.
 */
export function installNavigationStub(): NavigationStub {
  const navigations: string[] = [];
  const realLocation = window.location;
  const realPathname = realLocation.pathname;
  const realSearch = realLocation.search;

  // Build a stand-in object. Other Location members fall through to the real
  // location via Object.assign so reads (e.g. pathname, search, hostname)
  // keep working.
  const stub: NavigatedLocation = {
    href: realLocation.href,
    replace(url) {
      navigations.push(String(url));
    },
    assign(url) {
      navigations.push(String(url));
    },
  };

  // Use Object.defineProperty so we can replace the (read-only) location
  // property and restore it later.
  const descriptor = Object.getOwnPropertyDescriptor(window, 'location');
  Object.defineProperty(window, 'location', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: new Proxy(stub, {
      get(target, prop, receiver) {
        if (prop === 'href') return target.href;
        if (prop === 'replace') return target.replace;
        if (prop === 'assign') return target.assign;
        if (prop === 'pathname') return realPathname;
        if (prop === 'search') return realSearch;
        if (prop === 'hostname') return realLocation.hostname;
        if (prop === 'origin') return realLocation.origin;
        if (prop === 'host') return realLocation.host;
        if (prop === 'protocol') return realLocation.protocol;
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value) {
        if (prop === 'href') {
          target.href = String(value);
          navigations.push(String(value));
          return true;
        }
        return Reflect.set(target, prop, value);
      },
    }),
  });

  return {
    navigations: () => navigations.slice(),
    reset: () => {
      navigations.length = 0;
    },
    uninstall: () => {
      if (descriptor) {
        Object.defineProperty(window, 'location', descriptor);
      }
    },
  };
}
