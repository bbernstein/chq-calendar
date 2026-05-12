# Backend ESLint + Code Cleanup Plan

> **For agentic workers:** Self-contained plan for a fresh session. Use
> `superpowers:executing-plans` or `superpowers:subagent-driven-development` to
> work through phases. Tasks within a phase that don't share files can be done
> in parallel; phases themselves are sequential because later ones consume
> outputs from earlier ones.

**Goal:** Bring the backend up to the same lint/type discipline the frontend
already enforces, then fix anything the new lint pass surfaces. Wire it into CI
so regressions can't ship.

**Why this exists:** As of 2026-05-12 the backend has TypeScript, jest tests,
and a multi-target esbuild bundle, but no ESLint config and no `lint` script.
`npm run lint --workspace=chautauqua-backend` errors with "Missing script". The
frontend cleanup PR (#123) closed the last two frontend ESLint warnings; the
backend has never had a pass run against it.

**Tech stack:** Node 22 / TypeScript 5 / jest / esbuild bundler / AWS SDK v3 /
DynamoDB DocumentClient. Frontend lint stack (already proven on the same repo):
`eslint`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`.

---

## Out of Scope

- **Migrating jest → vitest.** Different initiative; mention only if it
  happens to come up while reading test files.
- **Adding pre-commit hooks.** Could be a follow-up, but CI enforcement is
  enough for first pass.
- **Adding ESLint to `tools/publisher-format/`.** That package builds the
  `dist/refs` schemas the backend consumes. Same approach would work but
  belongs in its own PR — it changes a different `package.json`.

---

## Phase 1: Install + configure ESLint

### Task 1A: Add dependencies + config

**Files:**
- Modify: `backend/package.json`
- Create: `backend/eslint.config.mjs` (flat-config; matches the frontend's
  `frontend/eslint.config.mjs`. Don't introduce a legacy `.eslintrc.*`
  alongside the existing flat config — one style per repo).
- Create: `backend/.eslintignore` (entries for `dist/`, `coverage/`,
  `node_modules/`, and any other generated paths). With flat config the
  ignore patterns can live inside `eslint.config.mjs` instead; either
  shape is fine, but pick one and don't have both.

**Steps:**
1. Inspect `frontend/eslint.config.mjs` for the version of eslint and
   `@typescript-eslint/*` it uses. Match the major version. The goal is
   one ESLint version in the repo, not two.
2. Add eslint + typescript-eslint deps to `backend/package.json` under
   `devDependencies`. Pin to the same major as frontend.
3. Author the backend config:
   - Extends: `eslint:recommended`, `plugin:@typescript-eslint/recommended`
     (or the flat-config equivalents)
   - `parserOptions.project: ['./tsconfig.json']`
   - Override rules for test files (`**/__tests__/**`) to allow `as any` and
     looser unused-var rules — backend tests use type-erasing casts heavily
     in mock setup; mirror what the frontend's lint config does for tests
     before reinventing.
4. Add scripts to `backend/package.json`:
   ```json
   "lint": "eslint src/",
   "validate": "tsc --noEmit && npm run lint"
   ```
5. Run `npm install` at the repo root (workspaces) to update the lockfile.
6. Sanity-check: `npm run lint --workspace=chautauqua-backend` exits with a
   real lint result (success or warnings), not "Missing script".

**Verification:**
- `npm run lint --workspace=chautauqua-backend` runs to completion
- No new dependencies in `frontend/` (deps belong in the workspace that uses them)
- Lockfile committed

### Task 1B: Capture baseline + categorize findings

**Files:** none — investigation only

**Steps:**
1. Run `npm run lint --workspace=chautauqua-backend 2>&1 | tee /tmp/backend-lint.log`
2. Categorize hits into buckets:
   - **Real bugs** (e.g., `no-undef`, shadowed variables, unused imports
     hiding broken refactors) — fix in Phase 2
   - **Style/consistency** (e.g., `prefer-const`, `no-unused-vars`) — fix in
     Phase 2
   - **Type-safety** (e.g., `@typescript-eslint/no-explicit-any`) — may need
     a rule-level decision; document each in the plan as you fix
   - **Genuinely-noisy rules** (e.g., `no-non-null-assertion` if it triggers
     constantly on `process.env.X!` patterns) — consider disabling the rule
     globally rather than `// eslint-disable-next-line`ing dozens of sites
3. Write the categorized count back into this file's "Baseline" section
   below, so the next executor knows what they're walking into.

**Baseline** (fill in after running):
- Total problems: TBD
- Errors: TBD
- Warnings: TBD
- Top 5 rules by hit count: TBD

---

## Phase 2: Fix what lint surfaces

Sequential because each fix may touch shared files, but tasks can be split by
subdirectory if hit count is high.

### Task 2A: Auto-fix the trivially mechanical

**Files:** whatever `eslint --fix` touches

**Steps:**
1. Run `npm run lint --workspace=chautauqua-backend -- --fix`
2. Review the diff carefully — auto-fix is reasonable for `prefer-const`,
   unused-import removal, and quote/semi normalization, but NOT for
   `no-explicit-any` and similar judgment-call rules.
3. Commit auto-fixes in a single commit:
   `chore(backend): eslint --fix mechanical cleanups`
4. Run the test suite (`npm test --workspace=chautauqua-backend`) to verify
   nothing broke.

### Task 2B: Manual cleanups by category

For each remaining hit, decide:
- **Fix** — edit the code (preferred for real bugs and style nits)
- **Suppress at site** with `// eslint-disable-next-line <rule>` and a
  comment explaining why — only when the rule is wrong for that specific
  context (e.g., a deliberately-broad `any` in a JSON parser)
- **Disable the rule globally** — only when the rule fires >20 times across
  the codebase and is genuinely not catching real issues. Add a justification
  comment in the config explaining the decision.

**Files:** TBD based on Phase 1B output

**Commit shape:** one commit per category if they're cleanly separable
(e.g., `chore(backend): fix no-unused-vars across handlers`,
`chore(backend): replace as-any in registry service with typed shapes`).
This keeps reverts narrow if review surfaces a regression.

### Task 2C: Test files

Backend tests almost certainly have `as any` casts for mock setup and a few
`@ts-ignore`s for shimming DDB types. The frontend takes the position that
tests can be looser than prod code; mirror that in the eslint override for
`backend/src/__tests__/**`. Don't try to lint tests to the same standard as
prod code — it's a losing battle and adds noise without value.

---

## Phase 3: Wire into CI

### Task 3A: Add backend lint to the build-and-test workflow

**Files:**
- Modify: `.github/workflows/build-and-test.yml`

> ⚠️ **Permission note for automated agents:** GitHub blocks the default
> `GITHUB_TOKEN` (and most installed GitHub Apps, including Claude Code)
> from modifying files under `.github/workflows/` — this step usually
> requires a human-authored commit, or a personal access token with the
> `workflow` scope wired through `actions/checkout`. If the agent's commit
> is rejected with `refusing to allow a GitHub App to create or update
> workflow .github/workflows/build-and-test.yml`, hand off this task to a
> human collaborator and proceed with the rest of the plan; the lint
> script and config can ship without the CI wiring and someone can land
> the workflow change in a follow-up commit.

**Steps:**
1. The workflow already runs frontend `npm run validate` (type-check + lint).
   Add an equivalent step for the backend workspace.
2. Use the existing `test-backend` job matrix as the host — don't create a
   new job, just add a `Run backend lint` step before or after the existing
   test step. Lint failures should block the same way test failures do.
3. Verify in CI before merging by intentionally introducing a lint error on
   the PR branch and confirming the check fails.

**Verification:**
- The build-and-test workflow now runs `npm run lint --workspace=chautauqua-backend`
- An intentional lint error fails the PR check
- Removing the intentional error restores green

### Task 3B: Document the lint expectation

**Files:**
- Modify: `CLAUDE.md` (project root)

**Steps:**
1. The verification checklist section says "Run this after every set of
   changes" and lists `npm run validate` (frontend only). Update it to
   include the backend equivalent.
2. Mention that the backend now has its own ESLint config and that new code
   should pass it before being committed.

---

## Phase 4: Non-lint cleanup (opportunistic)

These don't need ESLint to surface but are worth doing while you're already
in the backend. Skip any that turn out to be noisy or risky — none are
blocking.

### Task 4A: Dead-code scan

**Tooling:** `ts-prune` or `knip` (whichever the executor prefers — both
identify unused exports). One-shot install, run, capture output, evaluate.

**Steps:**
1. `npx ts-prune --project backend/tsconfig.json | tee /tmp/backend-deadcode.log`
2. Categorize each hit:
   - **True dead code** — delete it
   - **Used only by tests** — keep but mark with `// @internal` in a
     doc-comment or move to a `__test-helpers__` directory if there are
     several
   - **Public API surface (e.g., handler entries)** — false positive,
     ignore
3. Commit deletions in one commit per logical group.

### Task 4B: Comment cleanup

Backend has accumulated some long comment blocks that explain code that has
since been simplified, plus a few `// removed` / `// TODO` markers.

**Steps:**
1. Grep: `grep -rn 'TODO\|FIXME\|// removed\|// REMOVED' backend/src --include='*.ts'`
2. For each hit, either resolve the TODO, file a GitHub issue and remove
   the comment, or leave it if it's a genuine open question.
3. Per `CLAUDE.md` (root): "Default to writing no comments. Only add one
   when the WHY is non-obvious." Drop comments that just narrate WHAT the
   code does.

### Task 4C: `dist/` cleanliness

`backend/dist/` is committed to git in this repo (it's the bundled Lambda
output). After landing big refactors there's sometimes stale `dist/refs/`
content. Confirm `dist/` regenerates byte-for-byte the same on `npm run
build:prod` from a clean tree before declaring this task done.

**Verification:**
- `rm -rf backend/dist && npm run build:prod --workspace=chautauqua-backend`
  produces the same content as git HEAD (modulo any timestamp embeds)

---

## Phase 5: Open the PR

Use the same shape as PRs #116, #122, #123:

- One feature branch per phase if hit counts are high
- One PR per branch
- PR body: list each commit's purpose, link Phase 1B's baseline output, note
  any rules globally disabled with justification

If Phase 2 produces a very large diff, split it into review-sized chunks
rather than one mega-PR. Each chunk should leave `npm run lint` and
`npm test` green.

---

## Self-review

Before opening the PR(s):
- [ ] `npm run lint --workspace=chautauqua-backend` exits 0 (or with only
      deliberately-allowed warnings)
- [ ] `npm test --workspace=chautauqua-backend` green
- [ ] CI workflow change tested by intentionally breaking lint on the PR
      branch
- [ ] No new ESLint major version diverges from the frontend's
- [ ] No comments left in code that reference "PR #N" — those belong in PR
      descriptions, not source files
