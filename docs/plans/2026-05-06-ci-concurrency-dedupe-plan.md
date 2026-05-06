# CI concurrency dedupe (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `build-and-test.yml` from running duplicate jobs on rapid pushes and on same-repo PRs once the workflow triggers on every branch push.

**Spec:** `docs/plans/2026-05-06-ci-concurrency-dedupe-design.md`

**Architecture:** Single-file edit. Add a workflow-level `concurrency:` block keyed on `github.ref` with `cancel-in-progress` enabled for non-`main` refs. Add an `if:` filter on each job to suppress the `pull_request` event when the source branch lives in the upstream repo (no duplicate with `push:`).

**Tech Stack:** GitHub Actions YAML.

**Branch:** create `chore/ci-concurrency-dedupe` off `main`.

**Prerequisite:** none, but most useful to land *together with* or *immediately after* `publisher-integration-tests-plan` Task 10 (which adds `push:` trigger).

---

## Task 1: Add concurrency block

**Files:**
- Modify: `.github/workflows/build-and-test.yml`

- [ ] **Step 1: Edit the workflow**

  Below the `on:` block and before `jobs:`, add:

  ```yaml
  concurrency:
    group: build-and-test-${{ github.ref }}
    cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
  ```

- [ ] **Step 2: Confirm syntax**

  ```bash
  npx --yes @action-validator/cli .github/workflows/build-and-test.yml
  ```

  Or open in any YAML linter. Must parse without error.

---

## Task 2: Suppress duplicate runs on same-repo PRs

**Files:**
- Modify: `.github/workflows/build-and-test.yml`

- [ ] **Step 1: Add the `if:` filter to both jobs**

  Under `test-backend:` and `test-frontend:`, immediately after `runs-on:`, add:

  ```yaml
  if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.fork == true
  ```

  This skips the `pull_request`-triggered run for same-repo PRs (the corresponding `push` run still executes). Fork PRs continue to trigger via `pull_request` (forks don't fire `push:` against the upstream repo).

- [ ] **Step 2: Limit `pull_request` event types**

  Under the `pull_request:` trigger, narrow to the events that matter:

  ```yaml
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main]
  ```

  This avoids extra runs on label / assignee / review-state changes.

---

## Task 3: Verify behavior

- [ ] **Step 1: Push two commits in quick succession on a branch**

  Create a tiny no-op commit, push, immediately add another no-op, push again:

  ```bash
  git checkout -b chore/ci-concurrency-dedupe
  git commit --allow-empty -m "ci: test concurrency dedupe (1)"
  git push -u origin chore/ci-concurrency-dedupe
  git commit --allow-empty -m "ci: test concurrency dedupe (2)"
  git push
  ```

  In GitHub Actions, expected: the run for commit (1) shows "Cancelled"; the run for (2) completes.

- [ ] **Step 2: Open a same-repo PR**

  ```bash
  gh pr create --title "chore(ci): concurrency dedupe" --body "Test PR for dedupe verification"
  ```

  In GitHub Actions, expected: only the `push`-triggered run is visible. The `pull_request` run is skipped via the `if:` filter (it shows up as "Skipped" in the checks list).

- [ ] **Step 3: Push to `main`** (only after PR merge)

  After this PR merges, observe the post-merge run on `main`. Expected: completes without being cancellable, even if a follow-on commit lands shortly after.

---

## Task 4: Final commit + PR

- [ ] **Step 1: Squash the test commits**

  Only do this **after** the cancel verification in Task 3 has been observed in the GitHub Actions UI (otherwise you cancel the very runs you were verifying against). If the verification commits are still on the branch:

  ```bash
  git reset --soft origin/main
  git commit -m "ci: dedupe build-and-test runs via concurrency-cancel + same-repo PR filter"
  git push --force-with-lease
  ```

- [ ] **Step 2: Update PR description**

  ```bash
  gh pr edit --body "$(cat <<'EOF'
## Summary
- Adds `concurrency:` block keyed on ref; cancels superseded runs on every branch except `main`.
- Adds `if:` filter to suppress duplicate `pull_request` runs for same-repo PRs (the `push` run already covers them); fork PRs still run normally.
- Narrows `pull_request:` trigger to `[opened, synchronize, reopened]`.

## Verification
- [x] Two rapid pushes → first run cancelled, second completes
- [x] Same-repo PR → only push-triggered run visible
- [ ] After merge, post-merge run on main completes uninterrupted

## Risk
- Cancelled runs show as "Cancelled" not "Failed" — they don't satisfy a required-check rule, but the next commit's run does. Documented in design.
EOF
  )"
  ```

- [ ] **Step 3: Wait for green CI; iterate per global PR-iteration rules**
