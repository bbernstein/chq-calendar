# UX Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add favorites, ICS calendar export, smart "Now" filter with adaptive day-by-day expansion, and an off-season countdown banner to the CHQ Calendar.

**Architecture:** Evolutionary enhancement of the existing single-page Preact app. New features are additive — new hooks (`useFavorites`), new utility modules (`icsHelpers`), and modifications to existing components (`EventCard`, `EventList`, `DateFilter`, `Header`). All user data stays in localStorage, no backend changes needed.

**Tech Stack:** Preact 10, Vite 7, Tailwind CSS 4, TypeScript 5, Vitest (new — for testing)

**Design doc:** `docs/plans/2026-03-03-ux-optimization-design.md`

---

## Task 0: Set Up Vitest Testing Infrastructure

**Files:**
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/__tests__/setup.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/tsconfig.json`

**Step 1: Install Vitest and testing dependencies**

Run:
```bash
cd frontend && npm install -D vitest jsdom @testing-library/preact @testing-library/jest-dom
```

**Step 2: Create Vitest config**

Create `frontend/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      'react': 'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

**Step 3: Create test setup file**

Create `frontend/src/__tests__/setup.ts`:
```typescript
import '@testing-library/jest-dom';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });
```

**Step 4: Add test scripts to package.json**

Add to `frontend/package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

**Step 5: Add vitest types to tsconfig.json**

Add `"vitest/globals"` to the `compilerOptions.types` array in `frontend/tsconfig.json`. If `types` doesn't exist, add `"compilerOptions": { "types": ["vitest/globals"] }`.

**Step 6: Verify setup with a smoke test**

Create `frontend/src/__tests__/smoke.test.ts`:
```typescript
describe('test setup', () => {
  it('works', () => {
    expect(1 + 1).toBe(2);
  });

  it('has localStorage', () => {
    localStorage.setItem('test', 'value');
    expect(localStorage.getItem('test')).toBe('value');
    localStorage.clear();
  });
});
```

Run: `cd frontend && npx vitest run`
Expected: 2 tests pass

**Step 7: Commit**

```bash
git add frontend/vitest.config.ts frontend/src/__tests__/setup.ts frontend/src/__tests__/smoke.test.ts frontend/package.json frontend/package-lock.json frontend/tsconfig.json
git commit -m "chore: set up Vitest testing infrastructure for frontend"
```

---

## Task 1: ICS Calendar Export Utility

**Files:**
- Create: `frontend/src/lib/utils/icsHelpers.ts`
- Create: `frontend/src/__tests__/lib/utils/icsHelpers.test.ts`

**Step 1: Write the failing tests**

Create `frontend/src/__tests__/lib/utils/icsHelpers.test.ts`:
```typescript
import { generateICS, downloadICS } from '@/lib/utils/icsHelpers';
import type { Event } from '@/lib/types';

const mockEvent: Event = {
  id: 'test-event-123',
  title: 'Morning Lecture',
  description: 'A great lecture about science',
  startDate: '2026-06-30T10:45:00',
  endDate: '2026-06-30T11:45:00',
  location: 'Amphitheatre',
};

const mockEventNoEnd: Event = {
  id: 'test-event-456',
  title: 'Open Session',
  startDate: '2026-07-01T14:00:00',
  endDate: '2026-07-01T14:00:00',
};

const mockEventWithSpecialChars: Event = {
  id: 'test-event-789',
  title: 'Music & Art: A "Creative" Session',
  description: 'Line one\nLine two\nLine three',
  startDate: '2026-07-02T09:00:00',
  endDate: '2026-07-02T10:30:00',
  location: 'Lenna Hall',
};

describe('generateICS', () => {
  it('generates valid ICS with all fields', () => {
    const ics = generateICS(mockEvent);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('SUMMARY:Morning Lecture');
    expect(ics).toContain('LOCATION:Amphitheatre');
    expect(ics).toContain('DESCRIPTION:A great lecture about science');
    expect(ics).toContain('UID:test-event-123@chqcal.org');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('formats dates as ICS DTSTART/DTEND', () => {
    const ics = generateICS(mockEvent);
    expect(ics).toContain('DTSTART:20260630T104500');
    expect(ics).toContain('DTEND:20260630T114500');
  });

  it('defaults end time to start + 1 hour when start equals end', () => {
    const ics = generateICS(mockEventNoEnd);
    expect(ics).toContain('DTSTART:20260701T140000');
    expect(ics).toContain('DTEND:20260701T150000');
  });

  it('includes 30-minute reminder alarm', () => {
    const ics = generateICS(mockEvent);
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER:-PT30M');
    expect(ics).toContain('ACTION:DISPLAY');
    expect(ics).toContain('END:VALARM');
  });

  it('escapes special characters in text fields', () => {
    const ics = generateICS(mockEventWithSpecialChars);
    expect(ics).toContain('SUMMARY:Music & Art: A "Creative" Session');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two\\nLine three');
  });

  it('omits LOCATION when not provided', () => {
    const ics = generateICS(mockEventNoEnd);
    expect(ics).not.toContain('LOCATION:');
  });

  it('omits DESCRIPTION when not provided', () => {
    const ics = generateICS(mockEventNoEnd);
    expect(ics).not.toContain('DESCRIPTION:');
  });

  it('uses CRLF line endings per RFC 5545', () => {
    const ics = generateICS(mockEvent);
    expect(ics).toContain('\r\n');
    // Should not have bare LF (except inside escaped content)
    const lines = ics.split('\r\n');
    lines.forEach(line => {
      expect(line).not.toContain('\n');
    });
  });
});

describe('downloadICS', () => {
  it('creates and clicks an anchor element', () => {
    const createElementSpy = vi.spyOn(document, 'createElement');
    const createObjectURLSpy = vi.fn(() => 'blob:test');
    const revokeObjectURLSpy = vi.fn();
    globalThis.URL.createObjectURL = createObjectURLSpy;
    globalThis.URL.revokeObjectURL = revokeObjectURLSpy;

    const clickSpy = vi.fn();
    createElementSpy.mockReturnValue({
      href: '',
      download: '',
      click: clickSpy,
      style: {},
    } as unknown as HTMLAnchorElement);

    downloadICS(mockEvent);

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalled();

    createElementSpy.mockRestore();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/icsHelpers.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `frontend/src/lib/utils/icsHelpers.ts`:
```typescript
import type { Event } from '@/lib/types';

function formatICSDate(dateString: string): string {
  const d = new Date(dateString);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export function generateICS(event: Event): string {
  const startDate = formatICSDate(event.startDate);

  // If endDate equals startDate, default to start + 1 hour
  let endDate: string;
  if (event.endDate && event.endDate !== event.startDate) {
    endDate = formatICSDate(event.endDate);
  } else {
    const end = new Date(event.startDate);
    end.setHours(end.getHours() + 1);
    endDate = formatICSDate(end.toISOString());
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CHQ Calendar//chqcal.org//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `DTSTART:${startDate}`,
    `DTEND:${endDate}`,
    `SUMMARY:${escapeICSText(event.title)}`,
    `UID:${event.id}@chqcal.org`,
  ];

  if (event.location) {
    lines.push(`LOCATION:${escapeICSText(event.location)}`);
  }

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeICSText(event.description)}`);
  }

  // 30-minute reminder
  lines.push(
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'END:VALARM',
  );

  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.join('\r\n');
}

export function downloadICS(event: Event): void {
  const ics = generateICS(event);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${event.title.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}
```

**Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/icsHelpers.test.ts`
Expected: All tests pass

**Step 5: Run full validation**

Run: `cd frontend && npm run validate`
Expected: No type errors, no lint errors

**Step 6: Commit**

```bash
git add frontend/src/lib/utils/icsHelpers.ts frontend/src/__tests__/lib/utils/icsHelpers.test.ts
git commit -m "feat: add ICS calendar export utility with tests"
```

---

## Task 2: Favorites Hook

**Files:**
- Create: `frontend/src/hooks/useFavorites.ts`
- Create: `frontend/src/__tests__/hooks/useFavorites.test.ts`

**Step 1: Write the failing tests**

Create `frontend/src/__tests__/hooks/useFavorites.test.ts`:
```typescript
import { renderHook, act } from '@testing-library/preact';
import { useFavorites } from '@/hooks/useFavorites';

describe('useFavorites', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with empty favorites', () => {
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favoriteCount).toBe(0);
    expect(result.current.isFavorite('any-id')).toBe(false);
  });

  it('toggles a favorite on', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => { result.current.toggleFavorite('event-1'); });
    expect(result.current.isFavorite('event-1')).toBe(true);
    expect(result.current.favoriteCount).toBe(1);
  });

  it('toggles a favorite off', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => { result.current.toggleFavorite('event-1'); });
    act(() => { result.current.toggleFavorite('event-1'); });
    expect(result.current.isFavorite('event-1')).toBe(false);
    expect(result.current.favoriteCount).toBe(0);
  });

  it('handles multiple favorites', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => { result.current.toggleFavorite('event-1'); });
    act(() => { result.current.toggleFavorite('event-2'); });
    act(() => { result.current.toggleFavorite('event-3'); });
    expect(result.current.favoriteCount).toBe(3);
    expect(result.current.isFavorite('event-1')).toBe(true);
    expect(result.current.isFavorite('event-2')).toBe(true);
    expect(result.current.isFavorite('event-3')).toBe(true);
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => { result.current.toggleFavorite('event-1'); });
    const stored = JSON.parse(localStorage.getItem('chq-calendar-favorites') || '{}');
    expect(stored.eventIds).toContain('event-1');
    expect(stored.lastSaved).toBeDefined();
  });

  it('restores from localStorage on mount', () => {
    localStorage.setItem('chq-calendar-favorites', JSON.stringify({
      eventIds: ['event-a', 'event-b'],
      lastSaved: Date.now(),
    }));
    const { result } = renderHook(() => useFavorites());
    expect(result.current.isFavorite('event-a')).toBe(true);
    expect(result.current.isFavorite('event-b')).toBe(true);
    expect(result.current.favoriteCount).toBe(2);
  });

  it('ignores expired localStorage data', () => {
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    localStorage.setItem('chq-calendar-favorites', JSON.stringify({
      eventIds: ['old-event'],
      lastSaved: thirtyOneDaysAgo,
    }));
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favoriteCount).toBe(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/hooks/useFavorites.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `frontend/src/hooks/useFavorites.ts`:
```typescript
import { useState, useCallback, useEffect } from 'react';
import { USER_STATE_EXPIRY_MS } from '@/lib/constants';

const STORAGE_KEY = 'chq-calendar-favorites';

interface StoredFavorites {
  eventIds: string[];
  lastSaved: number;
}

export function useFavorites() {
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: StoredFavorites = JSON.parse(stored);
        if (parsed.lastSaved && Date.now() - parsed.lastSaved < USER_STATE_EXPIRY_MS) {
          return new Set(parsed.eventIds);
        }
      }
    } catch (e) {
      console.warn('Failed to load favorites:', e);
    }
    return new Set();
  });

  // Persist to localStorage on change
  useEffect(() => {
    try {
      const data: StoredFavorites = {
        eventIds: Array.from(favoriteIds),
        lastSaved: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save favorites:', e);
    }
  }, [favoriteIds]);

  const isFavorite = useCallback(
    (eventId: string) => favoriteIds.has(eventId),
    [favoriteIds]
  );

  const toggleFavorite = useCallback((eventId: string) => {
    setFavoriteIds(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }, []);

  return {
    favoriteIds,
    isFavorite,
    toggleFavorite,
    favoriteCount: favoriteIds.size,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/hooks/useFavorites.test.ts`
Expected: All tests pass

**Step 5: Run full validation**

Run: `cd frontend && npm run validate`
Expected: No errors

**Step 6: Commit**

```bash
git add frontend/src/hooks/useFavorites.ts frontend/src/__tests__/hooks/useFavorites.test.ts
git commit -m "feat: add useFavorites hook with localStorage persistence"
```

---

## Task 3: Smart "Now" — Adaptive Date Filter

**Files:**
- Modify: `frontend/src/lib/utils/dateHelpers.ts`
- Modify: `frontend/src/lib/utils/filterHelpers.ts`
- Create: `frontend/src/__tests__/lib/utils/dateHelpers.test.ts`

**Step 1: Write the failing tests for the adaptive end date function**

Create `frontend/src/__tests__/lib/utils/dateHelpers.test.ts`:
```typescript
import { getAdaptiveEndDate, getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import type { Event } from '@/lib/types';

function makeEvent(dateStr: string): Event {
  return {
    id: `event-${dateStr}`,
    title: `Event on ${dateStr}`,
    startDate: dateStr,
    endDate: dateStr,
  };
}

describe('getAdaptiveEndDate', () => {
  // Create events across multiple days
  const events: Event[] = [
    // Day 1: 10 events
    ...Array.from({ length: 10 }, (_, i) =>
      makeEvent(`2026-06-30T${String(8 + i).padStart(2, '0')}:00:00`)
    ),
    // Day 2: 15 events
    ...Array.from({ length: 15 }, (_, i) =>
      makeEvent(`2026-07-01T${String(7 + i).padStart(2, '0')}:00:00`)
    ),
    // Day 3: 20 events
    ...Array.from({ length: 20 }, (_, i) =>
      makeEvent(`2026-07-02T${String(6 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}:00`)
    ),
    // Day 4: 15 events
    ...Array.from({ length: 15 }, (_, i) =>
      makeEvent(`2026-07-03T${String(8 + i).padStart(2, '0')}:00:00`)
    ),
  ];

  it('expands day-by-day until minEvents is met', () => {
    const startDate = new Date('2026-06-30T07:00:00');
    const endDate = getAdaptiveEndDate(events, startDate, 20);
    // Day 1 has 10, Day 2 has 15 → need 2 full days (25 events >= 20)
    expect(endDate.getDate()).toBe(2); // End of Jul 1 → start of Jul 2
  });

  it('includes the full last day even if it exceeds minEvents', () => {
    const startDate = new Date('2026-06-30T07:00:00');
    const endDate = getAdaptiveEndDate(events, startDate, 5);
    // Day 1 has 10 events, which is >= 5. End should be end of Day 1
    expect(endDate.getDate()).toBe(1); // End of Jun 30 → start of Jul 1
  });

  it('returns far future if not enough events exist', () => {
    const startDate = new Date('2026-06-30T07:00:00');
    const endDate = getAdaptiveEndDate(events, startDate, 1000);
    // Not enough events, should return end of last event's day + generous buffer
    expect(endDate.getFullYear()).toBe(2026);
  });

  it('handles empty events array', () => {
    const startDate = new Date('2026-06-30T07:00:00');
    const endDate = getAdaptiveEndDate([], startDate, 50);
    // Should return a far future date
    expect(endDate > startDate).toBe(true);
  });
});

describe('getChautauquaSeasonWeeks', () => {
  it('generates 9 weeks for 2026', () => {
    const weeks = getChautauquaSeasonWeeks(2026);
    expect(weeks).toHaveLength(9);
    expect(weeks[0].number).toBe(1);
    expect(weeks[8].number).toBe(9);
  });

  it('each week is 7 days long', () => {
    const weeks = getChautauquaSeasonWeeks(2026);
    weeks.forEach(week => {
      const diff = week.end.getTime() - week.start.getTime();
      expect(diff).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/dateHelpers.test.ts`
Expected: FAIL — `getAdaptiveEndDate` not found

**Step 3: Add `getAdaptiveEndDate` to dateHelpers.ts**

Add to `frontend/src/lib/utils/dateHelpers.ts`:
```typescript
/**
 * Finds the end-of-day boundary needed to include at least `minEvents` events
 * starting from `startDate`. Always returns a full day boundary (end of day 23:59:59.999).
 */
export function getAdaptiveEndDate(events: Event[], startDate: Date, minEvents: number): Date {
  // Filter events on or after startDate and sort by date
  const futureEvents = events
    .filter(e => new Date(e.startDate) >= startDate)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  if (futureEvents.length === 0) {
    // No events — return 90 days from now as fallback
    const fallback = new Date(startDate);
    fallback.setDate(fallback.getDate() + 90);
    return fallback;
  }

  // Accumulate events day by day
  let accumulated = 0;
  let currentDayStr = '';

  for (const event of futureEvents) {
    const eventDate = new Date(event.startDate);
    const dayStr = eventDate.toDateString();

    if (dayStr !== currentDayStr) {
      // New day — check if we already have enough from previous days
      if (accumulated >= minEvents && currentDayStr !== '') {
        // We have enough events, return end of the previous day
        break;
      }
      currentDayStr = dayStr;
    }
    accumulated++;
  }

  // Return end of the current day (23:59:59.999)
  const lastDay = new Date(currentDayStr || futureEvents[futureEvents.length - 1].startDate);
  lastDay.setHours(23, 59, 59, 999);

  // If we still don't have enough, extend to last event's day
  if (accumulated < minEvents) {
    const lastEventDay = new Date(futureEvents[futureEvents.length - 1].startDate);
    lastEventDay.setHours(23, 59, 59, 999);
    return lastEventDay;
  }

  return lastDay;
}
```

Also add the import at the top of `dateHelpers.ts`:
```typescript
import type { Event, SeasonWeek } from '@/lib/types';
```
(Note: `SeasonWeek` is already imported, just add `Event`.)

**Step 4: Update filterHelpers.ts to use adaptive filtering**

Modify `frontend/src/lib/utils/filterHelpers.ts`:

Add `events` parameter access and change the `'next'` filter:
```typescript
export interface FilterOptions {
  searchTerm: string;
  dateFilter: 'all' | 'today' | 'next' | 'this-week';
  selectedWeeks: number[];
  selectedTagsLowerSet: Set<string>;
  selectedLocationsLowerSet: Set<string>;
  seasonWeeks: SeasonWeek[];
  currentWeekNumber: number | null;
  showFavoritesOnly?: boolean;
  favoriteIds?: Set<string>;
  adaptiveEndDate?: Date; // Pre-computed by the component
}
```

Change the `'next'` filter block from:
```typescript
} else if (options.dateFilter === 'next') {
    filtered = filtered.filter(event => isNext(event.startDate));
```
To:
```typescript
} else if (options.dateFilter === 'next') {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const endDate = options.adaptiveEndDate || new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
    filtered = filtered.filter(event => {
      const eventDate = new Date(event.startDate);
      return eventDate >= oneHourAgo && eventDate <= endDate;
    });
```

Add favorites filter after the tag filter block:
```typescript
  // Favorites filter
  if (options.showFavoritesOnly && options.favoriteIds && options.favoriteIds.size > 0) {
    filtered = filtered.filter(event => options.favoriteIds!.has(event.id));
  }
```

**Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/dateHelpers.test.ts`
Expected: All tests pass

**Step 6: Run full validation**

Run: `cd frontend && npm run validate`
Expected: No errors

**Step 7: Commit**

```bash
git add frontend/src/lib/utils/dateHelpers.ts frontend/src/lib/utils/filterHelpers.ts frontend/src/__tests__/lib/utils/dateHelpers.test.ts
git commit -m "feat: add adaptive 'Now' filter with full-day expansion"
```

---

## Task 4: Add Favorites Toggle to Filter State

**Files:**
- Modify: `frontend/src/hooks/useFilterState.ts`

**Step 1: Add `showFavoritesOnly` to FilterState interface**

Add to the `FilterState` interface in `useFilterState.ts`:
```typescript
showFavoritesOnly: boolean;
```

**Step 2: Add the TOGGLE_FAVORITES_ONLY action**

Add to `FilterAction` type:
```typescript
| { type: 'TOGGLE_FAVORITES_ONLY' }
```

**Step 3: Handle in reducer**

Add case in `filterReducer`:
```typescript
case 'TOGGLE_FAVORITES_ONLY':
  return { ...state, showFavoritesOnly: !state.showFavoritesOnly };
```

**Step 4: Update initialState**

Add:
```typescript
showFavoritesOnly: false,
```

**Step 5: Update CLEAR_FILTERS to reset favorites filter**

Change the `CLEAR_FILTERS` case to include:
```typescript
case 'CLEAR_FILTERS':
  return { ...state, searchTerm: '', selectedTags: [], selectedLocations: [], dateFilter: 'all', selectedWeeks: [], showFavoritesOnly: false };
```

**Step 6: Add action creator and expose in return**

Add:
```typescript
const toggleFavoritesOnly = useCallback(() => dispatch({ type: 'TOGGLE_FAVORITES_ONLY' }), []);
```

Add to localStorage persistence (save) — include `showFavoritesOnly: state.showFavoritesOnly` in the saved object.

Add to localStorage restore — include `showFavoritesOnly: parsed.showFavoritesOnly || false` in the loaded payload.

Update `hasFilters` to include `state.showFavoritesOnly`.

Add to return object:
```typescript
showFavoritesOnly: state.showFavoritesOnly, toggleFavoritesOnly,
```

**Step 7: Run full validation**

Run: `cd frontend && npm run validate`
Expected: No errors

**Step 8: Commit**

```bash
git add frontend/src/hooks/useFilterState.ts
git commit -m "feat: add showFavoritesOnly toggle to filter state"
```

---

## Task 5: EventCard — Add Favorite Star and Calendar Icon

**Files:**
- Modify: `frontend/src/components/calendar/EventCard.tsx`

**Step 1: Update EventCardProps interface**

Add these props:
```typescript
isFavorite: boolean;
onToggleFavorite: (eventId: string) => void;
onDownloadICS: (event: Event) => void;
```

**Step 2: Add star and calendar icons to the time/location row**

In the time/location `<div>` (the first child div with `text-xs sm:text-sm text-gray-500`), wrap the content in a flex container and add the action buttons:

Replace the current time/location div:
```tsx
<div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-1">
```

With:
```tsx
<div className="flex items-center justify-between text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-1">
  <span>
    🕐 {new Date(event.startDate).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })}
    {event.location && (
      <span className="ml-2">📍 {event.location}</span>
    )}
  </span>
  <span className="flex items-center gap-1 flex-shrink-0 ml-2">
    <button
      onClick={(e) => { e.stopPropagation(); onToggleFavorite(event.id); }}
      className={`p-1.5 rounded-full transition-colors ${
        isFavorite
          ? 'text-yellow-500 hover:text-yellow-600'
          : 'text-gray-300 dark:text-gray-600 hover:text-yellow-400'
      }`}
      title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
    >
      <svg className="w-4 h-4 sm:w-5 sm:h-5" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    </button>
    <button
      onClick={(e) => { e.stopPropagation(); onDownloadICS(event); }}
      className="p-1.5 rounded-full text-gray-300 dark:text-gray-600 hover:text-blue-500 transition-colors"
      title="Add to calendar"
      aria-label="Add to calendar"
    >
      <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    </button>
  </span>
</div>
```

**Step 3: Run full validation**

Run: `cd frontend && npm run validate`
Expected: Type errors about missing props in EventList.tsx (expected — we'll fix in next task)

**Step 4: Commit**

```bash
git add frontend/src/components/calendar/EventCard.tsx
git commit -m "feat: add favorite star and calendar icons to EventCard"
```

---

## Task 6: Wire Everything Together in page.tsx and EventList.tsx

**Files:**
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/components/calendar/EventList.tsx`
- Modify: `frontend/src/components/filters/DateFilter.tsx`

**Step 1: Update page.tsx to use favorites and adaptive Now**

Import new modules:
```typescript
import { useFavorites } from '@/hooks/useFavorites';
import { getAdaptiveEndDate } from '@/lib/utils/dateHelpers';
```

In `HomeContent`, add:
```typescript
const favorites = useFavorites();
```

Update `filterOpts` to include favorites and adaptive end date:
```typescript
const adaptiveEndDate = useMemo(() => {
  if (filters.dateFilter !== 'next' || !events.length) return undefined;
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  return getAdaptiveEndDate(events, oneHourAgo, 50);
}, [filters.dateFilter, events]);

const filterOpts: FilterOptions = useMemo(() => ({
  searchTerm: debouncedSearch, dateFilter: filters.dateFilter, selectedWeeks: filters.selectedWeeks,
  selectedTagsLowerSet: filters.selectedTagsLowerSet, selectedLocationsLowerSet: filters.selectedLocationsLowerSet,
  seasonWeeks, currentWeekNumber,
  showFavoritesOnly: filters.showFavoritesOnly,
  favoriteIds: favorites.favoriteIds,
  adaptiveEndDate,
}), [debouncedSearch, filters.dateFilter, filters.selectedWeeks, filters.selectedTagsLowerSet, filters.selectedLocationsLowerSet, seasonWeeks, currentWeekNumber, filters.showFavoritesOnly, favorites.favoriteIds, adaptiveEndDate]);
```

Pass favorites and ICS props to EventList:
```tsx
<EventList
  groupedEvents={groupedEvents}
  expandedDescriptions={filters.expandedDescriptions}
  onToggleDescription={filters.toggleDescription}
  onToggleTag={filters.toggleTag}
  isTagSelected={filters.isTagSelected}
  favoriteIds={favorites.favoriteIds}
  onToggleFavorite={favorites.toggleFavorite}
  dateFilter={filters.dateFilter}
  allEvents={events}
  adaptiveEndDate={adaptiveEndDate}
  seasonWeeks={seasonWeeks}
/>
```

Pass favorites props to DateFilter:
```tsx
<DateFilter
  dateFilter={filters.dateFilter} setDateFilter={filters.setDateFilter}
  selectedWeeks={filters.selectedWeeks} setSelectedWeeks={filters.setSelectedWeeks}
  currentWeekNumber={currentWeekNumber} seasonWeeks={seasonWeeks}
  isThisWeekButtonActive={isThisWeekActive} weekDrag={weekDrag}
  isWeekHighlighted={isWeekHighlighted}
  showFavoritesOnly={filters.showFavoritesOnly}
  onToggleFavoritesOnly={filters.toggleFavoritesOnly}
  favoriteCount={favorites.favoriteCount}
/>
```

**Step 2: Update EventList.tsx**

Add imports:
```typescript
import { downloadICS } from '@/lib/utils/icsHelpers';
import { getAdaptiveEndDate } from '@/lib/utils/dateHelpers';
import type { SeasonWeek } from '@/lib/types';
```

Update `EventListProps`:
```typescript
interface EventListProps {
  groupedEvents: DayGroup[];
  expandedDescriptions: Set<string>;
  onToggleDescription: (eventId: string) => void;
  onToggleTag: (tag: string) => void;
  isTagSelected: (tag: string) => boolean;
  favoriteIds: Set<string>;
  onToggleFavorite: (eventId: string) => void;
  dateFilter: string;
  allEvents: Event[];
  adaptiveEndDate?: Date;
  seasonWeeks: SeasonWeek[];
}
```

Update EventCard rendering to pass new props:
```tsx
<EventCard
  key={event.id}
  event={event}
  index={index}
  isExpanded={expandedDescriptions.has(event.id)}
  onToggleDescription={onToggleDescription}
  onToggleTag={onToggleTag}
  isTagSelected={isTagSelected}
  isFavorite={favoriteIds.has(event.id)}
  onToggleFavorite={onToggleFavorite}
  onDownloadICS={downloadICS}
/>
```

Add "Show next day" button after the event list when `dateFilter === 'next'`:

After the sentinel div, add:
```tsx
{dateFilter === 'next' && visibleCount >= totalEvents && adaptiveEndDate && (
  <div className="text-center py-4">
    <button
      onClick={() => {
        // This will be handled by extending the adaptive end date
        // For now, we signal the parent to add one more day
        const nextDay = new Date(adaptiveEndDate);
        nextDay.setDate(nextDay.getDate() + 1);
        nextDay.setHours(23, 59, 59, 999);
        // We need a callback for this — see step 3
      }}
      className="px-4 py-2 text-sm bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400 rounded-md hover:bg-blue-100 dark:hover:bg-gray-600 transition-colors"
    >
      Show next day
    </button>
  </div>
)}
```

**Step 3: Add "Show next day" mechanism**

For the "Show next day" button, add an `extraDays` state to `useFilterState`:
- New state field: `extraDays: number` (default 0)
- New action: `ADD_EXTRA_DAY` — increments `extraDays` by 1
- Reset `extraDays` to 0 when `dateFilter` changes
- In `page.tsx`, pass `extraDays` to `getAdaptiveEndDate` call: `getAdaptiveEndDate(events, oneHourAgo, 50 + extraDays * 20)` — or simpler, after computing the adaptive end date, add `extraDays` full days to it.

Update `page.tsx` adaptive end date computation:
```typescript
const adaptiveEndDate = useMemo(() => {
  if (filters.dateFilter !== 'next' || !events.length) return undefined;
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const baseEnd = getAdaptiveEndDate(events, oneHourAgo, 50);
  if (filters.extraDays > 0) {
    baseEnd.setDate(baseEnd.getDate() + filters.extraDays);
    baseEnd.setHours(23, 59, 59, 999);
  }
  return baseEnd;
}, [filters.dateFilter, events, filters.extraDays]);
```

Pass `onShowNextDay` to EventList:
```tsx
onShowNextDay={filters.addExtraDay}
```

In EventList, call `onShowNextDay()` from the button click handler.

**Step 4: Update DateFilter.tsx to include favorites toggle**

Add props:
```typescript
showFavoritesOnly: boolean;
onToggleFavoritesOnly: () => void;
favoriteCount: number;
```

Add the favorites button in the button row, after "This Week":
```tsx
<DateFilterButton
  label={`★ ${favoriteCount}`}
  title={favoriteCount > 0 ? 'Show favorited events only' : 'No favorites saved yet'}
  isActive={showFavoritesOnly}
  onClick={onToggleFavoritesOnly}
/>
```

**Step 5: Run full validation**

Run: `cd frontend && npm run validate && npm run build`
Expected: No errors, build succeeds

**Step 6: Commit**

```bash
git add frontend/src/app/page.tsx frontend/src/components/calendar/EventList.tsx frontend/src/components/filters/DateFilter.tsx frontend/src/hooks/useFilterState.ts
git commit -m "feat: wire favorites, ICS export, and adaptive Now into main app"
```

---

## Task 7: Off-Season Countdown Banner

**Files:**
- Create: `frontend/src/components/layout/CountdownBanner.tsx`
- Modify: `frontend/src/app/page.tsx`

**Step 1: Create the CountdownBanner component**

Create `frontend/src/components/layout/CountdownBanner.tsx`:
```tsx
import { useMemo } from 'react';
import type { SeasonWeek } from '@/lib/types';

interface CountdownBannerProps {
  seasonWeeks: SeasonWeek[];
}

export function CountdownBanner({ seasonWeeks }: CountdownBannerProps) {
  const daysUntilSeason = useMemo(() => {
    if (seasonWeeks.length === 0) return null;
    const seasonStart = seasonWeeks[0].start;
    const now = new Date();
    if (now >= seasonStart) return null; // Season has started
    const diffMs = seasonStart.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }, [seasonWeeks]);

  if (daysUntilSeason === null) return null;

  const seasonStart = seasonWeeks[0].start;
  const dateStr = seasonStart.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="bg-blue-50 dark:bg-blue-900/30 border-b border-blue-100 dark:border-blue-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 text-center text-sm text-blue-700 dark:text-blue-300">
        Season starts {dateStr} — {daysUntilSeason} {daysUntilSeason === 1 ? 'day' : 'days'} away
      </div>
    </div>
  );
}
```

**Step 2: Add to page.tsx**

Import:
```typescript
import { CountdownBanner } from '@/components/layout/CountdownBanner';
```

Place between `<Header />` and `<main>`:
```tsx
<Header />
<CountdownBanner seasonWeeks={seasonWeeks} />
<main ...>
```

**Step 3: Run full validation and build**

Run: `cd frontend && npm run validate && npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/components/layout/CountdownBanner.tsx frontend/src/app/page.tsx
git commit -m "feat: add off-season countdown banner"
```

---

## Task 8: Final Integration Testing and Cleanup

**Step 1: Run all tests**

Run: `cd frontend && npx vitest run`
Expected: All tests pass

**Step 2: Run full build**

Run: `cd frontend && npm run build`
Expected: Build succeeds

**Step 3: Manual smoke test checklist**

Run: `cd frontend && npm run dev`

Test in browser:
- [ ] App loads, shows events (or countdown + future events if off-season)
- [ ] Star icon visible on every event card
- [ ] Tapping star toggles yellow fill, persists on page reload
- [ ] Calendar icon visible, tapping downloads .ics file
- [ ] .ics file opens in calendar app
- [ ] "★ 0" button visible in filter row
- [ ] After starring events, "★ N" shows correct count
- [ ] Toggling favorites filter shows only starred events
- [ ] Favorites filter combines with other filters (week, location, category)
- [ ] "Now" shows events starting from ~1 hour ago through enough full days
- [ ] "Show next day" button appears at bottom of Now view
- [ ] Clicking "Show next day" adds another day of events
- [ ] Countdown banner shows when off-season, hidden during season
- [ ] Dark mode works for all new UI elements
- [ ] Mobile: icons have adequate tap targets (no mis-taps)
- [ ] Mobile: card layout doesn't add extra height

**Step 4: Clean up smoke test**

Remove `frontend/src/__tests__/smoke.test.ts` (no longer needed).

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and integration verification"
```

---

## Task Dependency Graph

```
Task 0 (Vitest setup)
  ├── Task 1 (ICS helpers) — independent
  ├── Task 2 (Favorites hook) — independent
  └── Task 3 (Adaptive Now) — independent
        │
Task 4 (Filter state changes) — depends on Task 2 design
        │
Task 5 (EventCard UI) — depends on Tasks 1, 2
        │
Task 6 (Wire together) — depends on Tasks 1-5
        │
Task 7 (Countdown banner) — independent of 1-6, but do after 6
        │
Task 8 (Integration test) — depends on all
```

**Parallelizable tasks:** After Task 0, Tasks 1, 2, and 3 can all run in parallel.
