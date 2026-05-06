# Frontend portal integration tests (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Vitest-based integration tests for every publisher-portal frontend page, mocking `fetch` and exercising the full state machine of each page.

**Spec:** `docs/plans/2026-05-06-frontend-portal-integration-tests-design.md`

**Architecture:** New `frontend/src/__tests__/integration/` directory. Vitest + `@testing-library/preact` + happy-dom. A small `fetchMock` harness routes API calls to canned responses. A `loginAs` helper writes session tokens to `localStorage` exactly the way `frontend/src/lib/auth.ts` does.

**Tech Stack:** TypeScript, Vitest, happy-dom, `@testing-library/preact`, `@testing-library/user-event`, Preact (via `@preact/preset-vite`).

**Branch:** create `feat/frontend-portal-integration-tests` off `main`.

**Prerequisite:** none — this can land independently of the backend integration tests plan.

---

## Task 1: Wire up Vitest

**Files:**
- New (or modify): `frontend/vitest.config.ts`
- Modify: `frontend/package.json` (scripts + dev deps)

- [ ] **Step 1: Check whether `vitest.config.ts` already exists**

  ```bash
  ls frontend/vitest.config.ts 2>/dev/null
  ```

  If missing, create it:

  ```ts
  import { defineConfig } from 'vitest/config';
  import preact from '@preact/preset-vite';
  import path from 'node:path';

  export default defineConfig({
    plugins: [preact()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        // CRITICAL: matches vite.config.ts. Without this, react-imported
        // hooks resolve to real React in tests and form handlers behave
        // differently than in production (see CLAUDE.md note).
        react: 'preact/compat',
        'react-dom': 'preact/compat',
      },
    },
    test: {
      environment: 'happy-dom',
      globals: true,
      setupFiles: ['./src/__tests__/integration/helpers/setup.ts'],
    },
  });
  ```

  If it already exists, confirm the `react` → `preact/compat` aliases are present; add them if not. This is the gotcha called out in CLAUDE.md.

- [ ] **Step 2: Add scripts and dev deps**

  In `frontend/package.json`, under `scripts`:

  ```json
  "test": "vitest run",
  "test:watch": "vitest",
  "test:ci": "vitest run --coverage"
  ```

  Add devDependencies (`npm i -D --workspace=frontend`):

  ```
  vitest @vitest/coverage-v8 happy-dom
  @testing-library/preact @testing-library/user-event @testing-library/jest-dom
  ```

- [ ] **Step 3: Setup file**

  Create `frontend/src/__tests__/integration/helpers/setup.ts`:

  ```ts
  import '@testing-library/jest-dom/vitest';
  import { afterEach } from 'vitest';
  import { cleanup } from '@testing-library/preact';
  afterEach(() => { cleanup(); localStorage.clear(); });
  ```

- [ ] **Step 4: Smoke test**

  Create `frontend/src/__tests__/integration/smoke.test.tsx`:

  ```ts
  import { render } from '@testing-library/preact';
  import { describe, it, expect } from 'vitest';

  describe('vitest smoke', () => {
    it('renders a div with preact and finds it via testing-library', () => {
      const { getByText } = render(<div>hello</div>);
      expect(getByText('hello')).toBeInTheDocument();
    });
  });
  ```

  Run:

  ```bash
  cd frontend && npm run test
  ```

  Must pass.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/vitest.config.ts frontend/package.json frontend/package-lock.json \
          frontend/src/__tests__/integration/helpers/setup.ts \
          frontend/src/__tests__/integration/smoke.test.tsx
  git commit -m "test(frontend): vitest scaffolding with preact + happy-dom"
  ```

---

## Task 2: Build the helpers — fetchMock, render, auth

**Files:**
- New: `frontend/src/__tests__/integration/helpers/fetchMock.ts`
- New: `frontend/src/__tests__/integration/helpers/render.tsx`
- New: `frontend/src/__tests__/integration/helpers/auth.ts`

- [ ] **Step 1: fetchMock**

  Implement an `installFetchMock()` helper that replaces `globalThis.fetch` with a typed router:

  ```ts
  type Route = { method: string; url: string | RegExp; respond: (req: Request) => Response | Promise<Response> };
  export function installFetchMock(): {
    on(method: string, url: string | RegExp, response: number | object | ((r: Request) => any)): void;
    calls(url?: string | RegExp): Request[];
    reset(): void;
    uninstall(): void;
  };
  ```

  Default response when no route matches: `404` plus a thrown error in `console` so unhandled requests fail loudly.

- [ ] **Step 2: render helper**

  ```ts
  export function renderPage(node: VNode): RenderResult;
  ```

  Wraps `@testing-library/preact`'s render with whatever context providers the portal needs (none currently, but reserve the seam).

- [ ] **Step 3: auth helper**

  Read `frontend/src/lib/auth.ts` to learn the exact localStorage key + value shape used by `loginAs`. Mirror it:

  ```ts
  export function loginAs(opts: { publisherId: string; email: string; jwt?: string }): void;
  export function loginAsAdmin(opts: { email: string; jwt?: string }): void;
  export function logout(): void;
  ```

- [ ] **Step 4: Self-test the helpers**

  Add `helpers/__tests__/fetchMock.test.ts` covering: route matching by URL string, by regex, default 404, calls() returning the request, reset() clearing routes, uninstall() restoring the original fetch.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/__tests__/integration/helpers/
  git commit -m "test(frontend): integration helpers (fetchMock, render, auth)"
  ```

---

## Task 3: Apply page tests

**Files:**
- New: `frontend/src/__tests__/integration/apply.test.tsx`

- [ ] **Step 1: Read the apply page**

  Open `frontend/src/app/publish/apply/page.tsx`. Identify field labels, the CAPTCHA component, the success state, and which API endpoint it POSTs to.

- [ ] **Step 2: Write the tests**

  Six `it(...)` blocks per the design doc, Test plan → apply.test.tsx. Each:
  - Renders the page
  - Configures the fetchMock
  - Drives input via `userEvent`
  - Asserts on rendered text + on `fetchMock.calls(url)` payload

- [ ] **Step 3: Commit**

  ```bash
  cd frontend && npm run test -- apply
  git add frontend/src/__tests__/integration/apply.test.tsx
  git commit -m "test(frontend): apply page integration tests"
  ```

---

## Task 4: Test page tests (publish/test)

**Files:**
- New: `frontend/src/__tests__/integration/publishTest.test.tsx`

- [ ] **Step 1: Implement the four `it(...)` blocks** per the design doc.

- [ ] **Step 2: Run and commit**

  ```bash
  cd frontend && npm run test -- publishTest
  git add frontend/src/__tests__/integration/publishTest.test.tsx
  git commit -m "test(frontend): publish/test page integration tests"
  ```

---

## Task 5: Portal page tests

**Files:**
- New: `frontend/src/__tests__/integration/portal.test.tsx`

- [ ] **Step 1: Read `frontend/src/app/publisher-portal/page.tsx`**, capture all sub-flows: status load, profile edit, email change, pause/resume, fetch-now, self-disable.

- [ ] **Step 2: Implement the eight `it(...)` blocks** per the design doc. Critical: include the form-submission regression test (any single submit) to verify the `react` → `preact/compat` alias is working.

- [ ] **Step 3: Run and commit**

  ```bash
  cd frontend && npm run test -- portal
  git add frontend/src/__tests__/integration/portal.test.tsx
  git commit -m "test(frontend): portal page integration tests"
  ```

---

## Task 6: Login + email-change page tests

**Files:**
- New: `frontend/src/__tests__/integration/portalLogin.test.tsx`
- New: `frontend/src/__tests__/integration/portalEmailChange.test.tsx`

- [ ] **Step 1: Implement** all `it(...)` blocks for both files per the design doc.

- [ ] **Step 2: Run and commit (one commit each)**

  ```bash
  cd frontend && npm run test -- portalLogin
  git add frontend/src/__tests__/integration/portalLogin.test.tsx
  git commit -m "test(frontend): portal login page integration tests"

  cd frontend && npm run test -- portalEmailChange
  git add frontend/src/__tests__/integration/portalEmailChange.test.tsx
  git commit -m "test(frontend): portal email-change page integration tests"
  ```

---

## Task 7: Admin publishers page tests

**Files:**
- New: `frontend/src/__tests__/integration/adminPublishers.test.tsx`

- [ ] **Step 1: Read `frontend/src/app/admin/publishers/page.tsx`** to map every action button to its endpoint.

- [ ] **Step 2: Implement the eight `it(...)` blocks** per the design doc.

- [ ] **Step 3: Run and commit**

  ```bash
  cd frontend && npm run test -- adminPublishers
  git add frontend/src/__tests__/integration/adminPublishers.test.tsx
  git commit -m "test(frontend): admin publishers page integration tests"
  ```

---

## Task 8: Wire frontend tests into CI

**Files:**
- Modify: `frontend/package.json` (build script)
- Modify: `.github/workflows/build-and-test.yml` (test-frontend job)

- [ ] **Step 1: Make `npm run build --workspace=frontend` fail when tests fail**

  Two options:

  - Edit `frontend/package.json` `"build"` to chain: `"build": "npm run test:ci && vite build"`. Mirrors backend's `prebuild → test:ci` flow.
  - OR add a separate CI step in `build-and-test.yml`'s `test-frontend` job:

    ```yaml
    - name: Run frontend tests
      run: npm run test:ci --workspace=frontend
    ```

  Pick the script-chaining option for symmetry with backend.

- [ ] **Step 2: Verify the build fails when a test fails**

  Temporarily add a `expect(true).toBe(false)` in the smoke test, run `npm run build --workspace=frontend`, confirm exit code is non-zero, then revert.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/package.json
  git commit -m "ci(frontend): make build fail on test failure"
  ```

---

## Task 9: Push and open PR

- [ ] **Step 1: Push**

  ```bash
  git push -u origin feat/frontend-portal-integration-tests
  ```

- [ ] **Step 2: Open PR**

  ```bash
  gh pr create --title "test(frontend): publisher portal integration tests" --body "$(cat <<'EOF'
## Summary
- Vitest + happy-dom + `@testing-library/preact` test suite for every publisher portal frontend page (apply, publish/test, portal, login, email-change, admin).
- Each test mocks fetch and drives the page state machine through user events.
- One form-submission test in `portal.test.tsx` pins the `react` → `preact/compat` alias gotcha called out in CLAUDE.md.

## Test plan
- [ ] `npm run test --workspace=frontend` passes locally
- [ ] `npm run build --workspace=frontend` runs tests and fails on test failure
- [ ] CI green on this PR
EOF
  )"
  ```

- [ ] **Step 3: Wait for CI and iterate per global CLAUDE.md PR-iteration rules**
