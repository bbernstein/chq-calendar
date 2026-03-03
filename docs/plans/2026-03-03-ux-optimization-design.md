# UX Optimization Design

**Date**: 2026-03-03
**Goal**: Optimize the CHQ Calendar UI for mobile-first phone usage while maintaining desktop quality. Minimize touches and scrolls for all common tasks.

## Design Principles

1. **Now-first**: The default view shows what's happening now and today
2. **One-tap actions**: Favorite and calendar export require a single tap
3. **Full-day integrity**: Never show partial days — always complete day boundaries
4. **Filter composition**: All filters combine (favorites + week + location + category)
5. **No login required**: All user state persists in localStorage
6. **Compact cards**: Action buttons add zero vertical height to event cards

---

## Feature 1: Smart "Now" Default View

### Current Behavior
The "Now" button (`dateFilter: 'next'`) shows events from 1 hour ago through 6 days in the future. This shows too many events and doesn't prioritize what's happening right now.

### New Behavior
- **Start**: 1 hour ago (to include in-progress events)
- **End**: Expand day-by-day until at least 50 events are accumulated
- **Always show full days** — never cut off in the middle of a day
- **"Show next day" button** at the bottom of the event list: "Show next day (Thursday, Jul 2)" to extend the window by one more day
- **Off-season**: Same algorithm — expands forward day-by-day until 50+ events, which will reach into the future season

### Off-Season Countdown Banner
A small banner below the header when outside the season:
```
Season starts Saturday, June 27 — 116 days away
```
- Only visible before Week 1 start date
- Subtle styling, not dismissible (small enough to not intrude)
- Disappears automatically once the season begins

### Implementation
- **`dateHelpers.ts`**: New `getAdaptiveEndDate(events, startDate, minEvents)` function that finds the end-of-day boundary needed to include at least `minEvents` events
- **`filterHelpers.ts`**: Use adaptive end date for `'next'` filter
- **`EventList.tsx`**: Add "Show next day" button at bottom when in `'next'` mode
- **`Header.tsx` or new `CountdownBanner.tsx`**: Countdown display

---

## Feature 2: Favorites System

### Storage
- **localStorage key**: `chq-calendar-favorites`
- **Format**: `{ eventIds: string[], lastSaved: number }`
- **Expiry**: 30 days (same as other state)
- **Separate from filter state** — clearing filters does NOT clear favorites

### Hook: `useFavorites.ts`
```typescript
interface UseFavorites {
  favoriteIds: Set<string>;
  isFavorite: (eventId: string) => boolean;
  toggleFavorite: (eventId: string) => void;
  favoriteCount: number;
}
```
- Persists to localStorage on every change
- Restores from localStorage on mount
- Provides O(1) lookup via Set

### Event Card Integration
Star icon on the time/location row, right-aligned alongside calendar icon:
```
🕐 10:45 AM  📍 Amphitheatre       ☆ 📅
Morning Lecture
▶ Show more
👤 Dr. Smith
```
- **Unfavorited**: Outlined star (☆), subtle gray color
- **Favorited**: Filled star (★), blue/gold color
- **Tap target**: Minimum 44px for mobile accessibility
- **Zero extra vertical space** — icons sit on the existing time/location row

### Favorites Filter
- New toggle button in the date filter row: "★ Favorites (12)"
- Shows count of favorited events
- Combines with all other filters (e.g., favorites + Week 3 + Amphitheatre)
- When no favorites exist, shows "★ 0" dimmed

### Filter State Changes
- New action: `TOGGLE_FAVORITES_ONLY`
- New state field: `showFavoritesOnly: boolean`
- New filter in `filterHelpers.ts`: when enabled, only include events whose ID is in favorites Set
- Persisted to localStorage with other filter state

---

## Feature 3: ICS Calendar Export

### ICS File Generation
Pure client-side, no server needed. Generates RFC 5545 compliant ICS:
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//CHQ Calendar//chqcal.org//EN
BEGIN:VEVENT
DTSTART:20260630T104500
DTEND:20260630T114500
SUMMARY:Morning Lecture
LOCATION:Amphitheatre
DESCRIPTION:Event description here
UID:{event-id}@chqcal.org
BEGIN:VALARM
TRIGGER:-PT30M
ACTION:DISPLAY
DESCRIPTION:Reminder
END:VALARM
END:VEVENT
END:VCALENDAR
```

### Behavior
1. User taps 📅 icon on event card
2. JavaScript generates ICS string from event data
3. Creates Blob with `text/calendar` MIME type
4. Triggers download via programmatic `<a>` click
5. **iOS**: Safari automatically offers "Add to Calendar"
6. **Android**: Opens in default calendar app (usually Google Calendar)
7. **Desktop**: Downloads .ics file, user opens with calendar app

### Reminder
Each exported event includes a 30-minute reminder alarm (VALARM).

### Implementation
- **New file**: `lib/utils/icsHelpers.ts`
  - `generateICS(event: Event): string` — builds ICS string
  - `downloadICS(event: Event): void` — generates and triggers download
- **`EventCard.tsx`**: Calendar icon button calling `downloadICS`

---

## Feature 4: Event Card Layout Changes

### Current Layout
```
🕐 10:45 AM  📍 Amphitheatre              [image]
Morning Lecture 🔗
▶ Show more
👤 Dr. Smith
```

### New Layout
```
🕐 10:45 AM  📍 Amphitheatre  ☆ 📅       [image]
Morning Lecture 🔗
▶ Show more
👤 Dr. Smith
```

### Design Details
- Star and calendar icons placed on the time/location row, right-aligned
- Before the image (if present), after the location text
- Icons are 16-20px, with 44px tap targets (padding)
- Gray when inactive, blue/gold when active (star only)
- No extra vertical space consumed

---

## Files Changed Summary

| File | Change |
|------|--------|
| `lib/utils/dateHelpers.ts` | Add `getAdaptiveEndDate()` function |
| `lib/utils/filterHelpers.ts` | Favorites filter, adaptive Now filter |
| `lib/utils/icsHelpers.ts` | **NEW** — ICS generation and download |
| `hooks/useFavorites.ts` | **NEW** — favorites hook with localStorage |
| `hooks/useFilterState.ts` | Add `showFavoritesOnly` state + action |
| `components/calendar/EventCard.tsx` | Star + calendar icons |
| `components/calendar/EventList.tsx` | "Show next day" button |
| `components/filters/DateFilter.tsx` | Favorites toggle button |
| `components/layout/Header.tsx` | Off-season countdown banner |

## Non-Goals (Future Enhancements)

- Server-side analytics / popularity tracking
- Saved searches
- Event sharing (share links)
- Push notifications
- Multi-event ICS export (bulk download)
