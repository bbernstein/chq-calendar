// Fix for Node.js 22+ where jsdom's localStorage throws SecurityError
// when accessed without a --localstorage-file path.
// We provide a simple in-memory Storage implementation as a fallback.

function createMemoryStorage(): Storage {
  let store: Record<string, string> = {};

  return {
    get length() {
      return Object.keys(store).length;
    },
    clear() {
      store = {};
    },
    getItem(key: string) {
      return key in store ? store[key] : null;
    },
    key(index: number) {
      const keys = Object.keys(store);
      return keys[index] ?? null;
    },
    removeItem(key: string) {
      delete store[key];
    },
    setItem(key: string, value: string) {
      store[key] = String(value);
    },
  };
}

try {
  // Test if localStorage is accessible
  window.localStorage.getItem('__test__');
} catch {
  // If not, replace with in-memory implementation
  Object.defineProperty(window, 'localStorage', {
    value: createMemoryStorage(),
    writable: true,
  });
}
