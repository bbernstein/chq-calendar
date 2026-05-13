# CI concurrency dedupe (design)

**Date:** 2026-05-06
**Status:** Approved, ready for implementation plan
**Origin:** Once `build-and-test.yml` triggers on `push:` (any branch) per the publisher-integration-tests spec, rapid follow-up pushes will queue duplicate runs that test stale commits. Concurrency-cancel is the standard fix.

## Problem

GitHub Actions, by default, queues every triggered run. If a developer pushes commits A, B, C in quick succession, all three runs proceed; the run for A is wasted because nobody cares about its result the moment B exists. With `pull_request` and `push` both enabled, same-repo PRs additionally trigger **two** runs per push (one for each event), doubling the waste.

## Policy

- Cancel superseded runs on the same branch / PR; only the latest commit's run matters.
- Never cancel runs on `main` — those are post-merge verifications and we want them all to complete (history value).
- Apply at the workflow level so the policy travels with the workflow file, not as repo-wide settings.
- Don't dedupe across the `push` and `pull_request` event pair on the same commit — the easiest win is just to scope the duplicate-trigger to one of them.

## Scope

### In

- `.github/workflows/build-and-test.yml` — the workflow that runs on every branch push.

### Out

- `.github/workflows/deploy-production.yml` — already serialized via the GitHub Environment protection or its own concurrency block; touching it is out of scope here.
- `.github/workflows/claude-code-review.yml`, `.github/workflows/claude.yml` — Claude bot workflows; their semantics differ.
- `.github/workflows/validate-publisher-examples.yml` — leave alone unless it shows duplicate runs.

## Architecture

Two independent changes, both in `build-and-test.yml`:

### 1. Concurrency block

```yaml
concurrency:
  group: build-and-test-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

- `group` keys on `github.ref` so each branch / PR gets its own concurrency lane.
- `cancel-in-progress` is `true` for branches and `false` for `main` so the post-merge run always completes.

### 2. Avoid double-triggering on same-repo PRs

Two equally good options:

**Option A (recommended):** rely on `push:` for everything in the upstream repo, and have `pull_request:` only fire for forks:

```yaml
on:
  push:
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main]
  workflow_dispatch:
jobs:
  test-backend:
    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.fork == true
    # ...
  test-frontend:
    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.fork == true
    # ...
```

**Option B:** drop `push:` and rely on `pull_request:` only. Loses on-push validation for branches without an open PR.

We pick A — branch pushes without a PR open are still validated, and the `if:` filter cleanly suppresses the duplicate when a same-repo PR exists.

## Verification

After the change is in place:

- Push two quick commits to a branch → only the second run completes; the first shows "Cancelled".
- Open a PR from a same-repo branch → only the `push`-triggered run runs (the `pull_request` run is skipped via the `if:` filter).
- Open a PR from a fork → the `pull_request` run runs (forks don't fire `push:` on the upstream repo).
- Push to `main` (or merge into it) → the run completes and is not cancellable.

## CI integration

This *is* the CI integration. No external dependencies.

## Non-goals

- Cross-workflow dedupe
- Time-window debouncing (concurrency-cancel is enough)
- Custom queueing logic

## Risks

- **`if:` filter on jobs vs workflow-level `if`.** Job-level `if` still consumes a runner slot briefly to evaluate. Acceptable; the alternative is a workflow-level filter expression which GitHub doesn't natively support.
- **Cancelled runs leaving partial coverage artifacts.** Acceptable; the artifact upload step is keyed on `if: always()`. If the artifact is missing, the next successful run produces it.
- **Required-check status confusion.** When a run is cancelled, GitHub shows it as "Cancelled" not "Failed", which doesn't satisfy a required-check rule. The follow-up successful run (on the new commit) does. Documented in the implementation plan so reviewers know cancelled runs are expected on rapid pushes.
- **Matrix-cell skip vs required check.** A matrix job suppressed by `if:` shows as "Skipped" per cell. Skipped cells do **not** satisfy a required-check rule when individual cells (e.g. `test-backend (24)`, `test-backend (25)`) are listed as required. This only affects same-repo PRs (where the `pull_request` event is suppressed) — for those, the corresponding `push` event run produces the satisfying check, so the merge gate is met by a different workflow run on the same SHA. Required: the same-repo PR's `push`-event run must complete green; the cancelled-and-skipped `pull_request` run is harmless. Fork PRs always run via `pull_request` (forks don't fire `push:` against the upstream repo) so all cells run normally and the gate works the obvious way.

## File counts (estimated)

- One file edit: ~12 lines added to `build-and-test.yml`.
- Total: ~12 lines.
