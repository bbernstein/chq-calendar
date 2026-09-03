# CLAUDE.md — Agentic Development Guide

## Project Status

The project is in steady-state delivery. The frontend Vite + Preact
migration and bundle-optimization initiative finished in 2025; the
publisher portal, ingest pipeline, integration-test program, and CI
coverage floor all shipped in 2026 spring. Day-to-day work is feature
delivery and incremental polish — there is no master backlog file that
agents must consult before starting work.

When you start a session, work from the conversation. Check `git log`
for recent activity, and check `docs/plans/` for the small set of active
plan docs (most are archived under `docs/plans/archive/`). The user will
direct you to whatever is next.

## Project Overview

**Chautauqua Calendar** is a web application that displays events for the Chautauqua Institution's 2026 summer season. It fetches ~1,470 events from a static JSON file cached on CloudFront CDN and provides client-side filtering by search, category, location, date, and week.

**Architecture**: Vite + Preact static site deployed to S3 + CloudFront. All rendering is client-side. Backend Lambda functions handle data sync, admin auth, and feedback — but the frontend itself is purely static HTML/CSS/JS.

**Live site**: https://www.chqcal.org

## Repository Structure

```
chq-calendar/                    # Root (npm workspaces)
├── CLAUDE.md                    # THIS FILE — agentic guidance
├── frontend/                    # Vite + Preact application
│   ├── index.html               # Main entry HTML
│   ├── vite.config.ts           # Vite build config
│   ├── src/
│   │   ├── entries/             # One entry file per page (mounts a component)
│   │   ├── app/                 # Page-level components (page.tsx, feedback/, publish/, admin/...)
│   │   ├── components/          # Reusable UI components
│   │   ├── hooks/                # Custom Preact hooks
│   │   ├── lib/                 # Utilities (auth, helpers, search, dates)
│   │   ├── types/               # Shared type definitions
│   │   └── __tests__/           # Cross-cutting test files (most tests live next to source)
│   ├── public/                  # Static assets (icons, manifest)
│   ├── e2e/                     # Playwright browser checks (verify-*.mjs)
│   ├── package.json             # Frontend deps and scripts
│   ├── tsconfig.json            # TypeScript config
│   └── postcss.config.mjs       # Tailwind PostCSS plugin
├── backend/                     # AWS Lambda functions (TypeScript)
│   ├── src/handlers/            # Lambda handlers
│   └── package.json             # Backend deps
├── ios/                         # Native SwiftUI app — see ios/README.md
│   ├── ChqCalendar/             # App target (App/, Features/, Data/,
│   │                            #   Intents/, Support/, Assets.xcassets/)
│   ├── ChqCalendarShared/       # Models/Domain/Data shared by all 3 targets
│   ├── ChqCalendarWidgets/      # WidgetKit extension (no test target of its own)
│   ├── ChqCalendarTests/        # Swift Testing unit bundle (+ Fixtures/)
│   ├── ChqCalendarUITests/      # XCUITest bundle
│   └── Scripts/                 # Screenshot capture/compose, screenshot-plan.json
├── infrastructure/              # Terraform IaC (AWS)
├── docs/                        # Documentation
│   ├── DESIGN.md                # System design (frontend + backend)
│   ├── CACHING_ARCHITECTURE.md  # Cache strategy evolution
│   ├── DEVELOPMENT_HISTORY.md   # Architecture decisions over time
│   ├── plans/                   # Active plan docs (most are in archive/)
│   ├── superpowers/             # Per-initiative specs/ and plans/, by date
│   ├── app-store/               # Listing copy/fields, screenshots, release checklist
│   ├── runbooks/                # Operational runbooks
│   ├── publisher/               # Publisher-facing docs (live content)
│   ├── archive/                 # Historical docs kept for searchability
│   └── ...                      # Plus DEPLOYMENT.md, DEVELOPMENT_WORKFLOW.md, coverage.md, etc.
├── scripts/                     # Deployment scripts
├── utils/                       # Dev utilities
└── docker-compose.yml           # Local dev environment
```

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Build Tool | Vite | 7 |
| UI Library | Preact | 10 |
| Language | TypeScript | 5 |
| Styling | Tailwind CSS | 4 |
| Deployment | Static build → S3 + CloudFront | — |
| Backend | AWS Lambda + API Gateway | — |
| Database | DynamoDB | — |
| IaC | Terraform | — |
| Node.js | 24 (engines: `>=24.0.0`; CI matrix runs 24 + 25) | — |
| iOS app | SwiftUI / Swift 6, deployment target iOS 18.0 | — |
| iOS toolchain | Xcode 26+ (hard floor — synchronized folder groups) | — |

## Development Commands

All commands are run from the `frontend/` directory unless noted otherwise.

```bash
# Development
npm run dev              # Start Vite dev server (port 3000)

# Build & Validation
npm run build            # Runs validate, then vite build
npm run validate         # Runs type-check + lint
npm run type-check       # TypeScript: tsc --noEmit
npm run lint             # ESLint

# From project root
npm run dev              # Runs frontend dev
npm run build            # Builds frontend + backend
```

**Build output**: Static HTML/CSS/JS files in `frontend/out/`.

## Key Architectural Constraints

These constraints affect ALL work. Do not violate them:

1. **Static site** — Vite builds to static HTML/CSS/JS in `out/`. No SSR, no server-side rendering.

2. **Multi-page app** — Each page has its own entry in `vite.config.ts` `rollupOptions.input`. New pages need an `index.html` and entry file in `src/entries/`.

3. **Preact, not React** — Uses Preact with `@preact/preset-vite`. Import from `preact/hooks`, `preact/compat`, etc.

4. **Client-side data fetching** — Events are fetched from `/cache/calendar-cache/all-events.json` (a static file on S3/CloudFront). All filtering happens in the browser.

5. **localStorage persistence** — User filter state is saved to localStorage with a 30-day expiry. Don't break the state schema without handling migration.

## Code Patterns and Conventions

### Naming
- Components: PascalCase (`EventCard.tsx`, `SearchBar.tsx`)
- Hooks: camelCase with `use` prefix (`useEventData.ts`, `useFilterState.ts`)
- Utilities: camelCase (`dateHelpers.ts`, `searchHelpers.ts`)
- Constants: UPPER_SNAKE_CASE (`CACHE_EXPIRY_MS`, `USER_STATE_EXPIRY_MS`)

### Styling
- **Tailwind CSS 4** with `@import "tailwindcss"` syntax (not v3 `@tailwind` directives)
- Dark mode via `prefers-color-scheme` media query (not Tailwind class strategy)
- Custom CSS in `globals.css` for scrollbar hiding, fade gradients, scroll indicators
- Responsive: mobile-first with `sm:`, `lg:` breakpoints

### State Management
- Preact Context API for global event data (`GlobalEventDataContext`)
- `useState` / `useReducer` for local component state
- `useMemo` / `useCallback` for expensive computations and stable references
- No external state library (Redux, Zustand, etc.)

### Data Flow
```
CloudFront CDN → all-events.json → Browser Cache (1hr)
    → Client fetch → Preact state → Filter pipeline → Grouped events → Render
```

### Imports
- Use `@/` path alias for imports (maps to `./src/`)
- Example: `import { Event } from '@/lib/types'`
- **Hooks and React-shaped types may be imported from `'react'`.** `@preact/preset-vite` aliases `'react'` and `'react-dom'` to `'preact/compat'` at build time (and `vitest.config.ts` does the same for tests). Importing `useState`, `createContext`, `useContext`, `React.FormEvent`, `React.ReactNode`, etc. from `'react'` is the accepted convention — `preact/compat` is what installs the `onChange` → `onInput` event normalization that React-style form components rely on, and removing `'react'` imports across the tree silently breaks form handlers in tests and production. New files may import hooks from `'preact/hooks'` if they don't render JSX (e.g. pure `.ts` hook files), but anything that wires DOM event handlers should keep the `'react'` import.

## Agentic Workflow — How to Work on This Project

### Starting a session
1. Read the current conversation. The user's ask is the source of truth
   for what to work on, not any file on disk.
2. `git log --oneline -10` to see recent activity.
3. If the work touches an existing plan, look in `docs/plans/` — most are
   archived under `docs/plans/archive/`, but a small number stay active or
   serve as Reference for ongoing architecture (each marked with a
   "Status" banner at the top).
4. Never commit to the `main` branch. If `git branch --show-current`
   returns `main`, create a feature branch first.

### Committing
- Run verification before every commit (see "Verification Checklist"
  below).
- Use a concise commit subject that names the change ("feat(admin): X",
  "fix(ingest): Y", "chore: Z"). One logical change per commit.
- Push to the working branch after each commit. Open a PR rather than
  fast-forwarding `main`.

### Handling failures
- If `npm run build` or `npm run validate` fails, fix the issue before
  committing. Don't mark work complete on a red build.
- If a task is blocked, surface the blocker in the conversation instead
  of guessing.

## Common Pitfalls

### Vite + Preact
- Preact does not support all React APIs. Use `preact/compat` for compatibility but avoid React 19-specific APIs (`use()`, `useFormStatus`, etc.)
- Environment variables must be prefixed with `VITE_` to be exposed to client code (e.g., `VITE_API_URL`)
- Each page needs its own HTML entry point and entry file in `src/entries/`
- The `@preact/preset-vite` plugin handles JSX transform — do not configure JSX separately

### Build Environment
- The build validates TypeScript and ESLint before bundling (`npm run validate`)

## File Reference — Key Files

| File | Purpose |
|------|---------|
| `frontend/vite.config.ts` | Vite build config with multi-page setup |
| `frontend/index.html` | Main entry HTML |
| `frontend/src/entries/main.tsx` | Main calendar entry point |
| `frontend/src/app/page.tsx` | Main calendar component |
| `frontend/src/app/globals.css` | Tailwind + custom CSS |
| `frontend/src/app/feedback/page.tsx` | Feedback form |
| `frontend/src/app/admin/feedback/page.tsx` | Admin dashboard |
| `frontend/src/app/admin/login/page.tsx` | OAuth login |
| `frontend/src/lib/auth.ts` | Auth utilities |
| `frontend/package.json` | Dependencies and scripts |
| `docs/DESIGN.md` | System design reference |
| `docs/plans/` | Active plan docs (most are in `archive/`) |

## Verification Checklist

Run this after every set of changes:

```bash
# 1. Frontend build (already runs validate + tests internally)
cd frontend && npm run build

# 2. Backend validate (type-check + lint, fails on any warning)
cd ../backend && npm run validate

# 3. Backend build (runs tests + esbuild bundle)
npm run build

# 4. Dev server smoke test (if available)
cd ../frontend && npm run dev
# Then visit: http://localhost:3000
# Verify: events load, search works, filters work, descriptions expand

# 5. iOS — only when the change touches ios/ (see "iOS development" above)
cd ../ios
xcodebuild test -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination "id=$UDID" -only-testing:ChqCalendarTests \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO   # while iterating
xcodebuild test -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination "id=$UDID" \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO   # both legs, before committing
```

The backend `test` script pins `--maxWorkers=4`. Jest otherwise spawns one
worker per core, which on a many-core developer machine leaves the suite with
almost no memory headroom — measured on a 16-core host, an uncapped run passed
but peaked within a couple of GB of the machine's total RAM. Adding suites
tips that over, and the failure mode is unhelpful: `npm run build` dies with a
bare `exit 137`, no test failure and no message, just a killed process.

The cap costs nothing. At 4 workers the suite finished *faster* than at 8 on
that host, so parallelism had stopped paying well before the limit — the
default was buying memory pressure rather than speed. CI keeps its own uncapped
`test:ci`: its runners have few cores, so the arithmetic never arises there.

The backend `lint` script runs with `--max-warnings=0`, so any ESLint
warning fails the build. The frontend `lint` script does not (warnings
are reported but do not fail). New backend code must pass
`npm run validate --workspace=backend` before committing.

Coverage floor enforced via `.coverage-floor.json`; see `docs/coverage.md`.

## iOS development

`ios/README.md` is the reference — targets, architecture, data endpoints,
caching semantics, screenshot scripts. What follows is only what that file
does not say and what has cost real time.

**Build and test from the CLI.** Resolve a simulator UDID rather than
pinning `OS=`; runtimes differ between machines and CI images.

```bash
cd ios
xcodebuild test -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination "id=$UDID" -only-testing:ChqCalendarTests \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO
```

- `-only-testing:ChqCalendarTests` while iterating; the UI leg
  (`ChqCalendarUITests`) boots the app per test and dominates wall-clock.
  Run it once before committing. `-only-testing:` narrows what *runs*, not
  what gets *built*, so the unit-only command is still a full compile gate
  over all three targets.
- **A single Swift Testing test needs the `()` suffix**:
  `-only-testing:"ChqCalendarTests/AppModelTests/someTest()"`. Without the
  parentheses xcodebuild matches nothing, reports `Executed 0 tests`, and
  exits **TEST SUCCEEDED** — a silent green that looks exactly like a pass.
- `-parallel-testing-enabled NO` is load-bearing on CI's 3-core runners
  (`.github/workflows/ios.yml` explains why). Keep it locally so a failure
  means the same thing in both places.
- Don't run two `xcodebuild` invocations at once, and don't run the UI suite
  while anything else is building — they contend for the one booted
  simulator and fail as "Application is not running".

**CI does run the iOS suite** (`.github/workflows/ios.yml`, added in #205),
split into a unit leg and a UI leg. Both gate a merge.

**New files need no `project.pbxproj` edit.** All five source folders are
Xcode 26 synchronized folder groups, so adding a `.swift` file or a
`ChqCalendarTests/Fixtures/*.json` fixture is picked up on the next build.
If Xcode has nonetheless rewritten `project.pbxproj` in your working tree
(it renames exception sets and reorders group entries), that churn is
cosmetic — revert it rather than committing it with unrelated work.

**`ChqCalendarShared/` is ported code, and the port is a promise.** Several
types exist on both platforms and their module headers say so explicitly —
`LandingState.swift` ↔ `frontend/src/lib/utils/landingState.ts`,
`ViewWindow.swift` ↔ `dayWindow.ts`, plus `UserStateStore`,
`FilterChipState`, `ActiveFilterChips`. When you change one side, read the
other's header before deciding it does not apply: the divergences that have
shipped were not in the rules, they were in the **inputs** to a rule that
both sides implemented identically (#288). Where a divergence is deliberate,
say so in both headers.

**Off-season and year-boundary states are the weak spot.** The server flips
`defaultYear` to the next year on October 1, so "which year is current"
changes without any app release. `EffectiveScope.resolve` degrades every
`now`-relative scope to `.all` for a non-current year, which silently makes
some states unreachable in tests — and reachable again the moment something
upstream changes. The XCUITest fixture serves a **three**-season manifest
(`UITestFixtureAPI.swift`) precisely so those states are reachable: 2025 is
an archived season with events, 2026 is the default year every pre-existing
test is written against, and 2027 is announced in `years` while serving a
valid but **empty** events payload. That last detail is the whole trick and
it is easy to undo by accident — `LandingState`'s rule 1 sends a *populated*
future year to `.inSeason`, and `AppModel.landingState`'s `guard snapshot !=
nil` sends a **404**ing one there too, so an empty payload under a clock
frozen before that season's start is the only way `.preSeason` is reachable
at all. `YearNavigationUITests` covers the two paths this bought (#186, #253)
and names in its own comments which launch reaches which state.

**Prove a guard by breaking the code.** Injecting the defect and watching
the specific test go red is the only evidence that a test tests anything;
this codebase has repeatedly produced tests that could not fail. When a
falsification unexpectedly *passes*, suspect the harness before the theory.

## App Store listing upkeep (iOS)

The App Store listing is a deliverable, not a one-time setup. It goes
stale silently — a screenshot showing a screen that no longer exists, or a
description promising a removed feature, is a defect that reaches users
before any test catches it.

**The rule:** any PR touching `ios/ChqCalendar/Features/**`,
`ios/ChqCalendar/App/**`, `ios/ChqCalendar/Assets.xcassets/**`,
`ios/ChqCalendarWidgets/**`, or `ios/ChqCalendarShared/**` in a way a user
can see must:

1. Regenerate the affected screenshots:
   ```bash
   ios/Scripts/capture-screenshots.sh
   python3 ios/Scripts/compose-screenshots.py
   ```
   Commit the updated `docs/app-store/screenshots.manifest.json` and
   `docs/app-store/screenshots/review/` copies.
2. Re-read `docs/app-store/listing-copy.md` and
   `docs/app-store/listing-fields.json` for claims the change invalidates.
   A description that promises a feature you removed is worse than a stale
   screenshot.

**Regenerated assets land in the repo at merge time; they upload at the
next version submission.** This is a platform constraint, not a choice:
metadata changes to an already-released version require creating a new
version and submitting it for review. The one field changeable without a
review cycle is **Promotional Text**, which is where time-sensitive
messaging belongs.

`ios/ChqCalendarShared/**` is in that list even though it builds no UI
(#189): user-visible strings and display logic live there — `DisplayNames`
(chip labels), `DateFilterLabel` (the date pill), `MyDayChipContent` (the
My Day strip), `ReminderPreset` labels, `VenueAtlas` names. The whole
directory is matched rather than an enumerated subset, so expect routine
opt-outs for genuinely invisible changes there (`ChqTime` internals,
`UserStateStore` persistence). That is the intended trade: an opt-out is a
recorded decision, a missed pixel is not.

`.github/workflows/app-store-assets.yml` enforces this. If a change
genuinely alters no pixel a user sees, opt out explicitly by putting
`[skip-screenshots: <reason>]` in the PR description — a non-empty reason
is required, so opting out is a recorded decision rather than silence.
If you regenerated and the manifest did not change because the shot list
in `ios/Scripts/screenshot-plan.json` does not cover the screen you
touched, that is also a valid opt-out: `[skip-screenshots: regenerated,
no covered shot changed]`.
The guard checks that the manifest file itself changed since the PR's
merge-base — that catches the honest mistake of forgetting to regenerate,
but it is a git-diff check, not proof the change came from a real
`compose-screenshots.py` run rather than a hand-edited JSON file.

The upload procedure, and the App Store Connect icon troubleshooting
steps, live in `docs/app-store/RELEASE_CHECKLIST.md`.

## Dependencies

### Production
- `preact` — UI library

### Dev Dependencies
- `vite` / `@preact/preset-vite` — build tooling
- `tailwindcss` / `@tailwindcss/postcss` — styling
- `typescript` — type checking
- `eslint` / `@typescript-eslint/*` — linting
- `@types/react` / `@types/react-dom` — type definitions (for Preact compat)
