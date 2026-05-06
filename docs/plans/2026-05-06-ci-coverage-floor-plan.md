# CI coverage floor (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a one-way line-coverage ratchet for backend (and frontend, when applicable) that fails CI when coverage drops below a checked-in floor.

**Spec:** `docs/plans/2026-05-06-ci-coverage-floor-design.md`

**Architecture:** A single `.coverage-floor.json` at the repo root holds per-package floor numbers. Jest and Vitest read it via their own `coverageThreshold` / `coverage.thresholds` configs. No new CI step.

**Tech Stack:** Jest (backend), Vitest (frontend, optional), JSON config.

**Branch:** create `chore/ci-coverage-floor` off `main`.

**Prerequisite for the frontend portion:** the `frontend-portal-integration-tests` plan must have landed and produced a real frontend coverage number to floor against. Backend portion has no prerequisites.

---

## Task 1: Measure today's backend coverage

- [ ] **Step 1: Run coverage on `main`**

  ```bash
  git checkout main && git pull
  cd backend && npm run test:ci
  ```

  Open `backend/coverage/coverage-summary.json` (or `lcov-report/index.html`). Record:
  - Lines: `__.__%`

  If the integration tests from `publisher-integration-tests-plan` have landed, this number will be higher; that's the right baseline to floor against. If they haven't landed, decide whether to wait or floor at the lower number — the design spec recommends *picking the floor 0.5% below the current measurement either way*.

- [ ] **Step 2: Pick the floor**

  Round down to one decimal place, then subtract 0.5%. Example: measured 78.42% → floor = 77.9.

  Record in this plan as `BACKEND_FLOOR_LINES`.

---

## Task 2: Add `.coverage-floor.json`

**Files:**
- New: `.coverage-floor.json` (repo root)

- [ ] **Step 1: Create the file**

  ```json
  {
    "backend": { "lines": 77.9 },
    "frontend": { "lines": null }
  }
  ```

  (Replace 77.9 with the value from Task 1.)

- [ ] **Step 2: Commit**

  ```bash
  git checkout -b chore/ci-coverage-floor
  git add .coverage-floor.json
  git commit -m "chore(ci): add coverage floor config"
  ```

---

## Task 3: Wire Jest's `coverageThreshold`

**Files:**
- Modify: `backend/jest.config.js`

- [ ] **Step 1: Read existing config**

  Confirm coverage settings (collectCoverageFrom, coveragePathIgnorePatterns) are reasonable. Add to `coveragePathIgnorePatterns` if missing:

  ```js
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/', '/refs/', '\\.d\\.ts$', '/__tests__/']
  ```

- [ ] **Step 2: Add `coverageThreshold`**

  At the top of the file:

  ```js
  const floor = require('../.coverage-floor.json');
  ```

  In the export:

  ```js
  coverageThreshold: {
    global: { lines: floor.backend.lines },
  },
  ```

- [ ] **Step 3: Verify it enforces**

  Confirm the threshold passes today:

  ```bash
  cd backend && npm run test:ci
  ```

  Then *temporarily* bump the floor to 99.9, rerun, and confirm Jest exits non-zero with a coverage-threshold message. Revert.

- [ ] **Step 4: Commit**

  ```bash
  git add backend/jest.config.js
  git commit -m "chore(ci): enforce backend line coverage floor via Jest"
  ```

---

## Task 4: Document the floor and how to bump it

**Files:**
- New: `docs/coverage.md`
- Modify: `CLAUDE.md` (add a one-liner pointer)

- [ ] **Step 1: Write `docs/coverage.md`**

  Cover:
  - What the floor means (line coverage, per-package, one-way ratchet)
  - Where it's stored (`.coverage-floor.json`)
  - How CI enforces it (Jest/Vitest threshold; no separate workflow step)
  - How to bump it: edit the JSON in the same PR that adds the tests; reviewer sees the diff
  - When to lower it: only with explicit reviewer sign-off; mention it in the PR description
  - What's *not* enforced (branch / function / statement coverage; per-file floors)

- [ ] **Step 2: Add a pointer in CLAUDE.md**

  Under the "Verification Checklist" section, add a bullet:
  - "Coverage floor enforced via `.coverage-floor.json`; see `docs/coverage.md`."

- [ ] **Step 3: Commit**

  ```bash
  git add docs/coverage.md CLAUDE.md
  git commit -m "docs(ci): coverage floor policy and bump procedure"
  ```

---

## Task 5: Frontend portion (gated on frontend tests existing)

**Files (only if frontend tests exist):**
- Modify: `.coverage-floor.json` (set `frontend.lines`)
- Modify: `frontend/vitest.config.ts`

- [ ] **Step 1: Check whether frontend tests exist**

  ```bash
  ls frontend/src/__tests__/integration 2>/dev/null && echo "exists" || echo "skip"
  ```

  If "skip", stop here and proceed to Task 6. The frontend portion lands in a separate PR after the `frontend-portal-integration-tests` plan completes.

- [ ] **Step 2: Measure frontend coverage**

  ```bash
  cd frontend && npm run test:ci
  ```

  Floor = measured% - 0.5%, rounded down to one decimal.

- [ ] **Step 3: Update JSON + Vitest config**

  ```json
  "frontend": { "lines": 64.5 }
  ```

  In `vitest.config.ts`:

  ```ts
  import floor from '../.coverage-floor.json';

  export default defineConfig({
    test: {
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov', 'json-summary'],
        thresholds: { lines: floor.frontend.lines },
      },
    },
  });
  ```

- [ ] **Step 4: Verify enforcement**

  Bump to 99.9 temporarily, confirm `npm run test:ci --workspace=frontend` fails, revert.

- [ ] **Step 5: Commit**

  ```bash
  git add .coverage-floor.json frontend/vitest.config.ts
  git commit -m "chore(ci): enforce frontend line coverage floor via Vitest"
  ```

---

## Task 6: Push and open PR

- [ ] **Step 1: Push and PR**

  ```bash
  git push -u origin chore/ci-coverage-floor
  gh pr create --title "chore(ci): enforce per-package line coverage floor" --body "$(cat <<'EOF'
## Summary
- New `.coverage-floor.json` at repo root holds per-package floors.
- Jest's `coverageThreshold` enforces the backend floor; existing `test-backend` job fails on drop.
- (If included) Vitest enforces the frontend floor.
- Floor numbers picked at 0.5% below today's measured coverage.

## Test plan
- [ ] Backend tests pass at current coverage
- [ ] Backend tests fail when floor is bumped to 99.9 (verified locally)
- [ ] CI green on this PR
EOF
  )"
  ```

- [ ] **Step 2: Iterate per global PR-iteration rules**
