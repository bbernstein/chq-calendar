# CI coverage floor (design)

**Date:** 2026-05-06
**Status:** Approved, ready for implementation plan
**Origin:** Backend tests already produce coverage (`test:ci` runs with `--coverage` and uploads the artifact). Frontend tests are arriving via the frontend-portal-integration-tests spec. We have no enforcement that new code carries tests; coverage can drift quietly downward.

## Problem

Coverage is reported but not enforced. New code with no tests is indistinguishable in CI from new code with tests. The quickest way to establish discipline without writing exhaustive policy is a per-PR check that fails when line coverage drops below a baseline measured the moment we turn the gate on.

## Policy

- Treat coverage as a one-way ratchet: today's number is the floor; drops fail.
- Floor lives in a checked-in config file, not as workflow inline magic, so it's diff-reviewable and bumps are visible.
- Apply the floor per-package (backend, frontend) — they have different baselines and different test stacks.
- Allow a tight per-PR negative tolerance (e.g. -0.5%) to avoid flapping on tiny refactors that change branch counts; PRs that genuinely lower coverage must raise the floor or add tests.
- Block the merge via the existing required-check mechanism (no new check needed; the existing `test-backend` / `test-frontend` jobs fail).

## Scope

### In

- Line coverage (the metric Jest already produces).
- Backend (`backend/`).
- Frontend (`frontend/`) — once the frontend-portal-integration-tests spec lands. If frontend tests aren't in place yet when this is implemented, frontend gating is added in a follow-up commit, not deferred indefinitely.

### Out

- Per-file or per-directory floors (operationally noisy).
- Branch / function / statement coverage (line is the simplest signal; can be added later if line coverage proves insufficient).
- Mutation testing (separate concern).
- Codecov / Coveralls integration (we don't need a third-party dashboard for this; the CI log is enough).

## Architecture

```
.coverage-floor.json                     # checked in; the floor numbers
backend/jest.config.js                   # add coverageThreshold block referencing the floor
frontend/vitest.config.ts                # add coverage.threshold block referencing the floor
.github/workflows/build-and-test.yml     # no change required if Jest/Vitest enforces it
```

`.coverage-floor.json`:

```json
{
  "backend": { "lines": 78.0 },
  "frontend": { "lines": 65.0 }
}
```

(Numbers will be set during implementation by reading the actual current coverage on `main` and rounding down by 0.5%.)

### Enforcement mechanism

Jest:

```js
// backend/jest.config.js
const floor = require('../.coverage-floor.json').backend;
module.exports = {
  // ... existing config
  coverageThreshold: {
    global: { lines: floor.lines },
  },
};
```

Vitest (frontend, when wired):

```ts
// frontend/vitest.config.ts
import floor from '../.coverage-floor.json';
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      thresholds: { lines: floor.frontend.lines },
    },
  },
});
```

If coverage drops below the floor, Jest/Vitest exits non-zero and the existing CI job fails. No new workflow step.

### Updating the floor

Two paths:

1. **Manual bump** (preferred for big jumps): edit `.coverage-floor.json` in the same PR that adds tests.
2. **Auto-bump on `main` merge** (optional follow-up — out of this spec): a workflow that, after a successful `main` merge, computes coverage and PRs the new floor. Not built here; mentioned only so it's not forgotten.

### What if a refactor genuinely lowers coverage?

Author manually lowers the floor in `.coverage-floor.json` in the same PR. Reviewer sees the diff and decides whether the drop is acceptable. The point is *visibility*, not absolutism.

## Implementation order

The implementation plan should:

1. Add `.coverage-floor.json` with backend floor only.
2. Wire Jest's `coverageThreshold`.
3. Verify CI runs the coverage report (the existing `test:ci` script already does).
4. Document in CLAUDE.md or a new `docs/coverage.md` how to bump the floor.
5. (Frontend portion) Once frontend tests exist, add `frontend.lines` to the JSON and wire Vitest's threshold.

## CI integration

No workflow file changes required. The check rides on the existing `test-backend` / `test-frontend` jobs already invoked by `npm run build`. Threshold violations fail the existing required check.

## Non-goals

- Coverage badges
- Coverage trend graphs
- Per-PR coverage diff comments
- Mutation testing

## Risks

- **Floor flapping on tiny PRs.** Mitigation: pick the floor 0.5% below current; reassess if flapping appears.
- **Generated code dragging coverage down.** Mitigation: ensure `coveragePathIgnorePatterns` excludes `dist/`, `node_modules/`, `**/refs/`, generated `.d.ts`, etc. Check `backend/jest.config.js` already has reasonable excludes; add to it if not.
- **Floor never raises.** Mitigation: documented runbook step: when the test PR adds significant coverage, raise the floor in the same PR.

## File counts (estimated)

- New JSON file: 5 lines
- Jest config edit: 5 lines
- Vitest config edit (when applicable): 5 lines
- Doc page: 30–40 lines
- Total: ~50–60 lines
