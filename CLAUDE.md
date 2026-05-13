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
│   ├── DESIGN.md                # System design (frontend + backend)
│   ├── CACHING_ARCHITECTURE.md  # Cache strategy evolution
│   ├── DEVELOPMENT_HISTORY.md   # Architecture decisions over time
│   ├── plans/                   # Active plan docs (most are in archive/)
│   ├── runbooks/                # Operational runbooks
│   ├── publisher/               # Publisher-facing docs (live content)
│   └── archive/                 # Historical docs kept for searchability
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
