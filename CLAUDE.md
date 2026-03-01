# CLAUDE.md — Agentic Development Guide

## MANDATORY FIRST ACTION — Do This Before Anything Else

**BEFORE writing any code, answering any question, or making any changes, you MUST:**

1. **Read the optimization plan**: `cat docs/OPTIMIZATION_PLAN.md`
2. **Check recent git history**: `git log --oneline -10`
3. **Verify the build works**: `cd frontend && npm run build`

The file `docs/OPTIMIZATION_PLAN.md` contains the detailed task list with current status markers showing what has been completed (`[x]`), what is in progress (`[~]`), and what is next (`[ ]`). **You cannot know what to work on without reading it.** Do not invent your own optimization tasks — follow the plan.

If asked to "continue optimizing" or "work on the next task", the answer is ALWAYS in `docs/OPTIMIZATION_PLAN.md`. Find the first `[ ]` task whose dependencies are `[x]`, and do that task.

---

## Project Overview

**Chautauqua Calendar** is a web application that displays events for the Chautauqua Institution's 2026 summer season. It fetches ~1,470 events from a static JSON file cached on CloudFront CDN and provides client-side filtering by search, category, location, date, and week.

**Architecture**: Static-export Next.js 15 app deployed to S3 + CloudFront. All rendering is client-side. Backend Lambda functions handle data sync, admin auth, and feedback — but the frontend itself is purely static HTML/CSS/JS.

**Live site**: https://www.chqcal.org

## Repository Structure

```
chq-calendar/                    # Root (npm workspaces)
├── CLAUDE.md                    # THIS FILE — agentic guidance
├── frontend/                    # Next.js 15 application
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx         # Main calendar (~1,760 lines, being decomposed)
│   │   │   ├── layout.tsx       # Root layout (metadata, fonts)
│   │   │   ├── globals.css      # Tailwind + custom CSS
│   │   │   ├── feedback/page.tsx        # Public feedback form
│   │   │   └── admin/
│   │   │       ├── login/page.tsx       # OAuth login
│   │   │       └── feedback/page.tsx    # Admin feedback dashboard
│   │   └── lib/
│   │       └── auth.ts          # Auth helpers (localStorage)
│   ├── public/                  # Static assets (icons, manifest)
│   ├── package.json             # Frontend deps and scripts
│   ├── next.config.ts           # Next.js config (static export)
│   ├── next.config.prod.ts      # Production config variant
│   ├── tsconfig.json            # TypeScript config
│   └── postcss.config.mjs       # Tailwind PostCSS plugin
├── backend/                     # AWS Lambda functions (TypeScript)
│   ├── src/handlers/            # Lambda handlers
│   └── package.json             # Backend deps
├── infrastructure/              # Terraform IaC (AWS)
├── docs/                        # Documentation
│   ├── OPTIMIZATION_PLAN.md     # ** ACTIVE OPTIMIZATION PLAN **
│   ├── CACHING_ARCHITECTURE.md  # Cache strategy evolution
│   ├── DEVELOPMENT_HISTORY.md   # Architecture decisions
│   └── ...                      # Other docs
├── scripts/                     # Deployment scripts
├── utils/                       # Dev utilities
└── docker-compose.yml           # Local dev environment
```

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js | 15.3.5 |
| UI Library | React (migrating to Preact) | 19.1.0 |
| Language | TypeScript | 5.8.3 |
| Styling | Tailwind CSS | 4 |
| Build | Next.js built-in (webpack/turbopack) | — |
| Deployment | Static export → S3 + CloudFront | — |
| Backend | AWS Lambda + API Gateway | — |
| Database | DynamoDB | — |
| IaC | Terraform | — |
| Node.js | 22.22.0 | — |

## Development Commands

All commands are run from the `frontend/` directory unless noted otherwise.

```bash
# Development
npm run dev              # Start Next.js dev server (port 3000)
npm run dev:turbo        # Dev server with Turbopack (faster)

# Build & Validation
npm run build            # Runs validate, then next build (static export)
npm run validate         # Runs type-check + lint
npm run type-check       # TypeScript: tsc --noEmit
npm run lint             # ESLint: next lint

# From project root
npm run dev              # Runs frontend dev
npm run build            # Builds frontend + backend
```

**Build output**: Static HTML/CSS/JS files in `frontend/out/` (when `output: 'export'`).

**Important**: The build environment may not have internet access. Google Fonts (Geist, Geist_Mono) are fetched at build time — if the build fails on font loading, you may need to handle this gracefully.

## Key Architectural Constraints

These constraints affect ALL optimization work. Do not violate them:

1. **Static export only** — `output: 'export'` in `next.config.ts`. No SSR, no API routes in Next.js, no `getServerSideProps`, no `getStaticProps` with revalidation.

2. **All pages are `'use client'`** — Every page component uses the `'use client'` directive. There are no React Server Components in this app.

3. **S3 hosting requires trailing slashes** — `trailingSlash: true` in config. Do not remove this.

4. **Asset prefix for production** — `assetPrefix: 'https://www.chqcal.org'` in production. Assets must be served from the CDN domain.

5. **`next/image` is unoptimized** — `images: { unoptimized: true }` because there's no Next.js server to process images. The Image component adds JS overhead without benefit.

6. **Client-side data fetching** — Events are fetched from `/cache/calendar-cache/all-events.json` (a static file on S3/CloudFront). All filtering happens in the browser.

7. **localStorage persistence** — User filter state is saved to localStorage with a 30-day expiry. Don't break the state schema without handling migration.

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
- React Context API for global event data (`GlobalEventDataContext`)
- `useState` / `useReducer` for local component state
- `useMemo` / `useCallback` for expensive computations and stable references
- No external state library (Redux, Zustand, etc.)

### Data Flow
```
CloudFront CDN → all-events.json → Browser Cache (1hr)
    → Client fetch → React state → Filter pipeline → Grouped events → Render
```

### Imports
- Use `@/` path alias for imports (maps to `./src/`)
- Example: `import { Event } from '@/lib/types'`

## Active Optimization Plan

> **CRITICAL**: The detailed task list with step-by-step instructions, file lists, and verification
> criteria lives in **`docs/OPTIMIZATION_PLAN.md`**. You MUST read that file (via `cat` or the Read tool)
> before starting any optimization work. The summary below is just an overview — the plan file has the
> actual instructions you need to follow.

### Task Status Key
- `[ ]` Not started — available to work on (if dependencies are met)
- `[~]` In progress — currently being worked on
- `[x]` Complete — done and verified
- `[!]` Blocked — cannot proceed, see notes

### Current Baseline Metrics

| Metric | Value |
|--------|-------|
| First Load JS (shared) | 101 KB |
| Main page First Load JS | 115 KB |
| Framework chunk (React) | 179 KB on disk |
| Build time | ~6 seconds |
| Production deps | 13 (9 unused) |

### Phase & Task Overview

**Check `docs/OPTIMIZATION_PLAN.md` for current `[x]`/`[~]`/`[ ]` status of each task.**

| Phase | Tasks | Parallelizable | Goal |
|-------|-------|----------------|------|
| 1. Foundation | 1A (bundle analyzer), 1B (remove deps), 1C (dead code) | All 3 | Remove unused deps, set up analysis |
| 2. Decomposition | 2A (types), 2B (utils), 2C (hooks), 2D (filters), 2E (events), 2F (layout) | 2A+2B, then 2C, then 2D+2E, then 2F | Break 1,760-line page.tsx into modules |
| 3. Preact | 3A (install), 3B (compat fixes), 3C (measure) | Sequential | Replace React 19 with Preact |
| 4. Bundle | 4A (admin dynamic), 4B (feedback dynamic), 4C (images), 4D (fonts) | 4A+4B | Dynamic imports, image/font optimization |
| 5. Runtime | 5A (virtual scroll), 5B (useReducer), 5C (debounce), 5D (memoize) | 5A+5B+5C | Virtual scroll, debounce, memoization |
| 6. CSS/Build | 6A (CSS audit), 6B (strict checks) | Both | CSS audit, enable strict build checks |
| 7. PWA | 7A (service worker), 7B (manifest) | Sequential | Service worker, offline support |

### How to Find Your Next Task

1. Open `docs/OPTIMIZATION_PLAN.md`
2. Find the first task marked `[ ]` whose phase dependencies are all `[x]`
3. Mark it `[~]` in the plan file
4. Follow the steps listed under that task
5. Verify using the task's verification criteria
6. Mark it `[x]` and commit

## Agentic Workflow — How to Work on This Project

### Starting a New Conversation

**Every new conversation MUST begin with these steps, in order:**

1. **Read `docs/OPTIMIZATION_PLAN.md`** — this is the source of truth for task status. Use `cat docs/OPTIMIZATION_PLAN.md` or the Read tool. Do NOT skip this step.
2. **Check git log** — run `git log --oneline -10` to see what was recently completed
3. **Verify build** — run `cd frontend && npm run build` to confirm the project is in a working state
4. **Identify the next task** — find the first `[ ]` task in the plan whose dependencies are all `[x]`
5. **Mark the task `[~]`** in `docs/OPTIMIZATION_PLAN.md` before starting work
6. **Work on the task** following its specific steps and file lists
7. **Verify** using the task's verification criteria (`npm run validate && npm run build`)
8. **Mark the task `[x]`** in `docs/OPTIMIZATION_PLAN.md` after verification passes
9. **Commit** with format: `Phase XY: Brief description` (e.g., "Phase 1B: Remove unused dependencies")
10. **Push** to the working branch

**Do NOT invent your own optimization tasks.** The plan is comprehensive and ordered by dependency. Follow it.

### Parallel Task Execution

Tasks within the same phase that are marked "parallelizable" in the plan can be worked on simultaneously by different agents. Each agent should:
- Claim its task by marking `[~]`
- Work only on files listed for that task
- Not modify files belonging to another parallel task
- Commit separately with task-specific messages

### Committing Changes

- **One commit per task** — each task should be a discrete, rollback-able commit
- **Commit message format**: `Phase XY: Brief description of change`
  - Example: `Phase 1B: Remove 9 unused dependencies`
  - Example: `Phase 2A: Extract types and constants from page.tsx`
- **Always run verification** before committing:
  ```bash
  cd frontend && npm run validate && npm run build
  ```
- **Push to the working branch** after each commit

### Handling Failures

- If `npm run build` fails: fix the issue, do not mark the task complete
- If a task is blocked: mark it `[!]` and add a note explaining the blocker
- If you discover a new issue during work: add it as a subtask or note under the relevant task
- If a phase's prerequisite isn't met: do NOT start that phase, work on the prerequisite first

### Handing Off Between Conversations

When ending a conversation:
1. Ensure all completed work is committed and pushed
2. Update task statuses in `docs/OPTIMIZATION_PLAN.md`
3. If a task is partially complete, add notes about what's done and what remains
4. Update the Metrics Tracking section if you completed a phase

When starting a new conversation:
1. Read this file and the optimization plan
2. Check git log for recent commits to understand what was last done
3. Run `npm run build` to verify the project is in a good state
4. Pick up from the next uncompleted task

## Common Pitfalls

### Static Export Limitations
- `dynamic()` from `next/dynamic` works for code splitting but not for SSR features
- No `getServerSideProps`, `getStaticProps` with revalidation, or API routes
- `next/headers`, `next/cookies` are NOT available
- `useSearchParams()` requires `Suspense` boundary

### Preact Migration (Phase 3)
- Preact's compat layer doesn't support all React 19 features
- `React.startTransition` — may not work, use try-catch fallback
- `use()` hook — React 19 only, not in Preact, avoid using it
- `useFormStatus` — React 19 only, not in Preact
- `next/image` should work with Preact compat, but test thoroughly
- Keep `react` and `react-dom` in `package.json` for type definitions even after aliasing to Preact

### Component Decomposition (Phase 2)
- The main `page.tsx` has inline helper functions that capture component state via closure. When extracting to separate files, pass dependencies as parameters instead.
- The `filterEvents()` function references multiple state variables — it needs to accept them as arguments when moved to a utility file.
- `_tagsLowerSet` is computed inline and mutates event objects — move this to the data loading step.

### Build Environment
- Google Fonts may fail to download in offline/CI environments
- The build validates TypeScript and ESLint before bundling (`npm run validate`)
- Current config has `ignoreDuringBuilds: true` for both ESLint and TypeScript — Phase 6B removes these

## File Reference — Key Files for Optimization

| File | Lines | Purpose | Optimization Phase |
|------|-------|---------|--------------------|
| `frontend/src/app/page.tsx` | 1,760 | Main calendar (monolithic) | Phase 2 |
| `frontend/package.json` | 42 | Dependencies | Phase 1 |
| `frontend/next.config.ts` | 22 | Build config | Phases 1, 3, 6 |
| `frontend/src/app/layout.tsx` | 59 | Root layout + fonts | Phase 4 |
| `frontend/src/app/globals.css` | 203 | Tailwind + custom CSS | Phase 6 |
| `frontend/src/app/feedback/page.tsx` | 278 | Feedback form | Phase 4 |
| `frontend/src/app/admin/feedback/page.tsx` | 603 | Admin dashboard | Phase 4 |
| `frontend/src/app/admin/login/page.tsx` | 189 | OAuth login | Phase 4 |
| `frontend/src/lib/auth.ts` | 43 | Auth utilities | — |
| `docs/OPTIMIZATION_PLAN.md` | ~530 | Task tracking | All phases |

## Verification Checklist

Run this after every set of changes:

```bash
# 1. Type check
cd frontend && npm run type-check

# 2. Lint
npm run lint

# 3. Full build (includes validate)
npm run build

# 4. Check build output for regressions
# Look at Route sizes in build output — they should not increase significantly

# 5. Dev server smoke test (if available)
npm run dev
# Then visit: http://localhost:3000
# Verify: events load, search works, filters work, descriptions expand
```

## Dependencies — What's Used vs. Unused

### Actually Used in Source Code
- `next` — framework
- `react` / `react-dom` — UI (migrating to Preact)
- `tailwindcss` / `@tailwindcss/postcss` — styling

### Installed But NOT Imported (to be removed in Phase 1B)
- `@auth/core` — not imported in frontend
- `@aws-amplify/ui-react` — not imported
- `aws-amplify` — not imported
- `@headlessui/react` — not imported
- `@heroicons/react` — not imported
- `@hookform/resolvers` — not imported
- `react-hook-form` — not imported
- `date-fns` — not imported (uses native Date)
- `zod` — not imported

### Needs Verification Before Removing
- `class-variance-authority` — check for `cva` imports
- `clsx` — check for `clsx` or `cx` imports
- `tailwind-merge` — check for `twMerge` or `cn` imports
