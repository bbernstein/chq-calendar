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
      'react': 'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
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
