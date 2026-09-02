# #286 — a fresh clone renders an empty calendar

**Status:** DONE (pending merge) · branch `fix/286-fresh-clone-empty-calendar`
**Opened:** 2026-09-02 · queue item 3 of `docs/plans/2026-08-27-work-queue.md`

---

## What the issue got right, and the one thing it missed

Both premises verified live against a dev server on :3100 with the
untracked feed moved aside — the fresh-clone simulation:

```
/data/all-events-2026.json  -> 404
/data/years.json            -> {"years":[2025,2026],"defaultYear":2026,
                                "generated":"2026-03-03T00:00:00Z"}
```

What the issue did not account for: **`vite.config.ts:117-120` already
proxies `/cache` to `https://www.chqcal.org`, in both `server.proxy` and
`preview.proxy`.** Verified through the same dev server:

```
/cache/calendar-cache/all-events-2026.json -> 200, 5,081,442 bytes
/cache/calendar-cache/years.json           -> {"years":[2025,2026,2027],...}
/cache/calendar-cache/article-links-2026.json -> 200, 198,869 bytes
/cache/calendar-cache/program-links-2026.json -> 200,  15,385 bytes
```

That proxy landed 2026-03-02 (`9110d17`). The `import.meta.env.DEV ? '/data'`
branch is older — `931cff8` (2026-05-02) only *refactored* it into a
`cacheBase` variable. So the dev branch is legacy that the proxy made
redundant five months ago, and nobody noticed because everybody's working
tree already had the file.

So the fix is smaller than either option the issue proposed: **delete the
dev branch.** Dev then loads exactly what preview and production load,
through infrastructure that already exists.

## Two further defects found while verifying

1. **The documented remedy does not work.** `syncDataWithLocalFile.ts:83`
   and `:127` both write `frontend/public/data/all-events.json`. The app
   reads `all-events-${year}.json` (`useEventData.ts:88`). `npm run
   sync:local` produces a file the frontend never requests. Option 3
   (docs-only) would have pointed contributors at a command that cannot fix
   their problem.
2. **`sync:local` needs AWS credentials** for DynamoDB and the private
   cache bucket, which the outside contributor this bites does not have.
   It was never a viable first-run path.

## Decision

Approach A, confirmed with the owner 2026-09-02, with the full cleanup
scope. Rejected: option 1 (setup script fetches) leaves the dev/prod path
divergence and still hand-refreshes `years.json`; option 2 (tracked
fixture) adds a second artifact on the same drift clock that just produced
this bug.

## Changes

1. **`frontend/src/lib/dataSource.ts` (new)** — one source of truth for the
   base path, replacing three copies of the same ternary. Default is
   `/cache/calendar-cache` everywhere; `VITE_LOCAL_DATA=true` opts back into
   `/data` for offline / local-backend work.
2. **`useEventData.ts:87`**, **`useSidecarLinks.ts:31`**,
   **`useAvailableYears.ts:48`** — consume it.
3. **`useEventData.ts:232`** — the bare `console.error('Failed to fetch
   events')` becomes a message that names the mode it is in, the URL it
   asked for, and what to do about it.
4. **`syncDataWithLocalFile.ts`** — write the year-suffixed filename at both
   write sites, and mention `VITE_LOCAL_DATA=true`.
5. **`scripts/setup-local.sh`** — assert the frontend actually serves
   events, not just that ports answer. This is the check that would have
   caught #286, #214 and #247's class.
6. **`frontend/public/data/years.json`** — refresh to `[2025,2026,2027]`.
   Now only read in local-data mode, but it should not lie.
7. **Docs** — `README.md`, `docs/DEVELOPMENT_WORKFLOW.md` and
   `backend/README-LOCAL-SYNC.md` gain the referrers that `grep -rn
   "README-LOCAL-SYNC"` could not find. `DEVELOPMENT_WORKFLOW.md`'s
   first-run command also moves from `start-local.sh` to `setup-local.sh` —
   the fresh clone needs the one that runs `npm ci` and now asserts content.
8. **`docker-compose.yml`** — pass `VITE_LOCAL_DATA` through to the frontend
   container. Without it the documented escape hatch is inert on the Docker
   path, which is the path the issue is about.
9. **Tests** — `dataSource.test.ts` (the base path and the message),
   `dataSourceWiring.test.ts` (that all three hooks actually use it). Two
   pre-existing sidecar tests asserted the `/data` dev path by name and were
   retargeted to the CDN base, with the owner's sign-off.

## Done when — and the evidence

A fresh clone plus `docker compose up` shows events, or fails with a
message naming the sync step. Both halves proved, 2026-09-02.

**The success path.** `frontend/public/data/` reduced to exactly what `git
ls-files` tracks — no `all-events-*.json` — then a dev server started on it
and driven with Playwright:

```
{ "cards": 1687, "days": 89, "empty": false, "emptyText": null }
```

**The failure path.** Same tree, with `dataBase()` reverted to the
pre-#286 `import.meta.env.DEV ? LOCAL_DATA_BASE : CDN_DATA_BASE`:

```
{ "cards": 0, "days": 0, "empty": true, "emptyText": "🎭" }
```

The issue's exact symptom, on demand. That probe is deliberately not left
in `e2e/` — a fresh-clone boot check is #215's job (queue item 4), and this
is the shape it should take: assert a *rendered event*, not a 200.

**`check_events` in `setup-local.sh`**, both directions, against a live
server: `✅ Calendar data for 2026 is reachable (1687 events)` and, with
`VITE_LOCAL_DATA=true` and the file removed, `exit=1` with the message
naming `npm run sync:local` and `backend/README-LOCAL-SYNC.md`.

**The unit guards, falsified by injection.** Restoring the old ternary
turns 7 of 12 assertions in `dataSource.test.ts` red and all 4 in
`dataSourceWiring.test.ts`; restoring the bare `console.error('Failed to
fetch events')` turns the message check red on its own.

**Full checklist.** Frontend `npm run build`: 111 files, 1347 tests, lines
87.07% against a 74.3 floor. Backend `npm run validate` clean and `npm run
build`: 71 suites, 909 tests.

### One incidental finding, not fixed here

`useEventData`'s effect re-runs whenever `globalEventData` or `seasonWeeks`
change identity, and the failure path has no `dataLoaded` guard to stop it —
so unstable props plus a failing fetch is an unbounded re-fetch loop. It
killed a vitest worker while writing these tests. Production is safe:
`page.tsx:45-46` passes a context value and a `useMemo`. Noted in
`dataSourceWiring.test.ts` rather than changed, since making the hook robust
to unstable props is a different change than this one.

## Not in scope

- `useWeeklyThemes.ts:41` reads `/data/weekly-themes/${year}.json`
  unconditionally in dev *and* prod — it is a build-time asset bundled from
  `public/`, not a CDN sidecar. Correct as it stands.
- The CI job that would catch this class is #215, queue item 4, whose entry
  criterion is this issue.
