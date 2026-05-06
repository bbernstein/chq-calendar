# Coverage floor policy

The repo enforces a one-way **line-coverage** ratchet on a per-package basis. CI fails if any package's measured line coverage drops below its checked-in floor.

## Where the floor lives

A single file at the repo root:

```
.coverage-floor.json
```

```json
{
  "backend": { "lines": 81.1 },
  "frontend": { "lines": 0 }
}
```

`frontend.lines: 0` is an explicit "no gate" — it will be raised to a real number once the frontend test infrastructure (Vitest + integration tests) lands.

## How CI enforces it

There is **no separate CI step**. The package's existing test runner reads `.coverage-floor.json` and uses its native threshold mechanism:

- **Backend (Jest)** — `backend/jest.config.js` reads the JSON via `require('../.coverage-floor.json')` and sets `coverageThreshold.global.lines`. The existing `backend && npm run test:ci` job already runs `jest --coverage`, so a drop below the floor causes Jest to exit non-zero and fails the existing test job.
- **Frontend (Vitest)** — when added, `frontend/vitest.config.ts` will read the JSON and set `test.coverage.thresholds.lines`.

## What's measured

- **Line coverage only.** Branch / function / statement coverage are not gated.
- **Per-package globals only.** No per-file floors.
- The backend number is computed over `src/**/*.ts` *minus* the exclusions in `backend/jest.config.js` (`collectCoverageFrom` / `coveragePathIgnorePatterns`):
  - `src/handlers/*.ts` — Lambda entry points; tested via integration tests, not unit coverage
  - `src/scripts/*.ts` — CLI scripts
  - `*.d.ts`, `dist/`, `refs/`, `__tests__/`, `node_modules/`

## How to bump the floor (raise it)

When you add tests that meaningfully raise coverage, edit `.coverage-floor.json` in the **same PR** that adds the tests. The reviewer sees the diff and can sanity-check the new number.

Pick the new floor as `(measured% rounded down to one decimal) − 0.5%`. The 0.5% headroom absorbs day-to-day noise from minor refactors.

Example: PR adds tests that bump backend coverage from 81.62% to 84.31%. New floor = 84.3 − 0.5 = **83.8**.

## How to lower the floor

**Only with explicit reviewer sign-off.** Lowering the floor undoes the ratchet, so:

1. Mention the lowering in the PR description, with a one-line rationale (e.g. "Removed feature X reduces denominator by 4 files").
2. Get a reviewer to acknowledge the lowered number.
3. Pick the new floor at `(measured% rounded down to one decimal) − 0.5%` against the new code.

Do **not** lower the floor as a quick fix for a coverage failure. Add tests instead, or revert the change that dropped coverage.

## Local verification

```bash
# Backend
cd backend && npm run test:ci
# Jest exits non-zero with "coverage threshold for lines (X%) not met" if you drop below.
```

## What's NOT enforced

- Branch / function / statement coverage
- Per-file thresholds
- Coverage on Lambda handlers (`src/handlers/*`) — those are covered by integration tests run separately
- Coverage on CLI scripts (`src/scripts/*`)
