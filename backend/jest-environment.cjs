// Custom Jest environment to work around Node.js 22+ localStorage issue.
//
// Node.js 22+ exposes localStorage as a global, but accessing it without
// the --localstorage-file CLI flag throws SecurityError. Jest 29's node
// environment trips over this when copying globals into the test VM context.
//
// This wrapper neutralizes the problematic getter before Jest iterates globals.

try {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  if (desc) {
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  }
} catch {
  // Older Node.js versions don't have localStorage — nothing to fix.
}

module.exports = require('jest-environment-node').TestEnvironment;
