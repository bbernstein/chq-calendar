# Date Navigation Phase 0 — Deploy Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `deploy-production.yml` from deploying everything on every merge to `main`, so docs- and iOS-only merges deploy nothing and web-only merges skip the six Lambda deploys.

**Architecture:** Two changes to one workflow file. First, a `paths-ignore` filter on the push trigger so merges touching only docs, iOS, or Markdown never start a run. Second, a split of the single `deploy` job into a `changes` detector plus `deploy-backend`, `deploy-frontend`, and `verify` jobs, gated on which areas actually changed and on the absence of a `[skip-deploy: <reason>]` marker in the commit message.

**Tech Stack:** GitHub Actions workflow YAML, bash, vitest (for text-invariant guards on the workflow file).

**Spec:** `docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md` — see the "Phase 0 — deploy gating" section.

## Global Constraints

- **The fork guard must survive on every job.** `if: github.repository == 'bbernstein/chq-calendar'` currently sits on the single `deploy` job. Every job that touches AWS must carry it. A fork would otherwise red-X on every push, or worse, deploy over production if someone added real credentials to the fork's secrets.
- **`environment: production` must be on every job that uses AWS secrets.** Secrets resolve per-job, not per-workflow.
- **`concurrency` moves from job level to workflow level.** `group: deploy-production`, `cancel-in-progress: false`. Two concurrent runs would interleave the `ci-e2e-test` publisher's enable/disable toggles and corrupt the post-deploy retraction assertion.
- **`shared/**` belongs to the FRONTEND filter, not the backend one.** `frontend/src/lib/quickLinks.ts` imports `@shared/links.json` through the `@shared` Vite alias (`frontend/vite.config.ts:132`). Omitting it means a `links.json` edit merges and silently never reaches the header.
- **The `[skip-deploy:]` reason is required.** Match `\[skip-deploy: *[^]]+\]`. A bare `[skip-deploy]` must NOT skip — opting out is a recorded decision, mirroring the `[skip-screenshots: <reason>]` idiom in `.github/workflows/app-store-assets.yml`.
- **No new npm dependencies.** There is no YAML parser in the toolchain and adding one for a workflow test is disproportionate. Guards assert against the workflow file as text.

---

## File Structure

| File | Responsibility |
|---|---|
| `.github/workflows/deploy-production.yml` | Modified. The whole deliverable. |
| `frontend/src/__tests__/deployWorkflow.test.ts` | Created. Text-invariant guards on the workflow file: the ignore list, the frontend filter's membership, the skip-deploy regex shape, and the fork guard's presence on every job. |

Only two files change. The workflow is one file and stays one file — splitting it into reusable workflows would be a larger restructure than this phase needs, and the job-level split already gives the isolation.

---

## Task 1: Stop docs, iOS, and Markdown merges from deploying at all

**Files:**
- Create: `frontend/src/__tests__/deployWorkflow.test.ts`
- Modify: `.github/workflows/deploy-production.yml:3-6` (the `on.push` block)

**Interfaces:**
- Consumes: nothing.
- Produces: a `paths-ignore` list under `on.push` that Task 2 does not modify. The test file created here gains a second `describe` block in Task 2.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/deployWorkflow.test.ts`:

```typescript
// Guards on .github/workflows/deploy-production.yml.
//
// Asserted as TEXT, not parsed YAML: there is no YAML parser in this
// workspace and adding a dependency to test one file would cost more than
// it protects. These assertions are deliberately narrow — they pin the
// specific facts that are expensive to get wrong, not the file's shape.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const WORKFLOW_PATH = resolve(
  __dirname,
  '../../../.github/workflows/deploy-production.yml'
);
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

describe('deploy-production paths-ignore', () => {
  // A merge touching only these paths must not start a run at all. Before
  // this existed, a docs-only merge redeployed six Lambdas, synced S3,
  // invalidated CloudFront and re-triggered three data ingests.
  it.each(["'docs/**'", "'ios/**'", "'**/*.md'"])(
    'ignores %s',
    (pattern) => {
      expect(workflow).toContain(pattern);
    }
  );

  it('declares paths-ignore under the push trigger', () => {
    // Ordering matters: paths-ignore has to sit inside `on.push`, not
    // inside workflow_dispatch (where it is silently meaningless).
    const push = workflow.slice(
      workflow.indexOf('  push:'),
      workflow.indexOf('  workflow_dispatch:')
    );
    expect(push).toContain('paths-ignore:');
  });

  // The single most dangerous thing to add to the ignore list. shared/ is a
  // FRONTEND BUILD INPUT: frontend/src/lib/quickLinks.ts imports
  // @shared/links.json via the Vite alias at vite.config.ts:132. Ignoring it
  // would let a links.json edit merge and never reach the header — a failure
  // indistinguishable from a caching bug.
  it('does NOT ignore shared/', () => {
    expect(workflow).not.toMatch(/paths-ignore:[\s\S]*?- 'shared\/\*\*'/);
  });

  // frontend/ and backend/ must never be ignored either, for the obvious
  // reason. Pinned because an over-eager ignore list is a silent no-deploy.
  it.each(["- 'frontend/**'", "- 'backend/**'"])(
    'does NOT ignore %s',
    (pattern) => {
      const ignoreBlock = workflow.slice(
        workflow.indexOf('paths-ignore:'),
        workflow.indexOf('  workflow_dispatch:')
      );
      expect(ignoreBlock).not.toContain(pattern);
    }
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/deployWorkflow.test.ts`

Expected: FAIL. The four `it.each` ignore assertions and the `paths-ignore:` assertion fail because no `paths-ignore` block exists yet. The three negative assertions pass vacuously — that is correct and expected; they are regression guards, not drivers.

- [ ] **Step 3: Add the paths-ignore block**

In `.github/workflows/deploy-production.yml`, replace:

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
```

with:

```yaml
on:
  push:
    branches: [main]
    # A merge touching ONLY these paths deploys nothing. Before this
    # existed, a docs-only or iOS-only merge redeployed six Lambdas, synced
    # S3, invalidated CloudFront and re-triggered three data ingests.
    #
    # paths-ignore is OR-semantics: a push touching both docs/** and
    # frontend/** still runs, which is what we want — the run is skipped
    # only when EVERY changed file matches.
    #
    # Deliberately NOT listed: shared/**, which is a frontend build input
    # (frontend/src/lib/quickLinks.ts imports @shared/links.json through the
    # Vite alias at vite.config.ts:132). Ignoring it would let a links.json
    # edit merge and silently never reach the header.
    #
    # docs/** IS safe to ignore: the publisher docs that are live content
    # are served from frontend/publish/docs/index.html, a Vite entry
    # (vite.config.ts:154), not from docs/publisher/.
    paths-ignore:
      - 'docs/**'
      - 'ios/**'
      - '**/*.md'
      - '.github/ISSUE_TEMPLATE/**'
  workflow_dispatch:
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/deployWorkflow.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 5: Prove the negative guard actually guards**

A guard that has never failed is not a guard. Temporarily add `- 'shared/**'` to the `paths-ignore` list, run the test, and confirm `does NOT ignore shared/` FAILS. Then remove the line and confirm the suite passes again.

Run: `cd frontend && npx vitest run src/__tests__/deployWorkflow.test.ts`
Expected: FAIL on `does NOT ignore shared/` while the line is present; PASS once removed.

- [ ] **Step 6: Verify the YAML is still valid**

Run:

```bash
python3 -c "import sys; sys.exit(0)" && \
python3 - <<'EOF'
import re, pathlib
text = pathlib.Path('.github/workflows/deploy-production.yml').read_text()
# No YAML lib in this repo's toolchain; assert the structural facts we care
# about rather than a full parse.
assert re.search(r"^on:$", text, re.M), "missing on:"
assert re.search(r"^    paths-ignore:$", text, re.M), "paths-ignore not at 4-space indent under push"
assert text.index('paths-ignore:') < text.index('  workflow_dispatch:'), "paths-ignore must be inside on.push"
print("structure OK")
EOF
```

Expected: `structure OK`.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/deploy-production.yml frontend/src/__tests__/deployWorkflow.test.ts
git commit -m "ci: stop docs, iOS and Markdown merges from deploying

deploy-production.yml triggered on every push to main with no path
filter, so a docs-only or iOS-only merge redeployed six Lambdas, synced
S3, invalidated CloudFront and re-triggered three data ingests.

shared/** is deliberately NOT ignored: frontend/src/lib/quickLinks.ts
imports @shared/links.json through the Vite alias, so ignoring it would
let a links.json edit merge and never reach the header. A test pins that,
verified by adding the pattern and watching it fail.

docs/** is safe to ignore — the publisher docs that are live content are
served from frontend/publish/docs/index.html, a Vite entry."
```

---

## Task 2: Split the deploy by area, with a skip-deploy brake

**Files:**
- Modify: `.github/workflows/deploy-production.yml` (job structure — the single `deploy` job becomes four jobs)
- Modify: `frontend/src/__tests__/deployWorkflow.test.ts` (append a second `describe`)

**Interfaces:**
- Consumes: the `paths-ignore` block from Task 1, unmodified.
- Produces: four jobs — `changes` (outputs `backend`, `frontend`, `skip`), `deploy-backend`, `deploy-frontend`, `verify`. No later task in this phase consumes them.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/__tests__/deployWorkflow.test.ts`:

```typescript
describe('deploy-production job split', () => {
  it.each(['changes:', 'deploy-backend:', 'deploy-frontend:', 'verify:'])(
    'declares the %s job',
    (job) => {
      expect(workflow).toContain(`  ${job}`);
    }
  );

  // Secrets resolve per-job, not per-workflow. A deploy job without this
  // gets no AWS credentials and fails at the first aws call.
  it('puts environment: production on both deploy jobs', () => {
    const occurrences = workflow.match(/^    environment: production$/gm) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  // The fork guard has to be on every job now that there are four. A fork
  // would otherwise red-X on every push, or deploy over production if
  // someone added real credentials to the fork's secrets.
  it('repeats the fork guard on every job', () => {
    const jobs = (workflow.match(/^  [a-z-]+:$/gm) ?? []).filter(
      (j) => j !== '  push:'
    );
    const guards =
      workflow.match(/github\.repository == 'bbernstein\/chq-calendar'/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(jobs.length);
  });

  // Two concurrent runs interleave the ci-e2e-test publisher's
  // enable/disable toggles and corrupt the post-deploy retraction
  // assertion. With four jobs the group has to be workflow-level.
  it('declares concurrency at workflow level, not job level', () => {
    const beforeJobs = workflow.slice(0, workflow.indexOf('\njobs:'));
    expect(beforeJobs).toContain('concurrency:');
    expect(beforeJobs).toContain('group: deploy-production');
    expect(beforeJobs).toContain('cancel-in-progress: false');
  });

  // shared/** must be in the FRONTEND filter. This is the assertion that
  // catches the failure mode where editing links.json deploys nothing that
  // rebuilds the bundle it is compiled into.
  it('routes shared/ to the frontend filter', () => {
    const frontendFilter = workflow.slice(
      workflow.indexOf('FRONTEND_PATHS'),
      workflow.indexOf('BACKEND_PATHS')
    );
    expect(frontendFilter).toContain('shared/');
  });

  // A bare [skip-deploy] must NOT skip. The reason is required, so opting
  // out is a recorded decision rather than silence — same contract as
  // [skip-screenshots: <reason>] in app-store-assets.yml.
  it('requires a non-empty reason on the skip-deploy marker', () => {
    expect(workflow).toContain('skip-deploy: *[^]]\\+');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/deployWorkflow.test.ts`

Expected: FAIL on the four job-name assertions, the `changes`/filter assertions, and the concurrency assertion. Task 1's `describe` still passes.

- [ ] **Step 3: Move concurrency to workflow level**

In `.github/workflows/deploy-production.yml`, insert immediately after the `on:` block and before `jobs:`:

```yaml
# Serialize deploys across every job in this workflow. Two concurrent runs
# would interleave the ci-e2e-test publisher's enable/disable toggles and
# corrupt the post-deploy retraction assertion. cancel-in-progress=false so
# an in-flight deploy completes (including its cleanup trap) before the next
# one starts.
#
# Workflow-level since the job split: a job-level group would serialize each
# job against itself but let a backend deploy from run N overlap a frontend
# deploy from run N+1.
concurrency:
  group: deploy-production
  cancel-in-progress: false
```

Then delete the job-level `concurrency:` block (the four lines beginning `    concurrency:` inside the `deploy` job).

- [ ] **Step 4: Add the `changes` job**

Insert as the first job under `jobs:`, before the existing `deploy` job:

```yaml
  # Which areas this push actually touched, and whether the committer asked
  # to skip deploying. Computed once and consumed by both deploy jobs so the
  # decision lives in exactly one place.
  #
  # Uses plain git rather than a third-party paths-filter action: this needs
  # no new supply-chain dependency, and the logic is four lines.
  changes:
    runs-on: ubuntu-latest
    if: github.repository == 'bbernstein/chq-calendar'
    outputs:
      backend: ${{ steps.detect.outputs.backend }}
      frontend: ${{ steps.detect.outputs.frontend }}
      skip: ${{ steps.detect.outputs.skip }}
    steps:
      - uses: actions/checkout@v7
        with:
          # Two commits so `git diff HEAD^ HEAD` works on a squash merge.
          # 0 (full history) would be slower for no benefit here.
          fetch-depth: 2

      - name: Detect changed areas and the skip-deploy marker
        id: detect
        env:
          # Read via env rather than interpolated into the script: a commit
          # message is attacker-controllable text and must never be spliced
          # into a shell command.
          COMMIT_MESSAGE: ${{ github.event.head_commit.message }}
        run: |
          set -euo pipefail

          BEFORE="${{ github.event.before }}"
          if [ -z "$BEFORE" ] || [ "$BEFORE" = "0000000000000000000000000000000000000000" ]; then
            # First push to the branch, a force-push, or workflow_dispatch —
            # `before` is unusable. Fall back to the single previous commit,
            # and if even that is missing, deploy everything rather than
            # silently deploying nothing.
            CHANGED=$(git diff --name-only HEAD^ HEAD 2>/dev/null || echo "FALLBACK_DEPLOY_ALL")
          else
            CHANGED=$(git diff --name-only "$BEFORE" HEAD 2>/dev/null || echo "FALLBACK_DEPLOY_ALL")
          fi

          echo "Changed files:"
          echo "$CHANGED"

          # FRONTEND_PATHS — anything that changes the built bundle.
          # shared/ is here, NOT in BACKEND_PATHS: frontend/src/lib/quickLinks.ts
          # imports @shared/links.json through the Vite alias at
          # vite.config.ts:132, so a links.json edit must rebuild the frontend.
          FRONTEND_PATHS='^(frontend/|shared/|package\.json|package-lock\.json)'
          # BACKEND_PATHS — anything that changes a Lambda bundle.
          BACKEND_PATHS='^(backend/|shared/|package\.json|package-lock\.json)'

          if [ "$CHANGED" = "FALLBACK_DEPLOY_ALL" ]; then
            echo "frontend=true" >> "$GITHUB_OUTPUT"
            echo "backend=true" >> "$GITHUB_OUTPUT"
          else
            echo "$CHANGED" | grep -qE "$FRONTEND_PATHS" \
              && echo "frontend=true" >> "$GITHUB_OUTPUT" \
              || echo "frontend=false" >> "$GITHUB_OUTPUT"
            echo "$CHANGED" | grep -qE "$BACKEND_PATHS" \
              && echo "backend=true" >> "$GITHUB_OUTPUT" \
              || echo "backend=false" >> "$GITHUB_OUTPUT"
          fi

          # The manual brake. A NON-EMPTY reason is required, so opting out
          # is a recorded decision rather than silence — the same contract
          # as [skip-screenshots: <reason>] in app-store-assets.yml. A bare
          # [skip-deploy] deliberately does NOT match and does NOT skip.
          if printf '%s' "$COMMIT_MESSAGE" | grep -qE '\[skip-deploy: *[^]]+\]'; then
            echo "skip=true" >> "$GITHUB_OUTPUT"
            echo "::notice title=Deploy skipped::[skip-deploy:] marker found in the commit message"
          else
            echo "skip=false" >> "$GITHUB_OUTPUT"
          fi

      - name: Summary
        run: |
          echo "backend=${{ steps.detect.outputs.backend }}"
          echo "frontend=${{ steps.detect.outputs.frontend }}"
          echo "skip=${{ steps.detect.outputs.skip }}"
```

- [ ] **Step 5: Rename `deploy` to `deploy-backend` and gate it**

Change the existing job header from:

```yaml
  deploy:
    runs-on: ubuntu-latest
    environment: production
    if: github.repository == 'bbernstein/chq-calendar'
```

to:

```yaml
  deploy-backend:
    runs-on: ubuntu-latest
    environment: production
    needs: changes
    if: >-
      github.repository == 'bbernstein/chq-calendar'
      && needs.changes.outputs.skip != 'true'
      && needs.changes.outputs.backend == 'true'
```

Then **delete these two steps from this job** (they move to `deploy-frontend` in Step 6):

- `- name: Build frontend` (currently at `:64`)
- `- name: Deploy frontend to S3 and CloudFront` (currently at `:472`)

And **delete this step** (it moves to `verify` in Step 7):

- `- name: Run post-deployment tests` (currently at `:533`)

Also delete the two `Notify deployment success` / `Notify deployment failure` steps at the end — they move to `verify`.

Everything else stays: the six Lambda deploy steps, both publisher E2E steps, the dev-dependency reinstall, the lifecycle smoke, and the three data-sync triggers.

- [ ] **Step 6: Add the `deploy-frontend` job**

Insert after `deploy-backend`:

```yaml
  # Build + publish the static site. Independent of the Lambda deploys: a
  # frontend-only merge has no reason to redeploy six functions or
  # re-trigger three data ingests.
  deploy-frontend:
    runs-on: ubuntu-latest
    environment: production
    needs: changes
    if: >-
      github.repository == 'bbernstein/chq-calendar'
      && needs.changes.outputs.skip != 'true'
      && needs.changes.outputs.frontend == 'true'

    steps:
      - uses: actions/checkout@v7

      - name: Use Node.js 24
        uses: actions/setup-node@v7
        with:
          node-version: "24"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v5
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Build frontend
        working-directory: ./frontend
        run: npm run build

      - name: Deploy frontend to S3 and CloudFront
        working-directory: ./frontend
        run: |
          # (Paste the body of the existing "Deploy frontend to S3 and
          # CloudFront" step here VERBATIM — the two-pass sync, the
          # manifest/version/sw uploads, the weekly-themes upload, and the
          # CloudFront invalidation. Do not re-derive it: the two-pass
          # arrangement and its exclusions are load-bearing, and the
          # rationale is in the comments inside that step.)
```

**Important:** copy the `Configure AWS credentials` step's exact `uses:` version and input names from the existing job at `:51` rather than trusting the snippet above — the pinned major version must match what the repo already uses.

- [ ] **Step 7: Add the `verify` job**

Insert after `deploy-frontend`:

```yaml
  # Cross-cutting post-deploy smoke. Separate from both deploy jobs because
  # it exercises the API *and* the site, so it belongs to neither and must
  # run whichever one deployed.
  #
  # always() so it still runs when one deploy job was skipped; the explicit
  # result checks below stop it running when a deploy actually FAILED, and
  # stop it running at all when nothing deployed.
  verify:
    runs-on: ubuntu-latest
    needs: [changes, deploy-backend, deploy-frontend]
    if: >-
      always()
      && github.repository == 'bbernstein/chq-calendar'
      && needs.deploy-backend.result != 'failure'
      && needs.deploy-frontend.result != 'failure'
      && (needs.deploy-backend.result == 'success' || needs.deploy-frontend.result == 'success')

    steps:
      - name: Run post-deployment tests
        continue-on-error: true
        run: |
          # (Paste the body of the existing "Run post-deployment tests" step
          # here VERBATIM.)

      - name: Notify deployment success
        if: success()
        run: |
          echo "::notice title=Deployment Successful::Production deployment completed successfully at $(date)"

      - name: Notify deployment failure
        if: failure()
        run: |
          echo "::error title=Deployment Failed::Production deployment failed. Check logs for details."
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/deployWorkflow.test.ts`

Expected: PASS, both `describe` blocks.

- [ ] **Step 9: Prove the skip-deploy regex rejects a bare marker**

The whole point of the required reason is that `[skip-deploy]` must not work. Verify the regex directly rather than trusting it:

```bash
for msg in "fix: thing [skip-deploy: verified locally]" \
           "fix: thing [skip-deploy]" \
           "fix: thing [skip-deploy: ]" \
           "fix: ordinary commit"; do
  if printf '%s' "$msg" | grep -qE '\[skip-deploy: *[^]]+\]'; then
    echo "SKIP    <- $msg"
  else
    echo "DEPLOY  <- $msg"
  fi
done
```

Expected output, exactly:

```
SKIP    <- fix: thing [skip-deploy: verified locally]
DEPLOY  <- fix: thing [skip-deploy]
DEPLOY  <- fix: thing [skip-deploy: ]
DEPLOY  <- fix: ordinary commit
```

If `[skip-deploy]` or `[skip-deploy: ]` reports SKIP, the regex is wrong — fix it before continuing.

- [ ] **Step 10: Verify the whole suite and the workflow structure**

Run:

```bash
cd frontend && npm run build && npx vitest run
cd ../backend && npm run validate
```

Expected: frontend build clean, all tests pass, backend validate clean.

Then confirm no job lost its fork guard:

```bash
grep -c "github.repository == 'bbernstein/chq-calendar'" .github/workflows/deploy-production.yml
```

Expected: `4` (one per job).

- [ ] **Step 11: Commit**

```bash
git add .github/workflows/deploy-production.yml frontend/src/__tests__/deployWorkflow.test.ts
git commit -m "ci: split production deploy by area, add a skip-deploy brake

The single deploy job redeployed six Lambdas, synced S3, invalidated
CloudFront and re-triggered three data ingests on every merge, whatever
changed. Now a changes job detects which areas moved and deploy-backend /
deploy-frontend run independently, with a cross-cutting verify job for the
post-deploy smoke that exercises both.

shared/ routes to the FRONTEND filter, not the backend one:
frontend/src/lib/quickLinks.ts imports @shared/links.json through the Vite
alias, so a links.json edit must rebuild the bundle it is compiled into.

[skip-deploy: <reason>] in the commit message is the manual brake. The
reason is required — a bare [skip-deploy] deliberately does not match — so
opting out is a recorded decision, matching the [skip-screenshots: <reason>]
contract in app-store-assets.yml. Verified against all four message shapes.

concurrency moves to workflow level: a job-level group would serialize each
job against itself but let run N's backend deploy overlap run N+1's
frontend deploy."
```

---

## Post-merge verification

CI changes cannot be fully tested before merge — the trigger only fires on push to `main`. After this merges, confirm on the next few merges:

1. **A docs-only merge** (the Phase 1 plan commit is one) shows **no workflow run at all** in the Actions tab.
2. **A frontend-only merge** shows `changes` → `deploy-frontend` → `verify`, with `deploy-backend` skipped.
3. **This merge itself** changes only `.github/workflows/**` (plus a test and docs). That path matches neither `paths-ignore` nor either area filter, so the run **starts** — `changes` executes and reports `frontend=false backend=false` — and then **both deploy jobs and `verify` skip. Nothing is deployed.** That is correct behaviour, not a failure of the gating: a workflow-file edit changes no Lambda bundle and no frontend bundle, so there is nothing to ship. Expect a green run with three skipped jobs, and do not read the skips as a bug. If you actually want the deploy, use the `workflow_dispatch` escape hatch, which force-deploys both areas by design.

If step 1 does not hold, the likeliest cause is that the merge also touched a non-ignored path. Check the run's `changes` job summary output before changing the filter.
