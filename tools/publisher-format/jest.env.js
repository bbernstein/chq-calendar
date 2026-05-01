const NodeEnvironment = require('jest-environment-node').TestEnvironment;

try {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    enumerable: false,
    value: undefined,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    enumerable: false,
    value: undefined,
  });
} catch {
  /* ignore */
}

module.exports = NodeEnvironment;
