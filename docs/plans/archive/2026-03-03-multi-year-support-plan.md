# Multi-Year Season Support — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to switch between Chautauqua season years via a dropdown on the header pill button, with tiered backend scheduling (hourly during season, daily otherwise).

**Architecture:** URL-driven year selection (`?year=N`) with a years manifest file (`years.json`) for dynamic year discovery. Frontend hooks manage year state; backend sync handler routes to tiered schedules. All existing data patterns (cache keys, DynamoDB filters) already support year parameterization.

**Tech Stack:** Preact + TypeScript frontend, AWS Lambda + DynamoDB + S3 backend, Terraform infrastructure, Vitest for testing.

**Design doc:** `docs/plans/2026-03-03-multi-year-support-design.md`

---

## Task 1: Add `getDefaultYear()` to constants

Replace hardcoded `ACTIVE_YEAR = 2026` with a computed default and keep backward compat.

**Files:**
- Modify: `frontend/src/lib/constants.ts:3`
- Test: `frontend/src/__tests__/lib/constants.test.ts` (create)

**Step 1: Write the failing test**

Create `frontend/src/__tests__/lib/constants.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getDefaultYear } from '@/lib/constants';

describe('getDefaultYear', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns current year before October', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15)); // June 15, 2026
    expect(getDefaultYear()).toBe(2026);
  });

  it('returns next year on October 1', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1)); // October 1, 2026
    expect(getDefaultYear()).toBe(2027);
  });

  it('returns next year in November', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 15)); // November 15, 2026
    expect(getDefaultYear()).toBe(2027);
  });

  it('returns current year in September', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 30)); // September 30, 2026
    expect(getDefaultYear()).toBe(2026);
  });

  it('returns current year in January', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2027, 0, 15)); // January 15, 2027
    expect(getDefaultYear()).toBe(2027);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/lib/constants.test.ts`
Expected: FAIL — `getDefaultYear` is not exported

**Step 3: Write minimal implementation**

In `frontend/src/lib/constants.ts`, replace `ACTIVE_YEAR = 2026` with:

```typescript
/**
 * Compute the default season year based on October 1 turnover.
 * Before Oct 1: current year. On/after Oct 1: next year.
 */
export function getDefaultYear(): number {
  const now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

// Backward-compatible constant — will be removed once all consumers use getDefaultYear()
export const ACTIVE_YEAR = getDefaultYear();
```

**Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/lib/constants.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/lib/constants.ts frontend/src/__tests__/lib/constants.test.ts
git commit -m "feat: add getDefaultYear() with October 1 turnover logic"
```

---

## Task 2: Create `useAvailableYears` hook

Fetches `/cache/calendar-cache/years.json` manifest to discover which years have data.

**Files:**
- Create: `frontend/src/hooks/useAvailableYears.ts`
- Create: `frontend/src/__tests__/hooks/useAvailableYears.test.ts`
- Modify: `frontend/src/lib/constants.ts` (add URL constant)

**Step 1: Add manifest URL constant**

In `frontend/src/lib/constants.ts`, add:

```typescript
export const YEARS_MANIFEST_PATH = '/cache/calendar-cache/years.json';
```

**Step 2: Write the failing test**

Create `frontend/src/__tests__/hooks/useAvailableYears.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/preact';
import { useAvailableYears } from '@/hooks/useAvailableYears';

describe('useAvailableYears', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('fetches years manifest and returns available years', async () => {
    const mockManifest = { years: [2025, 2026, 2027], defaultYear: 2026, generated: '2026-03-03T12:00:00Z' };
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockManifest),
    });

    const { result } = renderHook(() => useAvailableYears());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.years).toEqual([2025, 2026, 2027]);
    expect(result.current.defaultYear).toBe(2026);
  });

  it('falls back to computed default year on fetch failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15)); // June 2026
    (fetch as any).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useAvailableYears());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.defaultYear).toBe(2026);
    expect(result.current.years).toEqual([2026]);
  });

  it('uses cached manifest from localStorage if fresh', async () => {
    const cached = {
      years: [2025, 2026],
      defaultYear: 2026,
      generated: '2026-03-03T12:00:00Z',
      cachedAt: Date.now(),
    };
    localStorage.setItem('chq-calendar-years', JSON.stringify(cached));

    const { result } = renderHook(() => useAvailableYears());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.years).toEqual([2025, 2026]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
```

**Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/hooks/useAvailableYears.test.ts`
Expected: FAIL — module not found

**Step 4: Write minimal implementation**

Create `frontend/src/hooks/useAvailableYears.ts`:

```typescript
import { useState, useEffect } from 'react';
import { CACHE_EXPIRY_MS, getDefaultYear, YEARS_MANIFEST_PATH } from '@/lib/constants';

interface YearsManifest {
  years: number[];
  defaultYear: number;
  generated: string;
}

interface UseAvailableYearsResult {
  years: number[];
  defaultYear: number;
  loading: boolean;
}

const CACHE_KEY = 'chq-calendar-years';

export function useAvailableYears(): UseAvailableYearsResult {
  const computedDefault = getDefaultYear();
  const [years, setYears] = useState<number[]>([computedDefault]);
  const [defaultYear, setDefaultYear] = useState<number>(computedDefault);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchManifest() {
      // Check localStorage cache first
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.cachedAt && Date.now() - parsed.cachedAt < CACHE_EXPIRY_MS) {
            if (!cancelled) {
              setYears(parsed.years);
              setDefaultYear(parsed.defaultYear);
              setLoading(false);
            }
            return;
          }
        }
      } catch {
        // Ignore cache read errors
      }

      // Fetch from network
      try {
        const url = import.meta.env.DEV ? YEARS_MANIFEST_PATH : YEARS_MANIFEST_PATH;
        const response = await fetch(url);
        if (response.ok) {
          const manifest: YearsManifest = await response.json();
          if (!cancelled) {
            setYears(manifest.years);
            setDefaultYear(manifest.defaultYear);
            setLoading(false);
          }
          // Cache in localStorage
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
              ...manifest,
              cachedAt: Date.now(),
            }));
          } catch {
            // Ignore cache write errors
          }
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch {
        // Fallback: use computed default year
        if (!cancelled) {
          setYears([computedDefault]);
          setDefaultYear(computedDefault);
          setLoading(false);
        }
      }
    }

    fetchManifest();
    return () => { cancelled = true; };
  }, [computedDefault]);

  return { years, defaultYear, loading };
}
```

**Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/hooks/useAvailableYears.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add frontend/src/hooks/useAvailableYears.ts frontend/src/__tests__/hooks/useAvailableYears.test.ts frontend/src/lib/constants.ts
git commit -m "feat: add useAvailableYears hook with manifest fetching and localStorage cache"
```

---

## Task 3: Create `useSelectedYear` hook

Reads `?year=` from URL, validates against available years, and provides setter that updates URL.

**Files:**
- Create: `frontend/src/hooks/useSelectedYear.ts`
- Create: `frontend/src/__tests__/hooks/useSelectedYear.test.ts`

**Step 1: Write the failing test**

Create `frontend/src/__tests__/hooks/useSelectedYear.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useSelectedYear } from '@/hooks/useSelectedYear';

describe('useSelectedYear', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    // Reset URL to clean state
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns default year when no URL param', () => {
    const { result } = renderHook(() =>
      useSelectedYear({ years: [2025, 2026, 2027], defaultYear: 2026 })
    );
    expect(result.current.selectedYear).toBe(2026);
  });

  it('reads year from URL param', () => {
    window.history.replaceState({}, '', '/?year=2025');
    const { result } = renderHook(() =>
      useSelectedYear({ years: [2025, 2026, 2027], defaultYear: 2026 })
    );
    expect(result.current.selectedYear).toBe(2025);
  });

  it('falls back to default for invalid URL param', () => {
    window.history.replaceState({}, '', '/?year=1999');
    const { result } = renderHook(() =>
      useSelectedYear({ years: [2025, 2026, 2027], defaultYear: 2026 })
    );
    expect(result.current.selectedYear).toBe(2026);
  });

  it('updates URL when setSelectedYear is called', () => {
    const { result } = renderHook(() =>
      useSelectedYear({ years: [2025, 2026, 2027], defaultYear: 2026 })
    );
    act(() => {
      result.current.setSelectedYear(2025);
    });
    expect(result.current.selectedYear).toBe(2025);
    expect(new URL(window.location.href).searchParams.get('year')).toBe('2025');
  });

  it('removes year param when selecting default year', () => {
    window.history.replaceState({}, '', '/?year=2025');
    const { result } = renderHook(() =>
      useSelectedYear({ years: [2025, 2026, 2027], defaultYear: 2026 })
    );
    act(() => {
      result.current.setSelectedYear(2026);
    });
    expect(result.current.selectedYear).toBe(2026);
    expect(new URL(window.location.href).searchParams.has('year')).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/hooks/useSelectedYear.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `frontend/src/hooks/useSelectedYear.ts`:

```typescript
import { useState, useCallback } from 'react';

interface UseSelectedYearProps {
  years: number[];
  defaultYear: number;
}

interface UseSelectedYearResult {
  selectedYear: number;
  setSelectedYear: (year: number) => void;
}

function getYearFromUrl(availableYears: number[], defaultYear: number): number {
  const params = new URLSearchParams(window.location.search);
  const yearParam = params.get('year');
  if (yearParam) {
    const parsed = parseInt(yearParam, 10);
    if (!isNaN(parsed) && availableYears.includes(parsed)) {
      return parsed;
    }
  }
  return defaultYear;
}

export function useSelectedYear({ years, defaultYear }: UseSelectedYearProps): UseSelectedYearResult {
  const [selectedYear, setSelectedYearState] = useState(() =>
    getYearFromUrl(years, defaultYear)
  );

  const setSelectedYear = useCallback((year: number) => {
    setSelectedYearState(year);

    // Update URL without page reload
    const url = new URL(window.location.href);
    if (year === defaultYear) {
      url.searchParams.delete('year');
    } else {
      url.searchParams.set('year', year.toString());
    }
    window.history.replaceState({}, '', url.toString());
  }, [defaultYear]);

  return { selectedYear, setSelectedYear };
}
```

**Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/hooks/useSelectedYear.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/useSelectedYear.ts frontend/src/__tests__/hooks/useSelectedYear.test.ts
git commit -m "feat: add useSelectedYear hook with URL param read/write"
```

---

## Task 4: Create `YearSelector` dropdown component

The pill button in the header becomes a clickable dropdown for choosing years.

**Files:**
- Create: `frontend/src/components/layout/YearSelector.tsx`
- Create: `frontend/src/__tests__/components/layout/YearSelector.test.tsx`

**Step 1: Write the failing test**

Create `frontend/src/__tests__/components/layout/YearSelector.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { YearSelector } from '@/components/layout/YearSelector';

describe('YearSelector', () => {
  const defaultProps = {
    selectedYear: 2026,
    availableYears: [2027, 2026, 2025],
    defaultYear: 2026,
    onYearChange: vi.fn(),
  };

  it('renders the selected year with "Season" label', () => {
    const { getByText } = render(<YearSelector {...defaultProps} />);
    expect(getByText(/2026 Season/)).toBeTruthy();
  });

  it('opens dropdown on click', () => {
    const { getByRole, getByText } = render(<YearSelector {...defaultProps} />);
    fireEvent.click(getByRole('button'));
    expect(getByText('2025 Season')).toBeTruthy();
    expect(getByText('2027 Season')).toBeTruthy();
  });

  it('calls onYearChange when a year is selected', () => {
    const onYearChange = vi.fn();
    const { getByRole, getAllByRole } = render(
      <YearSelector {...defaultProps} onYearChange={onYearChange} />
    );
    fireEvent.click(getByRole('button'));
    const options = getAllByRole('option');
    // Click 2025 (last in descending list)
    const option2025 = options.find(o => o.textContent?.includes('2025'));
    if (option2025) fireEvent.click(option2025);
    expect(onYearChange).toHaveBeenCalledWith(2025);
  });

  it('closes dropdown after selection', () => {
    const { getByRole, queryByRole } = render(<YearSelector {...defaultProps} />);
    fireEvent.click(getByRole('button'));
    const listbox = queryByRole('listbox');
    expect(listbox).toBeTruthy();
    // Click the first option
    const options = document.querySelectorAll('[role="option"]');
    if (options[0]) fireEvent.click(options[0]);
    expect(queryByRole('listbox')).toBeNull();
  });

  it('shows "(current)" label next to default year', () => {
    const { getByRole, getByText } = render(<YearSelector {...defaultProps} />);
    fireEvent.click(getByRole('button'));
    expect(getByText(/current/)).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/components/layout/YearSelector.test.tsx`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `frontend/src/components/layout/YearSelector.tsx`:

```typescript
import { useState, useRef, useEffect } from 'react';

interface YearSelectorProps {
  selectedYear: number;
  availableYears: number[];
  defaultYear: number;
  onYearChange: (year: number) => void;
}

export function YearSelector({ selectedYear, availableYears, defaultYear, onYearChange }: YearSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const sortedYears = [...availableYears].sort((a, b) => b - a);
  const showDropdown = availableYears.length > 1;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => showDropdown && setIsOpen(!isOpen)}
        className={`ml-2 sm:ml-3 px-2 sm:px-3 py-0.5 sm:py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs sm:text-sm font-medium rounded-full inline-flex items-center gap-1 ${showDropdown ? 'cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors' : 'cursor-default'}`}
        aria-haspopup={showDropdown ? 'listbox' : undefined}
        aria-expanded={isOpen}
      >
        {selectedYear} Season
        {showDropdown && (
          <svg
            className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 sm:left-2 mt-1 bg-white dark:bg-gray-700 rounded-md shadow-lg py-1 z-50 min-w-[160px] border border-gray-200 dark:border-gray-600"
          aria-label="Select season year"
        >
          {sortedYears.map((year) => (
            <button
              key={year}
              role="option"
              aria-selected={year === selectedYear}
              onClick={() => {
                onYearChange(year);
                setIsOpen(false);
              }}
              className={`block w-full text-left px-4 py-2 text-sm transition-colors ${
                year === selectedYear
                  ? 'bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-200 font-medium'
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600'
              }`}
            >
              <span className="flex items-center justify-between">
                <span>{year} Season</span>
                <span className="flex items-center gap-1">
                  {year === defaultYear && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">(current)</span>
                  )}
                  {year === selectedYear && (
                    <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/components/layout/YearSelector.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/layout/YearSelector.tsx frontend/src/__tests__/components/layout/YearSelector.test.tsx
git commit -m "feat: add YearSelector dropdown component"
```

---

## Task 5: Integrate year selection into Header

Replace the static pill in `Header.tsx` with the `YearSelector` component.

**Files:**
- Modify: `frontend/src/components/layout/Header.tsx`

**Step 1: Update Header to accept year props**

The Header component needs to receive year-related props from the parent. Update `Header.tsx`:

```typescript
import { useState, useEffect, useRef } from 'react';
import { YearSelector } from '@/components/layout/YearSelector';

interface HeaderProps {
  selectedYear: number;
  availableYears: number[];
  defaultYear: number;
  onYearChange: (year: number) => void;
}

export function Header({ selectedYear, availableYears, defaultYear, onYearChange }: HeaderProps) {
```

Replace the static `<span>` pill (line 37-39) with:

```tsx
<YearSelector
  selectedYear={selectedYear}
  availableYears={availableYears}
  defaultYear={defaultYear}
  onYearChange={onYearChange}
/>
```

Remove the `import { ACTIVE_YEAR } from '@/lib/constants';` line.

**Step 2: Run type-check**

Run: `cd frontend && npm run type-check`
Expected: Type errors in `page.tsx` because `Header` now requires props — this is expected and will be fixed in Task 7.

**Step 3: Commit**

```bash
git add frontend/src/components/layout/Header.tsx
git commit -m "feat: integrate YearSelector into Header component"
```

---

## Task 6: Make `useEventData` year-aware

The hook currently imports `ACTIVE_YEAR` and uses it to build the fetch URL. Change it to accept a `year` parameter.

**Files:**
- Modify: `frontend/src/hooks/useEventData.ts`

**Step 1: Update the hook signature**

In `useEventData.ts`, add `year` to the `UseEventDataProps` interface:

```typescript
interface UseEventDataProps {
  year: number;
  globalEventData: GlobalEventData;
  seasonWeeks: SeasonWeek[];
  setAvailableCategories: (categories: string[]) => void;
  setAvailableLocations: (locations: string[]) => void;
}
```

**Step 2: Replace ACTIVE_YEAR usage with the year prop**

In the import line, remove `ACTIVE_YEAR`:

```typescript
import { CACHE_EXPIRY_MS, getCategoryDisplayName, getLocationDisplayName } from '@/lib/constants';
```

In `fetchAllEvents`, replace `ACTIVE_YEAR` with `year` in the fetch URL (lines 69-70):

```typescript
const response = await fetch(
  import.meta.env.DEV
    ? `/data/all-events-${year}.json`
    : `/cache/calendar-cache/all-events-${year}.json`,
```

**Step 3: Make localStorage cache key year-specific**

Update the localStorage key from `'chq-calendar-events'` to include the year:

```typescript
const cacheKey = `chq-calendar-events-${year}`;
```

Replace all 4 occurrences of `'chq-calendar-events'` with `cacheKey`:
- Line 22: `localStorage.removeItem(cacheKey);`
- Line 45: `const cachedData = localStorage.getItem(cacheKey);`
- Line 57: `localStorage.removeItem(cacheKey);`
- Line 159: `localStorage.setItem(cacheKey, JSON.stringify({...}));`

**Step 4: Add `year` to the useCallback dependency array**

Update the dependency array at line 180:

```typescript
}, [year, dataLoaded, globalEventData, seasonWeeks, setAvailableCategories, setAvailableLocations]);
```

**Step 5: Reset dataLoaded when year changes**

Add a `useEffect` that resets state when year changes:

```typescript
// Reset when year changes
useEffect(() => {
  setDataLoaded(false);
  setEvents([]);
  isLoadingRef.current = false;
}, [year]);
```

**Step 6: Run type-check**

Run: `cd frontend && npm run type-check`
Expected: Type error in `page.tsx` because `useEventData` now requires `year` — fixed in Task 7.

**Step 7: Commit**

```bash
git add frontend/src/hooks/useEventData.ts
git commit -m "feat: make useEventData accept year parameter instead of ACTIVE_YEAR"
```

---

## Task 7: Wire everything together in `page.tsx`

Connect `useAvailableYears`, `useSelectedYear`, and pass year to all consumers.

**Files:**
- Modify: `frontend/src/app/page.tsx`

**Step 1: Update imports**

Replace:
```typescript
import { ACTIVE_YEAR } from '@/lib/constants';
```

With:
```typescript
import { useAvailableYears } from '@/hooks/useAvailableYears';
import { useSelectedYear } from '@/hooks/useSelectedYear';
```

**Step 2: Add year hooks to HomeContent**

At the top of the `HomeContent` function, add:

```typescript
const { years: availableYears, defaultYear, loading: yearsLoading } = useAvailableYears();
const { selectedYear, setSelectedYear } = useSelectedYear({ years: availableYears, defaultYear });
```

**Step 3: Update seasonWeeks to use selectedYear**

Replace:
```typescript
const seasonWeeks = useMemo(() => getChautauquaSeasonWeeks(ACTIVE_YEAR), []);
```

With:
```typescript
const seasonWeeks = useMemo(() => getChautauquaSeasonWeeks(selectedYear), [selectedYear]);
```

**Step 4: Pass year to useEventData**

Update the `useEventData` call to include `year`:

```typescript
const { events, loading } = useEventData({
  year: selectedYear,
  globalEventData,
  seasonWeeks,
  setAvailableCategories: filters.setAvailableCategories,
  setAvailableLocations: filters.setAvailableLocations,
});
```

**Step 5: Update Header to pass year props**

Replace:
```tsx
<Header />
```

With:
```tsx
<Header
  selectedYear={selectedYear}
  availableYears={availableYears}
  defaultYear={defaultYear}
  onYearChange={setSelectedYear}
/>
```

**Step 6: Conditionally show CountdownBanner**

Only show the countdown when viewing the default year:

Replace:
```tsx
<CountdownBanner seasonWeeks={seasonWeeks} />
```

With:
```tsx
{selectedYear === defaultYear && <CountdownBanner seasonWeeks={seasonWeeks} />}
```

**Step 7: Update footer year**

Replace:
```tsx
<p className="text-gray-400">© 2026 Chautauqua Calendar by Bernie and Claude</p>
```

With:
```tsx
<p className="text-gray-400">© {new Date().getFullYear()} Chautauqua Calendar by Bernie and Claude</p>
```

**Step 8: Update document title dynamically**

Add a `useEffect` to update the page title when the year changes:

```typescript
useEffect(() => {
  document.title = `Chautauqua Calendar | ${selectedYear} Season`;
}, [selectedYear]);
```

**Step 9: Run full validation**

Run: `cd frontend && npm run validate && npm run build`
Expected: PASS

**Step 10: Commit**

```bash
git add frontend/src/app/page.tsx
git commit -m "feat: wire year selection into main page component"
```

---

## Task 8: Update static references to 2026

Remove hardcoded "2026" from HTML, manifest, and meta tags.

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/public/manifest.json`

**Step 1: Update index.html**

In `frontend/index.html`:
- Change `<title>` from `"Chautauqua Calendar | 2026 Season"` to `"Chautauqua Calendar"`
- Change meta description from `"...2026 season..."` to `"...Chautauqua Institution season..."`
- Change meta keywords: remove `"2026"`
- Change Twitter meta description similarly

**Step 2: Update manifest.json**

In `frontend/public/manifest.json`:
- Change description from `"...2026 season..."` to `"...Chautauqua Institution season with real-time event updates, smart filtering, and export options."`

**Step 3: Run build**

Run: `cd frontend && npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/index.html frontend/public/manifest.json
git commit -m "feat: remove hardcoded 2026 from HTML meta and manifest"
```

---

## Task 9: Handle filter reconciliation on year change

When the user switches years, drop filter selections that don't exist in the new year's data.

**Files:**
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/hooks/useFilterState.ts`

**Step 1: Add RECONCILE_FILTERS action to useFilterState**

In `frontend/src/hooks/useFilterState.ts`, add a new action type:

```typescript
| { type: 'RECONCILE_FILTERS'; payload: { availableCategories: string[]; availableLocations: string[] } }
```

Add the reducer case:

```typescript
case 'RECONCILE_FILTERS': {
  const { availableCategories, availableLocations } = action.payload;
  const availCatsLower = new Set(availableCategories.map(c => c.toLowerCase()));
  const availLocsLower = new Set(availableLocations.map(l => l.toLowerCase()));
  return {
    ...state,
    selectedTags: state.selectedTags.filter(t => availCatsLower.has(t.toLowerCase())),
    selectedLocations: state.selectedLocations.filter(l => availLocsLower.has(l.toLowerCase())),
    selectedWeeks: [],
    dateFilter: 'next' as DateFilter,
    extraDays: 0,
  };
}
```

Expose the action:

```typescript
const reconcileFilters = useCallback(
  (availableCategories: string[], availableLocations: string[]) =>
    dispatch({ type: 'RECONCILE_FILTERS', payload: { availableCategories, availableLocations } }),
  []
);
```

Add `reconcileFilters` to the return object.

**Step 2: Call reconcileFilters in page.tsx when year changes**

In `page.tsx`, add an effect that reconciles filters when new data arrives after a year change. Track the previous year to detect changes:

```typescript
const prevYearRef = useRef(selectedYear);

useEffect(() => {
  if (prevYearRef.current !== selectedYear) {
    prevYearRef.current = selectedYear;
    // Reconcile after data loads for new year
    if (!loading && events.length > 0) {
      filters.reconcileFilters(filters.availableCategories, filters.availableLocations);
    }
  }
}, [selectedYear, loading, events.length, filters.availableCategories, filters.availableLocations]);
```

Add `useRef` to the imports from `react`.

**Step 3: Run validation**

Run: `cd frontend && npm run validate && npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/hooks/useFilterState.ts frontend/src/app/page.tsx
git commit -m "feat: reconcile filters when switching years"
```

---

## Task 10: Backend — Generate years manifest

Add `years.json` manifest generation to the cache warming process.

**Files:**
- Modify: `backend/src/services/eventsCalendarDataSyncService.ts`

**Step 1: Add generateYearsManifest method**

Add a new private method to `EventsCalendarDataSyncService`:

```typescript
/**
 * Generate years.json manifest listing all years that have cached event data.
 * Checks S3 for the existence of all-events-{year}.json files.
 */
private async generateYearsManifest(): Promise<void> {
  const now = new Date();
  const defaultYear = now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();

  // Check which years have data by scanning for all-events-{year}.json files
  const potentialYears: number[] = [];
  // Check from 2025 (earliest data) through defaultYear + 1
  for (let year = 2025; year <= defaultYear + 1; year++) {
    potentialYears.push(year);
  }

  const availableYears: number[] = [];
  for (const year of potentialYears) {
    try {
      const cacheKey = { filters: {}, year };
      const data = await this.cacheService.get(cacheKey);
      if (data && Array.isArray(data) && data.length > 0) {
        availableYears.push(year);
      }
    } catch {
      // Year doesn't have cached data
    }
  }

  // If no years found, at least include the default year
  if (availableYears.length === 0) {
    availableYears.push(defaultYear);
  }

  const manifest = {
    years: availableYears.sort((a, b) => a - b),
    defaultYear,
    generated: new Date().toISOString(),
  };

  // Write manifest to S3
  const bucket = process.env.CACHE_S3_BUCKET;
  const prefix = process.env.CACHE_S3_KEY_PREFIX || 'cache/calendar-cache';
  if (bucket) {
    try {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      const s3Client = this.cacheService.getS3Client();
      await s3Client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: `${prefix}/years.json`,
        Body: JSON.stringify(manifest),
        ContentType: 'application/json',
        CacheControl: 'public, max-age=3600',
      }));
      console.log(`Years manifest written: ${JSON.stringify(manifest)}`);
    } catch (error) {
      console.error('Failed to write years manifest:', error);
    }
  }
}
```

**Step 2: Expose S3 client from MultiLayerCacheService**

In `backend/src/services/multiLayerCacheService.ts`, add a public getter if not already present:

```typescript
public getS3Client(): S3Client {
  return this.s3Client;
}
```

**Step 3: Call generateYearsManifest at end of warmCacheAfterSync**

At the end of `warmCacheAfterSync()` (before the final log), add:

```typescript
// Update years manifest
await this.generateYearsManifest();
```

**Step 4: Run backend tests**

Run: `cd backend && npm test`
Expected: PASS (existing tests should still pass)

**Step 5: Commit**

```bash
git add backend/src/services/eventsCalendarDataSyncService.ts backend/src/services/multiLayerCacheService.ts
git commit -m "feat: generate years.json manifest during cache warming"
```

---

## Task 11: Backend — Update sync handler for tiered scheduling

Update `scheduledSyncHandler` to support hourly (June-Aug only, near-term) and daily (distant + next year) tiers.

**Files:**
- Modify: `backend/src/handlers/syncHandler.ts`
- Modify: `backend/src/services/eventsCalendarDataSyncService.ts` (add `syncNearTerm` and `syncDistantFuture` methods)

**Step 1: Add getDefaultYear helper to sync handler**

At the top of `syncHandler.ts`, add:

```typescript
function getDefaultYear(): number {
  const now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}
```

**Step 2: Add syncNearTerm method to data sync service**

In `eventsCalendarDataSyncService.ts`, add:

```typescript
/**
 * Sync near-term events: 7 days in the past through 14 days ahead.
 * Used for hourly sync during the summer season.
 */
async syncNearTerm(year: number): Promise<any> {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 7);
  const end = new Date(now);
  end.setDate(end.getDate() + 14);

  const startStr = start.toISOString().split('T')[0];
  const endStr = end.toISOString().split('T')[0];

  console.log(`Performing near-term sync for ${startStr} to ${endStr}`);
  return this.syncDateRange(startStr, endStr);
}

/**
 * Sync distant future events for current year (beyond 14 days) and all of next year.
 * Used for daily sync.
 */
async syncDistantFuture(currentYear: number, nextYear: number): Promise<any> {
  // Sync current year (full year covers distant dates)
  console.log(`Performing distant future sync: current year ${currentYear}, next year ${nextYear}`);
  const currentResult = await this.syncFullYearEvents(currentYear);
  const nextResult = await this.syncFullYearEvents(nextYear);

  return {
    currentYear: currentResult,
    nextYear: nextResult,
  };
}
```

**Step 3: Update scheduledSyncHandler routing**

Replace the body of `scheduledSyncHandler`:

```typescript
export const scheduledSyncHandler = async (event: any, context: Context): Promise<void> => {
  console.log('Starting scheduled sync operation:', JSON.stringify(event));

  try {
    const defaultYear = getDefaultYear();
    const detailType = event['detail-type'];

    if (detailType === 'Hourly Sync') {
      // Hourly: only runs June-August, syncs near-term events
      const currentMonth = new Date().getMonth(); // 0-indexed
      if (currentMonth < 5 || currentMonth > 7) {
        console.log(`Skipping hourly sync — current month ${currentMonth + 1} is outside June–August`);
        return;
      }
      console.log(`Performing hourly near-term sync for ${defaultYear}`);
      const result = await syncService.syncNearTerm(defaultYear);
      console.log('Hourly sync completed:', result);

    } else if (detailType === 'Daily Sync') {
      console.log(`Performing daily sync: current year ${defaultYear}, next year ${defaultYear + 1}`);
      const result = await syncService.syncDistantFuture(defaultYear, defaultYear + 1);
      console.log('Daily sync completed:', result);

    } else if (detailType === 'Weekly Full Sync') {
      // Full refresh: all years that have data
      console.log(`Performing weekly full sync`);
      // Sync previous year, current year, and next year
      for (const year of [defaultYear - 1, defaultYear, defaultYear + 1]) {
        console.log(`Full sync for year ${year}`);
        await syncService.syncFullYearEvents(year);
      }

    } else {
      // Default: incremental sync
      console.log('Performing incremental sync');
      const result = await syncService.performIncrementalSync();
      console.log('Incremental sync completed:', result);
    }
  } catch (error) {
    console.error('Sync failed:', error);
    throw error;
  }
};
```

**Step 4: Run backend tests**

Run: `cd backend && npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/handlers/syncHandler.ts backend/src/services/eventsCalendarDataSyncService.ts
git commit -m "feat: update sync handler for tiered scheduling (hourly near-term, daily distant+next year)"
```

---

## Task 12: Infrastructure — Enable hourly EventBridge schedule

Re-enable the hourly EventBridge rule and update environment variables.

**Files:**
- Modify: `infrastructure/sync.tf`

**Step 1: Add hourly EventBridge rule**

In `sync.tf`, add the hourly schedule rule (uncomment and update the previously disabled one, or add new):

```hcl
resource "aws_cloudwatch_event_rule" "hourly_sync" {
  name                = "${var.project_name}-hourly-sync"
  description         = "Trigger hourly near-term sync (active June-August only, handled in Lambda)"
  schedule_expression = "rate(60 minutes)"
  state              = "ENABLED"
}

resource "aws_cloudwatch_event_target" "hourly_sync_target" {
  rule      = aws_cloudwatch_event_rule.hourly_sync.name
  target_id = "HourlySyncTarget"
  arn       = aws_lambda_function.data_sync.arn
  input     = jsonencode({
    "detail-type" = "Hourly Sync"
    "source"      = "chq-calendar.scheduler"
  })
}

resource "aws_lambda_permission" "allow_hourly_sync" {
  statement_id  = "AllowHourlySyncExecution"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.data_sync.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.hourly_sync.arn
}
```

**Step 2: Remove hardcoded ACTIVE_YEAR from Lambda env**

In the `data_sync` Lambda function's environment variables, remove `ACTIVE_YEAR = "2026"` since the handler now computes it at runtime.

**Step 3: Verify Terraform**

Run: `cd infrastructure && terraform validate`
Expected: PASS

**Step 4: Commit**

```bash
git add infrastructure/sync.tf
git commit -m "feat: enable hourly EventBridge schedule, remove hardcoded ACTIVE_YEAR env var"
```

---

## Task 13: Add dev-mode years manifest

For local development, create a static `years.json` in the frontend public data directory.

**Files:**
- Create: `frontend/public/data/years.json`
- Modify: `frontend/src/hooks/useAvailableYears.ts` (use dev path)

**Step 1: Create dev manifest**

Create `frontend/public/data/years.json`:

```json
{
  "years": [2025, 2026],
  "defaultYear": 2026,
  "generated": "2026-03-03T00:00:00Z"
}
```

**Step 2: Update useAvailableYears to use correct dev path**

In `useAvailableYears.ts`, update the fetch URL to use the dev data path:

```typescript
const url = import.meta.env.DEV ? '/data/years.json' : YEARS_MANIFEST_PATH;
```

**Step 3: Run dev server smoke test**

Run: `cd frontend && npm run dev`
Visit http://localhost:3000 — verify the year selector appears and works.

**Step 4: Commit**

```bash
git add frontend/public/data/years.json frontend/src/hooks/useAvailableYears.ts
git commit -m "feat: add dev-mode years manifest for local development"
```

---

## Task 14: Run full validation and final checks

**Step 1: Run all frontend tests**

Run: `cd frontend && npx vitest run`
Expected: All tests PASS

**Step 2: Run frontend validation**

Run: `cd frontend && npm run validate`
Expected: PASS (type-check + lint)

**Step 3: Run frontend build**

Run: `cd frontend && npm run build`
Expected: PASS

**Step 4: Run backend tests**

Run: `cd backend && npm test`
Expected: PASS

**Step 5: Verify dev server**

Run: `cd frontend && npm run dev`
Verify:
- Year dropdown appears in header
- Clicking dropdown shows available years
- Selecting a different year updates the URL
- Events load for the selected year
- Countdown banner only shows for default year
- Filters reset appropriately on year change
- Page title updates

**Step 6: Final commit if any fixes needed**

If any fixes were required, commit them with appropriate messages.

---

## Summary of All Files Changed

### Frontend — New Files
- `frontend/src/hooks/useAvailableYears.ts`
- `frontend/src/hooks/useSelectedYear.ts`
- `frontend/src/components/layout/YearSelector.tsx`
- `frontend/src/__tests__/lib/constants.test.ts`
- `frontend/src/__tests__/hooks/useAvailableYears.test.ts`
- `frontend/src/__tests__/hooks/useSelectedYear.test.ts`
- `frontend/src/__tests__/components/layout/YearSelector.test.tsx`
- `frontend/public/data/years.json`

### Frontend — Modified Files
- `frontend/src/lib/constants.ts` — `getDefaultYear()` replaces `ACTIVE_YEAR = 2026`
- `frontend/src/hooks/useEventData.ts` — accepts `year` param, year-specific cache keys
- `frontend/src/hooks/useFilterState.ts` — `RECONCILE_FILTERS` action
- `frontend/src/components/layout/Header.tsx` — accepts year props, uses `YearSelector`
- `frontend/src/app/page.tsx` — orchestrates year hooks and passes year to children
- `frontend/index.html` — removes hardcoded "2026"
- `frontend/public/manifest.json` — removes hardcoded "2026"

### Backend — Modified Files
- `backend/src/handlers/syncHandler.ts` — tiered scheduling logic, runtime year computation
- `backend/src/services/eventsCalendarDataSyncService.ts` — `syncNearTerm()`, `syncDistantFuture()`, `generateYearsManifest()`
- `backend/src/services/multiLayerCacheService.ts` — `getS3Client()` public getter

### Infrastructure — Modified Files
- `infrastructure/sync.tf` — hourly EventBridge rule, remove `ACTIVE_YEAR` env var
