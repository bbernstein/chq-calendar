# Date Navigation Phase 0 — Deploy Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `deploy-production.yml` from deploying everything on every merge to `main`, so docs- and iOS-only merges deploy nothing and web-only merges skip the six Lambda deploys.

**Architecture:** Two changes to one workflow file. First, a `paths-ignore` filter on the push trigger so merges touching only iOS or Markdown never start a run. Second, a split of the single `deploy` job into a `changes` detector plus `deploy-backend`, `deploy-frontend`, and `verify` jobs, gated on which areas actually changed and on the absence of a `[skip-deploy: <reason>]` marker in the commit **subject**.

**Tech Stack:** GitHub Actions workflow YAML, bash, vitest (for text-invariant guards on the workflow file).

**Spec:** `docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md` — see the "Phase 0 — deploy gating" section.

## Global Constraints

- **The fork guard must survive on every job.** `if: github.repository == 'bbernstein/chq-calendar'` currently sits on the single `deploy` job. Every job that touches AWS must carry it. A fork would otherwise red-X on every push, or worse, deploy over production if someone added real credentials to the fork's secrets.
- **`environment: production` must be on every job that uses AWS secrets.** Secrets resolve per-job, not per-workflow.
- **`concurrency` moves from job level to workflow level.** `group: deploy-production`, `cancel-in-progress: false`. Two concurrent runs would interleave the `ci-e2e-test` publisher's enable/disable toggles and corrupt the post-deploy retraction assertion.
- **`shared/**` must be in the FRONTEND filter.** `frontend/src/lib/quickLinks.ts` imports `@shared/links.json` through the `@shared` Vite alias (`frontend/vite.config.ts:132`). Omitting it means a `links.json` edit merges and silently never reaches the header. It is in `BACKEND_PATHS` too, as a conservative over-deploy — no backend source reads `shared/` today, and if one ever does the filter already covers it. (An earlier draft said "FRONTEND, **not** the backend one"; that phrasing contradicted the shipped filters and is corrected here.)
- **`docs/**` must NOT be ignored, and `docs/publisher/` and `tools/` must be in `BACKEND_PATHS`.** `docs/publisher/categories.json` and `docs/publisher/venues.json` are copied into `tools/publisher-format/dist/refs` by its `copy-refs` script, then into `backend/dist/refs` by backend's `build:prod`, and shipped inside the admin and publisher-ingest Lambda zips. `backend/package.json` also depends on the `@chq-calendar/publisher-format` workspace at `tools/publisher-format`, which esbuild inlines into `adminHandler.js` and `publisherIngestHandler.js`. An earlier draft of this plan ignored `docs/**` and listed neither path in a filter; both produced a silent no-deploy that reported green.
- **The `[skip-deploy:]` reason is required.** Match `\[skip-deploy: *[^][:space:]][^]]*\]`. A bare `[skip-deploy]` must NOT skip — opting out is a recorded decision, mirroring the `[skip-screenshots: <reason>]` idiom in `.github/workflows/app-store-assets.yml`. **Do not "simplify" this to `\[skip-deploy: *[^]]+\]`** (the form an earlier draft of this plan specified): against `[skip-deploy: ]` the ` *` backtracks to zero and `[^]]+` consumes the space itself, so a whitespace-only reason skips the deploy.
- **Feed `grep -q` from a herestring, never a pipe.** Under `set -o pipefail`, `grep -q` exits at the first match and the writer takes SIGPIPE, so the pipeline reports 141 and the `|| ...=false` branch runs even though the pattern MATCHED. Reproduced with a 5.5MB all-frontend file list: `echo "$CHANGED" | grep -qE ...` yields `frontend=false` — a silent no-deploy of a frontend change. Earlier drafts of this plan used the pipe form throughout.
- **No new npm dependencies.** There is no YAML parser in the toolchain and adding one for a workflow test is disproportionate. Guards assert against the workflow file as text.

---

## File Structure

| File | Responsibility |
|---|---|
| `.github/workflows/deploy-production.yml` | Modified. The whole deliverable. |
| `frontend/src/__tests__/deployWorkflow.test.ts` | Created. Text-invariant guards on the workflow file: the ignore list (including that `docs/` is NOT in it), both filters' membership, the skip-deploy regex shape, and the fork guard's presence on every job — asserted per-job by parsing the job names out of the `jobs:` block, not as a count. A count is satisfied by a 5th *unguarded* job, which is the security-relevant case. |

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
  // this existed, an iOS-only merge redeployed six Lambdas, synced S3,
  // invalidated CloudFront and re-triggered three data ingests.
  //
  // 'docs/**' is deliberately absent — see the `does NOT ignore docs/`
  // assertion below and the Global Constraints for why.
  it.each(["'ios/**'", "'**/*.md'"])(
    'ignores %s',
    (pattern) => {
      expect(workflow).toContain(pattern);
    }
  );

  // docs/ must NOT be ignored: docs/publisher/{categories,venues}.json are
  // copied into the Lambda zips as dist/refs, so ignoring docs/** meant a
  // venue-list edit merged with no workflow run at all.
  it('does NOT ignore docs/', () => {
    const ignoreBlock = workflow.slice(
      workflow.indexOf('paths-ignore:'),
      workflow.indexOf('  workflow_dispatch:')
    );
    expect(ignoreBlock).not.toContain('docs/');
  });

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
  //
  // Scoped to the ignore block. An earlier draft used
  // `expect(workflow).not.toMatch(/paths-ignore:[\s\S]*?- 'shared\/\*\*'/)`,
  // which scans the WHOLE file after `paths-ignore:` — Task 2 adds `shared/`
  // text far below it, so that form is a false positive waiting on an
  // unrelated edit.
  it('does NOT ignore shared/', () => {
    const ignoreBlock = workflow.slice(
      workflow.indexOf('paths-ignore:'),
      workflow.indexOf('  workflow_dispatch:')
    );
    expect(ignoreBlock).not.toContain('shared/');
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

Expected: FAIL. The two `it.each` ignore assertions and the `paths-ignore:` assertion fail because no `paths-ignore` block exists yet. The four negative assertions (`docs/`, `shared/`, `frontend/**`, `backend/**`) pass vacuously against an empty slice — that is correct and expected; they are regression guards, not drivers.

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
    # paths-ignore is OR-semantics: a push touching both ios/** and
    # frontend/** still runs, which is what we want — the run is skipped
    # only when EVERY changed file matches.
    #
    # Deliberately NOT listed: shared/**, which is a frontend build input
    # (frontend/src/lib/quickLinks.ts imports @shared/links.json through the
    # Vite alias at vite.config.ts:132). Ignoring it would let a links.json
    # edit merge and silently never reach the header.
    #
    # Deliberately NOT listed either: docs/**. `**/*.md` already covers the
    # common case. Non-Markdown files under docs/ are Lambda BUILD INPUTS —
    # docs/publisher/{categories,venues}.json ship inside the admin and
    # publisher-ingest zips as dist/refs — and paths-ignore has no negation,
    # so the exception cannot be written. See Global Constraints.
    paths-ignore:
      - 'ios/**'
      - '**/*.md'
      - '.github/ISSUE_TEMPLATE/**'
  workflow_dispatch:
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/deployWorkflow.test.ts`

Expected: PASS, 7 tests.

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

docs/** is deliberately NOT ignored: docs/publisher/categories.json and
docs/publisher/venues.json are copied into the Lambda zips as dist/refs, so
ignoring them would let a venue-list edit merge with no run at all. **/*.md
still covers the common all-Markdown docs change."
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
  //
  // Per-job, not a count. An earlier draft asserted `>= 2` occurrences,
  // which is satisfied by ANY two jobs — including the wrong two — so it
  // would pass while a deploy job ran without credentials. Note ` {4}`
  // rather than four literal spaces: eslint's no-regex-spaces rejects
  // countable runs of spaces in a regex literal and would fail the build.
  it('puts environment: production on both deploy jobs and not on verify', () => {
    const declared = /^ {4}environment: production$/m;
    expect(jobNamed('deploy-backend').body).toMatch(declared);
    expect(jobNamed('deploy-frontend').body).toMatch(declared);
    expect(jobNamed('verify').body).not.toMatch(declared);
  });

  // The fork guard has to be on every job now that there are four. A fork
  // would otherwise red-X on every push, or deploy over production if
  // someone added real credentials to the fork's secrets.
  //
  // Asserted per-job against the jobs actually present. Neither earlier
  // draft provided the guarantee its comment claimed: `guards.length >=
  // jobs.length` and the later `guards.length === 4` are both satisfied by
  // a 5th UNGUARDED job, which is precisely the security-relevant case. Use
  // the jobBlocks() helper (parse `^  [a-z][a-z-]*:$` inside the `jobs:`
  // block, slice each job's config down to its `steps:`) and check each
  // job's own `if:`, then pin the discovered name list so a broken parse
  // fails loudly instead of looping over nothing.
  it('repeats the fork guard on every job', () => {
    const jobs = jobBlocks();
    for (const job of jobs) {
      expect(
        job.header,
        `job ${job.name} has no fork guard in its own if:`
      ).toContain("github.repository == 'bbernstein/chq-calendar'");
    }
    expect(jobs.map((j) => j.name)).toEqual([
      'changes',
      'deploy-backend',
      'deploy-frontend',
      'verify',
    ]);
  });

  // Two concurrent runs interleave the ci-e2e-test publisher's
  // enable/disable toggles and corrupt the post-deploy retraction
  // assertion. With four jobs the group has to be workflow-level.
  it('declares concurrency at workflow level, not job level', () => {
    // `>-1` guard, matching its siblings: without it a missing `\njobs:`
    // makes slice(0, -1) return the whole file bar one character and all
    // three assertions below pass on a corrupted premise.
    const jobsAt = workflow.indexOf('\njobs:');
    expect(jobsAt, '`jobs:` block missing').toBeGreaterThan(-1);
    const beforeJobs = workflow.slice(0, jobsAt);
    expect(beforeJobs).toContain('concurrency:');
    expect(beforeJobs).toContain('group: deploy-production');
    expect(beforeJobs).toContain('cancel-in-progress: false');
  });

  // shared/** must be in the FRONTEND filter. This is the assertion that
  // catches the failure mode where editing links.json deploys nothing that
  // rebuilds the bundle it is compiled into.
  //
  // Anchored on the ASSIGNMENT (`FRONTEND_PATHS='`), not the bare marker.
  // An earlier draft sliced on `indexOf('FRONTEND_PATHS')`, which lands on
  // the explanatory COMMENT — so the assertion was satisfied by prose
  // describing the constraint and still passed with `shared/|` deleted from
  // the real regex. Proven by mutation.
  it('routes shared/ to the frontend filter', () => {
    const from = workflow.indexOf("FRONTEND_PATHS='");
    const to = workflow.indexOf("BACKEND_PATHS='");
    expect(from, "FRONTEND_PATHS assignment missing").toBeGreaterThan(-1);
    expect(to, "BACKEND_PATHS assignment missing").toBeGreaterThan(from);
    const frontendFilter = workflow.slice(from, to);
    expect(frontendFilter).toContain('shared/');
    expect(frontendFilter).toContain('frontend/');
  });

  // tools/ and docs/publisher/ are Lambda build inputs whose paths do not
  // say "backend". Same assignment anchor, for the same reason.
  it.each(['tools/', 'docs/publisher/'])(
    'routes %s to the backend filter',
    (path) => {
      const from = workflow.indexOf("BACKEND_PATHS='");
      expect(from, "BACKEND_PATHS assignment missing").toBeGreaterThan(-1);
      const backendFilter = workflow.slice(from, workflow.indexOf('\n', from));
      expect(backendFilter).toContain(path);
    }
  );

  // A bare [skip-deploy] must NOT skip. The reason is required, so opting
  // out is a recorded decision rather than silence — same contract as
  // [skip-screenshots: <reason>] in app-store-assets.yml.
  //
  // Scoped to the `if grep -qE` line: a whole-file toContain is satisfied by
  // a COMMENT quoting the regex, so the guard would survive the regex itself
  // changing. And the asserted string is the ERE the workflow actually runs
  // (`grep -qE`, bare `+`, POSIX [[:space:]]) — an earlier draft asserted the
  // BRE form `skip-deploy: *[^]]\\+`, which could never match.
  it('requires a non-empty reason on the skip-deploy marker', () => {
    const markerCheck = workflow
      .split('\n')
      .filter((l) => l.includes('grep -qE') && l.includes('skip-deploy'));
    expect(markerCheck, 'skip-deploy grep line not found').toHaveLength(1);
    expect(markerCheck[0]).toContain("'\\[skip-deploy: *[^][:space:]][^]]*\\]'");
  });

  // Pinning the bug as well as the fix, so the naive form cannot be copied
  // back in anywhere — comments included.
  it('does not use the naive marker regex that a blank reason satisfies', () => {
    expect(workflow).not.toContain('skip-deploy: *[^]]+');
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
          # shared/ is here because frontend/src/lib/quickLinks.ts imports
          # @shared/links.json through the Vite alias at vite.config.ts:132,
          # so a links.json edit must rebuild the frontend. It is ALSO in
          # BACKEND_PATHS, as a conservative over-deploy.
          FRONTEND_PATHS='^(frontend/|shared/|package\.json|package-lock\.json)'
          # BACKEND_PATHS — anything that changes a Lambda bundle. tools/ and
          # docs/publisher/ are here and are NOT obvious: backend depends on
          # the @chq-calendar/publisher-format workspace at tools/publisher-format
          # (esbuild inlines it into adminHandler.js and publisherIngestHandler.js),
          # and docs/publisher/{categories,venues}.json ship inside the zips as
          # dist/refs. An earlier draft omitted both; each omission was a green
          # run that deployed nothing.
          BACKEND_PATHS='^(backend/|tools/|docs/publisher/|shared/|package\.json|package-lock\.json)'

          if [ "$CHANGED" = "FALLBACK_DEPLOY_ALL" ]; then
            echo "frontend=true" >> "$GITHUB_OUTPUT"
            echo "backend=true" >> "$GITHUB_OUTPUT"
          else
            # Herestring, NOT `echo "$CHANGED" | grep -qE ...` (the form an
            # earlier draft of this plan specified). `grep -q` exits at the
            # first match, so on a large changed-file list the writer takes
            # SIGPIPE, `set -o pipefail` reports 141, and the `|| ...=false`
            # branch runs even though the pattern MATCHED — a silent
            # no-deploy. Reproduced with a 5.5MB all-frontend list.
            grep -qE "$FRONTEND_PATHS" <<< "$CHANGED" \
              && echo "frontend=true" >> "$GITHUB_OUTPUT" \
              || echo "frontend=false" >> "$GITHUB_OUTPUT"
            grep -qE "$BACKEND_PATHS" <<< "$CHANGED" \
              && echo "backend=true" >> "$GITHUB_OUTPUT" \
              || echo "backend=false" >> "$GITHUB_OUTPUT"
          fi

          # The manual brake. A NON-EMPTY reason is required, so opting out
          # is a recorded decision rather than silence — the same contract
          # as [skip-screenshots: <reason>] in app-store-assets.yml. A bare
          # [skip-deploy] deliberately does NOT match and does NOT skip.
          #
          # The leading [^][:space:]] is load-bearing. The obvious `[^]]+`
          # (an earlier draft of this plan) instead MATCHES `[skip-deploy: ]`,
          # because ` *` backtracks to zero and lets `[^]]+` consume the
          # space — a whitespace-only "reason" would silently skip.
          # Herestring rather than `printf ... | grep`, same SIGPIPE reason.
          if grep -qE '\[skip-deploy: *[^][:space:]][^]]*\]' <<< "$COMMIT_MESSAGE"; then
            echo "skip=true" >> "$GITHUB_OUTPUT"
            echo "::notice title=Deploy skipped::[skip-deploy:] marker found in the commit subject"
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
  if grep -qE '\[skip-deploy: *[^][:space:]][^]]*\]' <<< "$msg"; then
    echo "SKIP    <- $msg"
  else
    echo "DEPLOY  <- $msg"
  fi
done
```

Three things in that loop are deliberate and were wrong in an earlier draft of this plan. **The marker is matched against the commit SUBJECT, never the whole message.** A squash merge's commit message is the PR title followed by the PR *body*, so matching the whole thing means any PR whose description documents the marker — a runbook, a plan, or the PR introducing it — silently skips its own deploy. PR #231's description quoted the syntax twice; matching the full message would have skipped that very deploy. The subject is the deliberate surface: it is the PR title, it shows in `git log --oneline`, and prose in a description cannot reach it. The regex is `\[skip-deploy: *[^][:space:]][^]]*\]`, **not** `\[skip-deploy: *[^]]+\]` — the naive form reports SKIP for `[skip-deploy: ]`, because ` *` backtracks to zero repetitions and `[^]]+` then consumes the space itself, so a whitespace-only "reason" satisfies the required-reason contract. And the message is fed by herestring rather than `printf '%s' "$msg" | grep -qE`, matching the shipped code: under `set -o pipefail` a `grep -q` that exits early makes the writer take SIGPIPE and the pipeline report 141. A commit message is small enough that the pipe form would almost always work, which is exactly what makes it a bad thing to leave in a plan someone will copy.

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

[skip-deploy: <reason>] in the commit SUBJECT is the manual brake. The
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

1. **A docs-only merge** — three different outcomes, depending on what kind of docs file moved. `docs/**` is NOT in `paths-ignore`; only `**/*.md` is.
   - **All-Markdown** (the Phase 1 plan commit is one): **no workflow run at all**, because every changed file matches `**/*.md`.
   - **Non-Markdown under `docs/`, outside `docs/publisher/`** (an image, a JSON fixture): the run **starts**, `changes` reports `frontend=false backend=false`, and both deploy jobs plus `verify` skip. Nothing deploys. That is the intended cost of not ignoring `docs/**`.
   - **Anything under `docs/publisher/`**: the run starts and **`deploy-backend` runs**. `categories.json` and `venues.json` ship inside the Lambda zips as `dist/refs`, so this is a real Lambda change. If a `docs/publisher/venues.json` edit does *not* deploy the backend, `BACKEND_PATHS` has regressed.
2. **A frontend-only merge** shows `changes` → `deploy-frontend` → `verify`, with `deploy-backend` skipped.
3. **This merge itself** changes only `.github/workflows/**` (plus a test and docs). That path matches neither `paths-ignore` nor either area filter, so the run **starts** — `changes` executes and reports `frontend=false backend=false` — and then **both deploy jobs and `verify` skip. Nothing is deployed.** That is correct behaviour, not a failure of the gating: a workflow-file edit changes no Lambda bundle and no frontend bundle, so there is nothing to ship. Expect a green run with three skipped jobs, and do not read the skips as a bug. If you actually want the deploy, use the `workflow_dispatch` escape hatch, which force-deploys both areas by design.

If step 1's all-Markdown case does not hold, the likeliest cause is that the merge also touched a non-Markdown path. Check the run's `changes` job summary output before changing the filter — the fix is almost never to widen `paths-ignore`, since a wrongly-ignored path is a silent no-deploy that reports green.
