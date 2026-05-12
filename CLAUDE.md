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
│   │   ├── entries/             # Vite entry points per page
│   │   │   ├── main.tsx         # Main calendar entry
│   │   │   ├── feedback.tsx     # Feedback form entry
│   │   │   ├── admin-login.tsx  # OAuth login entry
│   │   │   └── admin-feedback.tsx # Admin dashboard entry
│   │   ├── app/
│   │   │   ├── page.tsx         # Main calendar component
│   │   │   ├── globals.css      # Tailwind + custom CSS
│   │   │   ├── feedback/page.tsx        # Public feedback form
│   │   │   └── admin/
│   │   │       ├── login/page.tsx       # OAuth login
│   │   │       └── feedback/page.tsx    # Admin feedback dashboard
│   │   └── lib/
│   │       └── auth.ts          # Auth helpers (localStorage)
│   ├── public/                  # Static assets (icons, manifest)
│   ├── package.json             # Frontend deps and scripts
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
| Build Tool | Vite | 7 |
| UI Library | Preact | 10 |
| Language | TypeScript | 5 |
| Styling | Tailwind CSS | 4 |
| Deployment | Static build → S3 + CloudFront | — |
| Backend | AWS Lambda + API Gateway | — |
| Database | DynamoDB | — |
| IaC | Terraform | — |
| Node.js | 22 (minimum 20.19) | — |

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
| `docs/OPTIMIZATION_PLAN.md` | Task tracking |

## Verification Checklist

Run this after every set of changes:

```bash
# 1. Frontend validate (type-check + lint) + build
cd frontend && npm run validate && npm run build

# 2. Backend validate (type-check + lint, fails on any warning)
cd ../backend && npm run validate

# 3. Backend build (runs tests + esbuild bundle)
npm run build

# 4. Dev server smoke test (if available)
cd ../frontend && npm run dev
# Then visit: http://localhost:3000
# Verify: events load, search works, filters work, descriptions expand
```

The backend `lint` script runs with `--max-warnings=0`, so any ESLint
warning fails the build. The frontend `lint` script does not (warnings
are reported but do not fail). New backend code must pass
`npm run validate --workspace=backend` before committing.

Coverage floor enforced via `.coverage-floor.json`; see `docs/coverage.md`.

## Dependencies

### Production
- `preact` — UI library

### Dev Dependencies
- `vite` / `@preact/preset-vite` — build tooling
- `tailwindcss` / `@tailwindcss/postcss` — styling
- `typescript` — type checking
- `eslint` / `@typescript-eslint/*` — linting
- `@types/react` / `@types/react-dom` — type definitions (for Preact compat)
