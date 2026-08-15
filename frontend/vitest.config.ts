import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { resolve } from 'path';
import floor from '../.coverage-floor.json';

// Force VITE_RECAPTCHA_SITE_KEY to an empty string for the test phase,
// regardless of process.env. Without this, `npm run build --workspace=frontend`
// (which runs `vitest run --coverage` before `vite build`) inherits the
// production secret and makes the apply page try to load grecaptcha — never
// resolves in jsdom, submit short-circuits, tests fail in CI but pass locally.
// `define` is compile-time AST replacement on the literal expression
// `import.meta.env.VITE_RECAPTCHA_SITE_KEY`, so the apply page must read the
// key via that exact expression (not `(import.meta as any).env?...`) for the
// substitution to fire. Other VITE_* vars are not overridden here — tests
// that depend on them (e.g. useEventData.publisherFeed.test.ts) use
// `vi.stubEnv` per-test instead, which `define` would silently break.
const TEST_ENV_DEFINES = {
  'import.meta.env.VITE_RECAPTCHA_SITE_KEY': JSON.stringify(''),
};

export default defineConfig({
  plugins: [preact()],
  define: TEST_ENV_DEFINES,
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@shared': resolve(__dirname, '../shared'),
      'react': 'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Pin the test-run timezone to the app's own zone (Chautauqua
    // Institution, America/New_York). Without this, DST-transition tests
    // (see dayWindow.test.ts) only discriminate a DST-safe date-parts
    // implementation from a naive millisecond-arithmetic one in a
    // DST-observing zone — GitHub-hosted runners are UTC, where 2026-03-08
    // and 2026-11-01 are not transitions, so the naive version would pass
    // there. Set before test files load (see vitest `test.env` docs), which
    // is early enough that Node's Date/Intl machinery picks it up.
    env: { TZ: 'America/New_York' },
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      exclude: ['out/**', 'src/**/__tests__/**', '**/*.test.{ts,tsx}'],
      thresholds: { lines: floor.frontend.lines },
    },
  },
});
