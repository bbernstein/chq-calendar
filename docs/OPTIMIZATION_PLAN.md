# Chautauqua Calendar - Frontend Optimization Plan

> **Tracking Document**: Update task statuses as work progresses.
> Status markers: `[ ]` Not started | `[~]` In progress | `[x]` Complete | `[!]` Blocked

## Current State Summary

| Metric | Value |
|--------|-------|
| Framework | Next.js 15.3.5 + React 19 |
| Main page.tsx | ~1,760 lines, 35+ hooks in single component |
| Total frontend source | ~3,135 lines across 7 files |
| Unused dependencies | 9 packages (~significant bundle bloat) |
| Code splitting | None (beyond App Router routes) |
| Build output | Static export to S3 + CloudFront |
| Client-side only | All pages are `'use client'` |

## Architecture Constraints

- **Static export** (`output: 'export'`) — no SSR/SSG, no API routes in Next.js
- **All filtering is client-side** — ~1,470 events loaded as a single JSON file
- **CloudFront CDN** — 24-hour edge cache, 1-hour browser cache
- **S3 hosting** — trailing slashes required for directory compatibility
- **Production domain** — `https://www.chqcal.org` with asset prefix

---

## Phase 1: Foundation & Dependency Cleanup

**Goal**: Establish baseline measurements, remove dead weight, set up tooling.
**Parallelizable**: Tasks 1A, 1B, and 1C can run concurrently.

### Task 1A: Bundle Analysis & Baseline `[x]`

**Description**: Install bundle analyzer, capture baseline build metrics.

**Files to modify**:
- `frontend/package.json` (add devDependency)
- `frontend/next.config.ts` (add analyzer config)

**Steps**:
1. Install `@next/bundle-analyzer` as a devDependency
2. Add analyzer configuration to `next.config.ts` (wrapped in env check)
3. Run `ANALYZE=true npm run build` and save the output
4. Record baseline metrics in this document under "Baseline Metrics" section below
5. Capture total JS bundle size, largest chunks, and page sizes

**Verification**:
- `npm run build` succeeds
- Bundle analyzer report generates when `ANALYZE=true`
- Baseline metrics recorded in this file

### Task 1B: Remove Unused Dependencies `[x]`

**Description**: Remove 9 unused packages that are installed but never imported.

**Packages to remove** (confirmed unused via source code analysis):
- `@auth/core` — not imported anywhere in frontend
- `@aws-amplify/ui-react` — not imported
- `aws-amplify` — not imported
- `@headlessui/react` — not imported
- `@heroicons/react` — not imported
- `@hookform/resolvers` — not imported
- `react-hook-form` — not imported
- `date-fns` — not imported (app uses native `Date`)
- `zod` — not imported

**Packages to verify before removing** (may have indirect usage):
- `class-variance-authority` — check for `cva` imports
- `clsx` — check for `clsx` or `cx` imports
- `tailwind-merge` — check for `twMerge` or `cn` imports

**Files to modify**:
- `frontend/package.json`

**Steps**:
1. Grep the entire `frontend/src/` directory for imports of each package
2. For confirmed unused packages, remove from `dependencies` in `package.json`
3. Run `npm install` to update lockfile
4. Run `npm run build` to verify nothing breaks
5. If `class-variance-authority`, `clsx`, or `tailwind-merge` ARE used, keep them

**Verification**:
- `npm run build` succeeds with no errors
- `npm run validate` (type-check + lint) passes
- Application loads and functions correctly in dev mode

### Task 1C: Clean Up Dead Code `[x]`

**Description**: Remove empty/unused source files.

**Files to modify**:
- `frontend/src/app/auth.ts` — empty file (1 line), remove it

**Steps**:
1. Verify `auth.ts` in `src/app/` is truly empty/unused
2. Check no other files import from `@/app/auth`
3. Delete the file
4. Run `npm run build` to verify

**Verification**:
- `npm run build` succeeds
- No import errors

---

## Phase 2: Component Decomposition

**Goal**: Break the 1,760-line `page.tsx` into maintainable, testable modules.
**Dependencies**: Phase 1 must be complete.
**Parallelizable**: Tasks 2A and 2B can run concurrently. Tasks 2C-2F depend on 2A/2B.

### Target File Structure

```
frontend/src/
├── app/
│   ├── page.tsx              (slim: imports + composition only, <100 lines)
│   ├── layout.tsx            (unchanged)
│   ├── globals.css           (unchanged)
│   ├── feedback/page.tsx     (unchanged for now)
│   ├── admin/
│   │   ├── login/page.tsx    (unchanged for now)
│   │   └── feedback/page.tsx (unchanged for now)
├── components/
│   ├── calendar/
│   │   ├── EventCard.tsx         (single event display)
│   │   ├── EventList.tsx         (day-grouped event list)
│   │   ├── DayHeader.tsx         (sticky day header)
│   │   └── EventImage.tsx        (event image/attachment display)
│   ├── filters/
│   │   ├── SearchBar.tsx         (search input)
│   │   ├── DateFilter.tsx        (today/next/this-week buttons)
│   │   ├── WeekSelector.tsx      (Chautauqua week 1-9 selector with drag)
│   │   ├── LocationFilter.tsx    (location list + recent pills)
│   │   ├── CategoryFilter.tsx    (category/tag list + recent pills)
│   │   ├── FilterPills.tsx       (horizontal scrollable pills)
│   │   └── ActiveFilters.tsx     (clear-all + active filter summary)
│   ├── layout/
│   │   ├── Header.tsx            (app header + menu)
│   │   ├── LoadingSpinner.tsx    (loading state)
│   │   └── EmptyState.tsx        (no results)
│   └── providers/
│       └── GlobalEventDataProvider.tsx (context provider)
├── hooks/
│   ├── useEventData.ts           (data fetching + caching)
│   ├── useFilterState.ts         (filter state management)
│   ├── useEventFiltering.ts      (search + filter logic)
│   ├── useScrollState.ts         (scroll position tracking)
│   ├── useRecentItems.ts         (FIFO recent items)
│   ├── useLocalStorage.ts        (localStorage persistence)
│   └── useWeekCalculation.ts     (Chautauqua season weeks)
├── lib/
│   ├── auth.ts                   (existing, unchanged)
│   ├── types.ts                  (Event, GlobalEventData interfaces)
│   ├── constants.ts              (cache expiry, season dates, etc.)
│   └── utils/
│       ├── dateHelpers.ts        (isToday, isNext, week calculations)
│       ├── searchHelpers.ts      (search scoring algorithm)
│       ├── eventHelpers.ts       (HTML decode, groupByDay)
│       └── filterHelpers.ts      (filter pipeline)
```

### Task 2A: Extract Types and Constants `[x]`

**Description**: Move interfaces, types, and constants out of `page.tsx`.

**Files to create**:
- `frontend/src/lib/types.ts`
- `frontend/src/lib/constants.ts`

**What to extract from `page.tsx`**:
- `Event` interface (lines 6-34)
- `GlobalEventData` interface (lines 36-44)
- `CACHE_EXPIRY_MS` constant (line 94)
- `USER_STATE_EXPIRY_MS` constant (line 95)
- Season year/dates constants
- Any other shared types

**Steps**:
1. Create `lib/types.ts` with all interfaces, exported
2. Create `lib/constants.ts` with all magic numbers/strings
3. Update `page.tsx` to import from these files
4. Run `npm run validate` to ensure type checking passes

**Verification**:
- `npm run validate` passes
- `npm run build` succeeds
- No functional changes — app behaves identically

### Task 2B: Extract Utility Functions `[x]`

**Description**: Move pure helper functions out of the component.

**Files to create**:
- `frontend/src/lib/utils/dateHelpers.ts`
- `frontend/src/lib/utils/searchHelpers.ts`
- `frontend/src/lib/utils/eventHelpers.ts`
- `frontend/src/lib/utils/filterHelpers.ts`

**What to extract from `page.tsx`**:
- `dateHelpers.ts`: `isToday()`, `isNext()`, `isThisWeek()`, `isInChautauquaWeek()`, `isWeekInPast()`, `getWeekNumberForDate()`, `getChautauquaSeasonWeeks()`
- `searchHelpers.ts`: `searchEvents()` (the scoring search algorithm)
- `eventHelpers.ts`: `decodeEventHtmlEntities()`, `groupEventsByDay()`
- `filterHelpers.ts`: `filterEvents()` (the main filter pipeline)

**Steps**:
1. Create each utility file with the extracted functions
2. Ensure all functions are pure (no React state dependencies) — pass dependencies as parameters
3. Update `page.tsx` to import from utility files
4. Run `npm run validate`

**Verification**:
- `npm run validate` passes
- `npm run build` succeeds
- All filter/search functionality works identically in dev mode

### Task 2C: Extract Custom Hooks `[x]`

**Description**: Consolidate 35+ hooks into focused custom hooks.

**Dependencies**: Tasks 2A, 2B complete (types and utils must exist first).

**Files to create**:
- `frontend/src/hooks/useEventData.ts` — data fetching, global context, caching
- `frontend/src/hooks/useFilterState.ts` — all filter state (search, tags, locations, dates, weeks)
- `frontend/src/hooks/useEventFiltering.ts` — applies filters to events, returns grouped results
- `frontend/src/hooks/useScrollState.ts` — horizontal/vertical scroll tracking
- `frontend/src/hooks/useRecentItems.ts` — FIFO recent locations/categories
- `frontend/src/hooks/useLocalStorage.ts` — save/load user state with expiry
- `frontend/src/hooks/useWeekCalculation.ts` — Chautauqua season week math

**Steps**:
1. Create `useLocalStorage.ts` first (no dependencies on other hooks)
2. Create `useWeekCalculation.ts` (depends on types + dateHelpers)
3. Create `useRecentItems.ts` (depends on useLocalStorage)
4. Create `useScrollState.ts` (standalone DOM hook)
5. Create `useFilterState.ts` (depends on useLocalStorage, useRecentItems)
6. Create `useEventData.ts` (depends on types, constants, context)
7. Create `useEventFiltering.ts` (depends on useFilterState, utils)
8. Update `page.tsx` to use the new hooks
9. Run `npm run validate`

**Verification**:
- `npm run validate` passes
- `npm run build` succeeds
- All state management works: filters, search, persistence, recent items

### Task 2D: Extract Filter Components `[x]`

**Description**: Break filter UI into individual components.

**Dependencies**: Task 2C complete (hooks must exist).

**Files to create**:
- `frontend/src/components/filters/SearchBar.tsx`
- `frontend/src/components/filters/DateFilter.tsx`
- `frontend/src/components/filters/WeekSelector.tsx`
- `frontend/src/components/filters/LocationFilter.tsx`
- `frontend/src/components/filters/CategoryFilter.tsx`
- `frontend/src/components/filters/FilterPills.tsx`
- `frontend/src/components/filters/ActiveFilters.tsx`

**Steps**:
1. Identify JSX blocks in `page.tsx` for each filter section
2. Create components with typed props (accepting state + callbacks from hooks)
3. Keep `'use client'` directive on each component
4. Replace inline JSX in `page.tsx` with component imports
5. Run `npm run validate`

**Verification**:
- `npm run validate` passes
- All filters render and function identically
- Week drag-to-select still works
- Recent items pills scroll correctly

### Task 2E: Extract Calendar/Event Components `[x]`

**Description**: Break event display into individual components.

**Dependencies**: Task 2C complete.

**Files to create**:
- `frontend/src/components/calendar/EventCard.tsx`
- `frontend/src/components/calendar/EventList.tsx`
- `frontend/src/components/calendar/DayHeader.tsx`
- `frontend/src/components/calendar/EventImage.tsx`

**Steps**:
1. Extract the event card rendering (single event: title, time, location, description, image, URL)
2. Extract day header (sticky date header with event count)
3. Extract event list (maps grouped events to day sections)
4. Extract image display component
5. Replace inline JSX in `page.tsx`
6. Run `npm run validate`

**Verification**:
- `npm run validate` passes
- Events display correctly with all details
- Expandable descriptions work
- Sticky day headers work
- Event images load correctly

### Task 2F: Extract Layout Components & Finalize page.tsx `[x]`

**Description**: Extract remaining UI pieces, reduce `page.tsx` to composition only.

**Dependencies**: Tasks 2D, 2E complete.

**Files to create**:
- `frontend/src/components/layout/Header.tsx`
- `frontend/src/components/layout/LoadingSpinner.tsx`
- `frontend/src/components/layout/EmptyState.tsx`
- `frontend/src/components/providers/GlobalEventDataProvider.tsx`

**Steps**:
1. Extract header/navigation/menu
2. Extract loading spinner
3. Extract "no results" empty state
4. Move `GlobalEventDataProvider` to its own file
5. Slim down `page.tsx` to only import components and compose them
6. Target: `page.tsx` should be under 100 lines
7. Run `npm run validate` and `npm run build`

**Verification**:
- `npm run validate` passes
- `npm run build` succeeds
- `page.tsx` is under 100 lines
- Complete app functions identically to before decomposition
- Run through all user flows: load events, search, filter by category/location/date/week, expand descriptions, clear filters

---

## Phase 3: Preact Migration

**Goal**: Replace React 19 (~140KB) with Preact (~3KB) + preact/compat for dramatic bundle reduction.
**Dependencies**: Phase 2 must be complete (clean component structure makes migration safer).

### Task 3A: Install and Configure Preact `[x]`

**Description**: Set up Preact with Next.js compatibility layer.

**Files to modify**:
- `frontend/package.json`
- `frontend/next.config.ts`

**Steps**:
1. Install Preact packages:
   ```
   npm install preact @preact/compat
   ```
2. Add webpack aliases to `next.config.ts`:
   ```typescript
   webpack: (config, { isServer }) => {
     if (!isServer) {
       config.resolve.alias = {
         ...config.resolve.alias,
         'react': 'preact/compat',
         'react-dom': 'preact/compat',
         'react/jsx-runtime': 'preact/jsx-runtime',
       };
     }
     return config;
   }
   ```
3. Run `npm run build` and check for errors
4. Note: Keep `react` and `react-dom` in package.json for type compatibility

**Known considerations**:
- `next/image` should work with Preact compat
- `createContext`/`useContext` are supported by Preact compat
- `Suspense` is supported in Preact
- If `@preact/next-plugin` exists for Next.js 15, prefer that over manual aliases

**Verification**:
- `npm run build` succeeds
- Application loads in browser with no console errors
- All hooks work (useState, useEffect, useMemo, useRef, useCallback, useContext)
- Event filtering works
- Page navigation works

### Task 3B: Fix Preact Compatibility Issues `[x]`

**Description**: Address any React 19-specific APIs that Preact doesn't support.

**Dependencies**: Task 3A complete.

**Steps**:
1. Test every page route: `/`, `/feedback/`, `/admin/login/`, `/admin/feedback/`
2. Check browser console for warnings/errors
3. Fix any incompatible API usage (replace with Preact alternatives)
4. Test: search, filter, expand descriptions, scroll, drag-to-select weeks
5. Test: feedback form submission
6. Test: admin login flow

**Common issues to watch for**:
- `React.startTransition` — not in Preact, wrap in try-catch or polyfill
- `use()` hook — React 19 only, replace with useEffect+useState
- `useFormStatus` — React 19 only, replace with manual state
- Server components — N/A (all pages are `'use client'`)

**Verification**:
- All pages load without errors
- Zero console warnings related to React/Preact
- All interactive features work

### Task 3C: Measure Bundle Reduction `[x]`

**Description**: Capture post-Preact metrics and compare to baseline.

**Steps**:
1. Run `ANALYZE=true npm run build`
2. Record new bundle sizes
3. Compare with Phase 1 baseline
4. Update "Metrics Tracking" section in this document
5. Expected savings: ~130KB+ (React ~140KB → Preact ~3KB)

**Verification**:
- Bundle size significantly reduced
- Metrics documented

---

## Phase 4: Bundle Optimization

**Goal**: Implement code splitting and dynamic imports for routes.
**Dependencies**: Phase 3 must be complete.
**Parallelizable**: Tasks 4A and 4B can run concurrently.

### Task 4A: Dynamic Import for Admin Pages `[ ]`

**Description**: Lazy-load admin components since most users never visit them.

**Files to modify**:
- `frontend/src/app/admin/feedback/page.tsx`
- `frontend/src/app/admin/login/page.tsx`

**Steps**:
1. Move the main component logic from each admin page into a separate client component file
2. Use `dynamic()` from `next/dynamic` in the page files to lazy-load the components
3. Add appropriate loading fallbacks (skeleton/spinner)
4. Example pattern:
   ```typescript
   import dynamic from 'next/dynamic';
   const AdminFeedback = dynamic(() => import('@/components/admin/AdminFeedback'), {
     loading: () => <LoadingSpinner />
   });
   ```
5. Run `npm run build`

**Verification**:
- Admin pages still function correctly
- Build output shows separate chunks for admin components
- Main page bundle does not include admin code

### Task 4B: Dynamic Import for Feedback Page `[ ]`

**Description**: Lazy-load feedback form since it's a separate route.

**Files to modify**:
- `frontend/src/app/feedback/page.tsx`

**Steps**:
1. Move feedback form logic into `@/components/feedback/FeedbackForm.tsx`
2. Use `dynamic()` import in the page file
3. Add loading fallback
4. Run `npm run build`

**Verification**:
- Feedback form still works (submission, reCAPTCHA)
- Separate chunk in build output

### Task 4C: Optimize Image Handling `[ ]`

**Description**: Replace `next/image` with native `<img>` where appropriate for static export.

Since the app uses `unoptimized: true`, `next/image` adds JS overhead without providing optimization.

**Files to modify**:
- All files using `Image` from `next/image`

**Steps**:
1. For simple static images (logos, icons): replace `<Image>` with `<img>` with explicit dimensions
2. For event images (external URLs): use native `<img>` with `loading="lazy"` and `decoding="async"`
3. Remove `next/image` imports from modified files
4. Add proper `width`/`height` attributes to prevent CLS
5. Run `npm run build`

**Verification**:
- All images display correctly
- No layout shift (explicit dimensions set)
- External event images lazy-load
- Bundle size reduced (no next/image runtime)

### Task 4D: Font Optimization `[ ]`

**Description**: Optimize Google Font loading strategy.

**Files to modify**:
- `frontend/src/app/layout.tsx`

**Steps**:
1. Evaluate if both Geist and Geist_Mono are actually used in the app
2. If Geist_Mono is unused, remove it
3. Consider using `display: 'swap'` for font loading
4. Consider using `font-display: optional` for non-critical fonts
5. If font loading adds significant bundle weight, consider system font stack as alternative

**Verification**:
- Fonts render correctly
- No FOUT/FOIT regression
- Build succeeds

---

## Phase 5: Runtime Performance

**Goal**: Optimize rendering performance for 1,470+ events.
**Dependencies**: Phase 2 must be complete (component structure needed).
**Parallelizable**: Tasks 5A, 5B, 5C can run concurrently.

### Task 5A: Virtual Scrolling for Event List `[ ]`

**Description**: Implement windowed rendering so only visible events are in the DOM.

**Files to modify**:
- `frontend/src/components/calendar/EventList.tsx`
- `frontend/package.json` (if using a library)

**Options** (pick one):
1. **Lightweight custom implementation** — Use `IntersectionObserver` to render events in batches of 50
2. **@tanstack/react-virtual** — ~5KB, well-maintained virtual scroll library
3. **Simple pagination** — "Load more" button after first 100 events

**Recommended**: Option 1 (IntersectionObserver batch rendering) for minimal dependency.

**Steps**:
1. Implement progressive rendering: show first 50 events, load more as user scrolls
2. Use `IntersectionObserver` to detect when user reaches the bottom
3. Render next batch of events on intersection
4. Maintain sticky day headers during scrolling
5. Ensure "scroll to today" still works
6. Run `npm run build`

**Verification**:
- Initial render only has ~50 event DOM nodes
- Scrolling loads more events smoothly
- Sticky day headers still work
- Filter changes reset the virtual list
- Search results render correctly

### Task 5B: Optimize Filter State with useReducer `[ ]`

**Description**: Replace 20+ individual `useState` calls with a single `useReducer`.

**Files to modify**:
- `frontend/src/hooks/useFilterState.ts`

**Steps**:
1. Define a `FilterState` interface with all filter fields
2. Define action types: `SET_SEARCH`, `TOGGLE_TAG`, `TOGGLE_LOCATION`, `SET_DATE_FILTER`, `TOGGLE_WEEK`, `CLEAR_ALL`, `LOAD_SAVED_STATE`
3. Implement reducer function
4. Replace useState calls in `useFilterState` with single `useReducer`
5. This reduces re-renders since state updates are batched in the reducer
6. Run `npm run validate`

**Verification**:
- All filter interactions work identically
- State persistence (localStorage) still works
- Fewer re-renders (verify with React DevTools profiler)

### Task 5C: Debounce Search Input `[ ]`

**Description**: Add debouncing to search to prevent filtering on every keystroke.

**Files to modify**:
- `frontend/src/components/filters/SearchBar.tsx` (or equivalent)
- `frontend/src/hooks/useFilterState.ts`

**Steps**:
1. Implement a simple `useDebounce` hook (no library needed):
   ```typescript
   function useDebounce<T>(value: T, delay: number): T {
     const [debouncedValue, setDebouncedValue] = useState(value);
     useEffect(() => {
       const timer = setTimeout(() => setDebouncedValue(value), delay);
       return () => clearTimeout(timer);
     }, [value, delay]);
     return debouncedValue;
   }
   ```
2. Apply 200ms debounce to search term before passing to filter pipeline
3. Show immediate feedback in the input (no delay on typing)
4. Only debounce the expensive filtering operation

**Verification**:
- Typing in search feels responsive (input updates immediately)
- Filter results update after 200ms pause
- Rapid typing doesn't cause performance issues

### Task 5D: Memoize Filtered and Grouped Results `[ ]`

**Description**: Ensure filtering/grouping only recalculates when inputs change.

**Files to modify**:
- `frontend/src/hooks/useEventFiltering.ts`

**Steps**:
1. Wrap `filterEvents()` result in `useMemo` with proper dependency array
2. Wrap `groupEventsByDay()` result in `useMemo` depending on filtered events
3. Ensure `_tagsLowerSet` pre-computation happens once when data loads (not on each filter)
4. Verify dependency arrays are minimal and correct

**Verification**:
- Filtering only runs when filter state changes
- Grouping only runs when filtered events change
- No unnecessary recalculations on unrelated state changes

---

## Phase 6: CSS & Build Optimization

**Goal**: Optimize CSS delivery and build configuration.
**Dependencies**: Phase 2 must be complete.
**Parallelizable**: Tasks 6A and 6B can run concurrently.

### Task 6A: CSS Optimization `[ ]`

**Description**: Audit Tailwind usage and optimize CSS delivery.

**Steps**:
1. Verify Tailwind CSS 4's automatic purging is working correctly
2. Check final CSS bundle size
3. Move custom CSS from `globals.css` to Tailwind `@layer` directives where possible
4. Evaluate if any custom CSS can be replaced with Tailwind utilities
5. Check for duplicate/unused CSS rules

**Verification**:
- CSS bundle size documented
- No visual regressions
- All custom scroll indicators still work

### Task 6B: Enable Strict Build Checks `[ ]`

**Description**: Remove the `ignoreDuringBuilds` flags and fix any issues.

**Files to modify**:
- `frontend/next.config.ts`

**Steps**:
1. Remove `eslint.ignoreDuringBuilds: true`
2. Remove `typescript.ignoreBuildErrors: true`
3. Run `npm run build` and fix any errors
4. This ensures code quality is enforced at build time

**Verification**:
- `npm run build` succeeds with strict checks enabled
- No TypeScript errors
- No ESLint errors

---

## Phase 7: PWA & Advanced Caching

**Goal**: Add service worker for offline capability and improved caching.
**Dependencies**: All prior phases should be complete for best results.

### Task 7A: Service Worker with Offline Support `[ ]`

**Description**: Add a service worker for asset caching and offline access.

**Files to create**:
- `frontend/public/sw.js` (or use `next-pwa` package)

**Steps**:
1. Create a lightweight service worker that:
   - Caches static assets (HTML, CSS, JS, images) on install
   - Serves cached assets when offline
   - Uses network-first strategy for the events JSON file
   - Uses cache-first strategy for static assets
2. Register the service worker in `layout.tsx` or a dedicated component
3. Add appropriate cache versioning
4. Do NOT use `next-pwa` if it adds significant bundle size — a hand-written SW is fine

**Verification**:
- Service worker registers successfully
- App loads when offline (with cached data)
- New data fetched when online
- Cache updates on new deployments

### Task 7B: Enhanced manifest.json `[ ]`

**Description**: Improve the PWA manifest for better install experience.

**Files to modify**:
- `frontend/public/manifest.json`

**Steps**:
1. Review current manifest.json
2. Add proper icons in multiple sizes
3. Add theme colors, background color
4. Add shortcuts for common actions
5. Ensure the app is installable as a PWA

**Verification**:
- Lighthouse PWA audit passes
- App can be installed on mobile/desktop
- Proper icons shown in installed app

---

## Metrics Tracking

Update this section after each phase:

### Baseline (Pre-optimization)

| Metric | Value |
|--------|-------|
| Total JS on disk (.next/static/chunks/) | 857 KB |
| First Load JS shared by all routes | 101 KB |
| Main page (`/`) First Load JS | 115 KB (8.37 KB page + 101 KB shared) |
| Admin feedback First Load JS | 111 KB (3.73 KB page + shared) |
| Feedback page First Load JS | 110 KB (2.78 KB page + shared) |
| Admin login First Load JS | 103 KB (2.08 KB page + shared) |
| Framework chunk (React) | 179 KB on disk |
| Polyfills chunk | 110 KB on disk |
| Main chunk | 117 KB on disk |
| Build time | ~6 seconds |
| Dependency count | 13 production deps |
| Unused deps disk footprint | ~61 MB (aws-amplify 30.6M, date-fns 24M, heroicons 5M, headlessui 1.4M) |
| React + React-DOM on disk | 6.5 MB |
| Node.js version | 22.22.0 |
| Next.js version | 15.3.5 |
| React version | 19.1.0 |

### After Phase 1 (Dependency Cleanup)

| Metric | Value | Delta |
|--------|-------|-------|
| Total JS bundle size | 115 KB (unchanged) | 0 (unused deps weren't bundled) |
| Dependency count | 3 production deps | -12 removed |
| Bundle analyzer | Installed & configured | New tooling |
| Dead code | auth.ts removed | -1 file |

### After Phase 3 (Preact Migration)

| Metric | Value | Delta |
|--------|-------|-------|
| First Load JS shared | 52.4 KB | -48.6 KB (-48%) |
| Main page First Load JS | 68 KB | -48 KB (-41%) |
| Framework chunk | Eliminated (Preact in shared) | -53 KB chunk |
| Shared chunk | 50.4 KB | Replaces React 53.2 KB + 46.2 KB |

### After Phase 4 (Bundle Optimization)

| Metric | Value | Delta |
|--------|-------|-------|
| Total JS bundle size | _TBD_ | _TBD_ |
| Main page chunk | _TBD_ | _TBD_ |
| Admin chunk | _TBD_ | _TBD_ |

### Final (All Phases Complete)

| Metric | Value | Delta from Baseline |
|--------|-------|---------------------|
| Total JS bundle size | _TBD_ | _TBD_ |
| First Load JS | _TBD_ | _TBD_ |
| Build time | _TBD_ | _TBD_ |
| Lighthouse Performance | _TBD_ | _TBD_ |

---

## Phase Dependency Graph

```
Phase 1 (Foundation)
  ├─ 1A (Bundle Analysis)  ──┐
  ├─ 1B (Remove Unused Deps) ├─→ Phase 2 (Decomposition)
  └─ 1C (Clean Dead Code)  ──┘
                                    │
Phase 2 (Decomposition)            │
  ├─ 2A (Types/Constants) ─────┐   │
  ├─ 2B (Utility Functions) ───┤   │
  │                             ▼   │
  ├─ 2C (Custom Hooks) ────────┤   │
  │                             ▼   │
  ├─ 2D (Filter Components) ───┤   │
  ├─ 2E (Event Components) ────┤   │
  │                             ▼   │
  └─ 2F (Layout + Finalize) ───┴─→ Phase 3 (Preact)
                                        │
Phase 3 (Preact)                       │
  ├─ 3A (Install/Configure) ──┐       │
  ├─ 3B (Fix Compat Issues) ──┤       │
  └─ 3C (Measure Reduction) ──┴─→ Phase 4 (Bundle Opt)
                                        │
Phase 4 (Bundle Opt)                   │
  ├─ 4A (Admin Dynamic Import)  ──┐   │
  ├─ 4B (Feedback Dynamic Import) ├─→ Phase 5 (Runtime Perf)
  ├─ 4C (Image Optimization)      │   Phase 6 (CSS/Build)
  └─ 4D (Font Optimization)    ───┘   Phase 7 (PWA)
                                       │
Phases 5, 6, 7 can run in parallel ────┘
```

---

## How to Use This Plan Across Conversations

1. **Check current status**: Read this file to see which tasks are `[ ]`, `[~]`, or `[x]`
2. **Pick the next phase**: Follow the dependency graph — only start a phase when its prerequisites are `[x]`
3. **Mark tasks in progress**: Change `[ ]` to `[~]` when starting a task
4. **Mark tasks complete**: Change `[~]` to `[x]` when verified
5. **Record metrics**: Update the Metrics Tracking section after each phase
6. **Parallel execution**: Tasks marked "parallelizable" within a phase can be worked on simultaneously by different agents
7. **Always verify**: Every task has verification steps — never mark complete without passing them
8. **Commit after each task**: Each task should be a separate commit for easy rollback
