# Docs Cleanup Plan

> **For agentic workers:** Self-contained plan for a fresh session. Use
> `superpowers:executing-plans` to work through phases. Most tasks are
> reversible (move/edit/delete), but some touch `CLAUDE.md` which agents read
> at session start — get those right.

**Goal:** Bring `docs/` from "29 shipped plans + a stale top-level optimization
doc + scattered architecture refs" down to "current state docs + archived
historical plans, with `CLAUDE.md` pointing at things that still exist."

**Why this exists:** As of 2026-05-12:
- `docs/OPTIMIZATION_PLAN.md` (928 lines) describes a Next.js 15 + React 19
  codebase. The repo has since migrated to Vite + Preact. `CLAUDE.md` still
  treats this file as the source-of-truth for "what to work on," which is
  now actively misleading for any agent starting fresh.
- `docs/plans/` holds 29 plan docs (≈14,500 lines) — all but one or two
  belong to shipped initiatives. None are archived.
- Several top-level docs (`API_INTEGRATION_DESIGN.md`, `DESIGN.md`,
  `DEVELOPMENT_HISTORY.md`) predate the publisher portal entirely. Some
  describe an architecture that no longer exists.

**Tech stack:** Markdown only. No code changes; no test impact.

---

## Out of Scope

- **`docs/runbooks/`** — operational, keep current. If something is stale,
  fix it in place; don't delete.
- **`docs/publisher/`** — public-facing publisher docs served at
  `/publish/docs/`. Treat as live content. Out of scope unless something is
  factually wrong, in which case fix in place.
- **Claude Code memory files.** The agent's persistent memory directory is
  per-user, per-machine (e.g. `~/.claude/projects/<project-dir-slug>/` —
  the exact slug depends on each contributor's local checkout path). It's
  cross-session state outside the repo, not project docs.
- **Authoring NEW architecture docs.** This plan is about consolidating
  what's there, not generating new prose.

---

## Phase 1: Audit current state

### Task 1A: Inventory top-level `docs/`

**Files:** read-only — investigation

**Steps:**
1. For each file in `docs/` (top level), open and skim:
   - `API_INTEGRATION_DESIGN.md` (450L)
   - `CACHING_ARCHITECTURE.md` (350L)
   - `coverage.md` (69L)
   - `DEPLOYMENT.md` (261L)
   - `DESIGN.md` (721L)
   - `DEVELOPMENT_HISTORY.md` (413L)
   - `DEVELOPMENT_WORKFLOW.md` (194L)
   - `OAuth-Setup.md` (61L)
   - `OPTIMIZATION_PLAN.md` (928L)
   - `YEAR_CONFIGURATION.md` (156L)
2. For each, mark one of:
   - **Current** — keep, no edits
   - **Needs refresh** — content is mostly right but references stale
     tooling/paths/decisions
   - **Historical** — describes a past architecture that's been replaced;
     move to an `archive/` subdirectory rather than delete (git history is
     authoritative; archived docs add searchable context)
   - **Delete** — duplicated elsewhere or actively misleading
3. Capture the categorization in this file's "Audit Results" section below.
   The next executor needs the verdicts to act on.

**Known starting point:** `OPTIMIZATION_PLAN.md` is "Historical" — it
describes the pre-Vite/Preact migration and is referenced by `CLAUDE.md` as
if it were active. Both the doc and the reference need attention.

**Audit Results** (fill in during the task):
- TBD

### Task 1B: Inventory `docs/plans/`

29 files. Most map to a PR that's already shipped. Don't read every line of
every file — read the first 30 lines for status / scope, then check git log
for whether the plan's PR shipped.

**Steps:**
1. For each plan, capture:
   - Was the work it describes shipped? (Check git log for matching PR /
     commit references in the plan doc. If running Claude Code with
     existing memory for this project, the agent's local memory directory
     also covers most of these; otherwise rely on `git log --grep` and PR
     history.)
   - Is it actionable as a future reference? (Some shipped plans contain
     architectural notes worth keeping; some are pure execution scripts
     that have no further value.)
2. Categorize as:
   - **Archive** — shipped, no ongoing reference value; move to
     `docs/plans/archive/`
   - **Reference** — shipped but contains useful architectural reasoning;
     keep in `docs/plans/` and prepend a status line:
     `> **Status:** Shipped via PR #N (<commit>). Kept for architectural context.`
   - **Active** — not yet shipped or in active use; keep as-is
3. The active plans from PR #123's session (as of 2026-05-12) are:
   - `2026-05-12-backend-lint-and-cleanup-plan.md` (this PR's sibling)
   - This file
   - Possibly `2026-05-08-close-out-backlog-plan.md` if any tasks remain
     (check first — most likely fully shipped)

### Task 1C: Inventory subdirectories

`docs/superpowers/` has `plans/` and `specs/` mirroring `docs/plans/`'s shape
but only contains the publisher-observability pair. Decide:
- **Consolidate into `docs/plans/`** — one location for everything. Recommended.
- **Keep separate** — only worth it if the executor expects more
  `superpowers/`-tagged content to land there. As of 2026-05-12 nothing
  suggests that's the trajectory.

`docs/runbooks/` and `docs/publisher/` are out of scope per the top of this
plan.

---

## Phase 2: Restructure

### Task 2A: Create `docs/plans/archive/`

**Files:**
- Create: `docs/plans/archive/` (directory; git tracks it via the files
  moved into it)
- Optional: `docs/plans/archive/README.md` — one short paragraph explaining
  the directory's purpose (shipped plans kept for searchability)

### Task 2B: Move "Archive" plans

For each plan classified Archive in Phase 1B:
```bash
git mv docs/plans/<plan-name>.md docs/plans/archive/<plan-name>.md
```

`git mv` preserves history. Don't `mv` then `git add` — use `git mv` so
`git log --follow` works after the move.

### Task 2C: Annotate "Reference" plans

For each plan classified Reference in Phase 1B, edit the file's top to add
a status banner:

```markdown
> **Status:** Shipped via PR #<N> (commit `<sha>`). Kept for architectural
> context — the reasoning here informed later decisions and is worth reading
> alongside the code, not as a TODO list.
```

The banner goes at the very top of the file, above the H1. Don't move the
file — these stay in `docs/plans/`.

### Task 2D: Refresh top-level docs

For each top-level doc classified "Needs refresh" in Phase 1A:
1. Update tooling references (Next.js → Vite + Preact where applicable).
2. Update file paths if any reference a path that's moved.
3. Drop sections that describe architecture that no longer exists; do NOT
   try to rewrite the whole doc into a new shape — that's a separate
   initiative.

For each classified "Historical":
- Move to `docs/archive/` (create the directory if it doesn't exist).
- Use `git mv` for history preservation.

---

## Phase 3: Fix the references in `CLAUDE.md`

`CLAUDE.md` (project root) currently does several things that become wrong
after this cleanup:

1. **References `docs/OPTIMIZATION_PLAN.md` as the source-of-truth for
   "what to work on."** The phrases "MANDATORY FIRST ACTION", "Read the
   optimization plan", and "If asked to 'continue optimizing'... the answer
   is ALWAYS in `docs/OPTIMIZATION_PLAN.md`" all assume that plan is live.
   After Phase 2D this plan will either be archived or refreshed; either
   way `CLAUDE.md` needs to stop demanding agents read it as the first
   action of every session.
2. **Describes a phase/task structure** that no longer reflects what the
   project is actively working on. The Active Optimization Plan section
   describes 7 phases that are largely complete or moot.
3. **Other doc references** — grep `CLAUDE.md` for `docs/` and verify each
   path still exists after Phase 2.

### Task 3A: Decide what should replace "MANDATORY FIRST ACTION"

Options for the new shape of `CLAUDE.md`'s opening:

- **A — Drop the mandatory action entirely.** Let agents start from the
  project overview and act on the conversation. Honest reflection of how
  work actually happens post-optimization.
- **B — Point at a generic status doc** like `docs/STATUS.md` (would need
  to be created) that's lightweight and updated when initiatives finish.
- **C — Point at memory files** which already index recently-shipped work
  and known-open follow-ups. Lowest-maintenance.

Recommendation: **A**. The optimization initiative is over; the project is
in steady-state delivery mode. Mandating a daily read of any file invites
exactly the kind of stale-pointer problem this cleanup is addressing.

### Task 3B: Rewrite `CLAUDE.md`'s opening sections

**Files:**
- Modify: `CLAUDE.md` (root)

**Steps:**
1. Replace the "MANDATORY FIRST ACTION" block with a short "Project status"
   summary: where the project is, what's stable, what's actively changing.
   Keep it concise — agents will read it on every session start.
2. Remove or shrink the "Active Optimization Plan" section. If a few tasks
   from it are still genuinely actionable, list those tasks inline; don't
   point at the plan doc.
3. Grep `CLAUDE.md` for any other `docs/` paths and verify each. Fix or
   delete each broken reference.

### Task 3C: Verify

After all of Phase 3:
- A fresh agent reading `CLAUDE.md` top-to-bottom doesn't see any broken
  doc references
- The mandatory `cat docs/OPTIMIZATION_PLAN.md` step is gone (or, if kept,
  the file actually reflects current reality)
- Section ordering still makes sense — opening with "Project overview",
  then "Code patterns", then "Common pitfalls" is a natural shape

---

## Phase 4: Open the PR

One PR, one logical change ("docs: reorganize and refresh"). Even though
this touches many files, every change is mechanical or copy-edit; reviewers
can scan the diff in one pass.

**Branch:** `chore/docs-cleanup`

**PR body should list:**
- Plans archived (count + linked directory)
- Plans annotated (count)
- Top-level docs refreshed (list each)
- `CLAUDE.md` opening rewritten — link to the diff line range
- Any subdirectory consolidation

---

## Self-review

Before opening the PR:
- [ ] `git log --follow` works on at least one moved plan (proves `git mv`
      was used)
- [ ] `grep -rn 'docs/' CLAUDE.md` returns only paths that still exist
- [ ] No agent-facing "mandatory first action" left in `CLAUDE.md` unless
      its target is verified current
- [ ] The new `CLAUDE.md` reads naturally to a fresh agent — try imagining
      what an agent starting a brand-new session would understand from it
- [ ] No content was *lost* — archived material is still in the repo, just
      moved. Anyone running `git log --all --oneline -- docs/plans/<file>`
      can find any plan that was moved
