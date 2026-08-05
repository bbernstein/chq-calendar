# Shared Links Source of Truth + Chautauqua Fund Link (Issue #169) — Design & Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Approved 2026-08-05 (design decisions confirmed by user: shared JSON + iOS consistency test; link title "Chautauqua Fund").

**Goal:** Add a "Chautauqua Fund" link (https://giving.chq.org/) to the web header and iOS More menu, and refactor so both platforms' quick links come from one shared file that cannot silently drift.

**Architecture:** A new `shared/links.json` at the repo root is the single source of truth. The web imports it at build time and renders the header link buttons by mapping over it. iOS keeps its typed `AboutInfo.quickLinks` (SwiftUI wants `URL`s; bundling repo-root files into the app target is not worth the xcodeproj complexity), but a unit test reads the shared JSON via `#filePath` and asserts the Swift list matches exactly — the same pattern the repo already uses for the About disclaimer (`appStoreListing.test.ts` vs `listing-fields.json`).

**Tech Stack:** Vite/Preact/TypeScript (web), Swift 6 / Swift Testing (iOS), vitest.

## Global Constraints

- Never commit to `main`; work on `feature/169-shared-links`.
- Frontend verification: `cd frontend && npm run build` (runs validate + tests).
- iOS verification: `cd ios && xcodebuild test -scheme ChqCalendar -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max'` (or the simulator available locally).
- New link: id `chautauqua-fund`, title `Chautauqua Fund`, url `https://giving.chq.org/`.
- The web's Feedback link must keep opening the relative path `/feedback` (so local dev stays on localhost); iOS keeps the absolute URL. The JSON carries an optional `webPath` override for this.
- iOS More-menu change is user-visible, but `ios/Scripts/screenshot-plan.json` has no shot covering the More menu, so the PR opts out with `[skip-screenshots: shot plan does not cover the More menu; no covered shot changes]`.

## File Structure

- Create: `shared/links.json` — single source of truth (`quickLinks` array of `{id, title, url, webPath?}`).
- Create: `frontend/src/lib/quickLinks.ts` — typed re-export of the JSON for web consumers.
- Create: `frontend/src/lib/__tests__/quickLinks.test.ts` — shape/content tests.
- Modify: `frontend/vite.config.ts`, `frontend/vitest.config.ts`, `frontend/tsconfig.json` — add `@shared` alias → `../shared`.
- Modify: `frontend/src/components/layout/Header.tsx` — map over `quickLinks` in desktop + mobile nav.
- Modify: `frontend/src/components/layout/__tests__/Header.test.tsx` — data-driven assertions incl. Chautauqua Fund.
- Modify: `ios/ChqCalendar/Features/About/AboutInfo.swift` — add Chautauqua Fund to `quickLinks`.
- Modify: `ios/ChqCalendarTests/AboutInfoTests.swift` — update hardcoded expectations; add JSON consistency test.

---

### Task 1: `shared/links.json` + web typed accessor

**Files:**
- Create: `shared/links.json`
- Create: `frontend/src/lib/quickLinks.ts`
- Test: `frontend/src/lib/__tests__/quickLinks.test.ts`
- Modify: `frontend/vite.config.ts` (resolve.alias), `frontend/vitest.config.ts` (resolve.alias), `frontend/tsconfig.json` (paths)

**Interfaces:**
- Produces: `quickLinks: QuickLink[]` from `@/lib/quickLinks`, where `interface QuickLink { id: string; title: string; url: string; webPath?: string }`. Order in the JSON is display order.

- [ ] **Step 1: Create the shared JSON**

```json
{
  "quickLinks": [
    { "id": "feedback", "title": "Feedback", "url": "https://www.chqcal.org/feedback", "webPath": "/feedback" },
    { "id": "programs", "title": "Programs", "url": "https://programs.chq.org/" },
    { "id": "questions", "title": "Questions", "url": "https://questions.chq.org/" },
    { "id": "bus-tram-tracker", "title": "Bus & Tram Tracker", "url": "https://busandtramtracker.chq.org" },
    { "id": "chautauqua-fund", "title": "Chautauqua Fund", "url": "https://giving.chq.org/" }
  ]
}
```

- [ ] **Step 2: Add the `@shared` alias to all three configs**

`frontend/vite.config.ts` and `frontend/vitest.config.ts`, inside the existing `resolve.alias` object:

```ts
'@shared': resolve(__dirname, '../shared'),
```

`frontend/tsconfig.json`, inside `compilerOptions.paths`:

```json
"@shared/*": ["../shared/*"]
```

- [ ] **Step 3: Write the failing test**

`frontend/src/lib/__tests__/quickLinks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { quickLinks } from '@/lib/quickLinks';

describe('quickLinks (shared/links.json)', () => {
  it('includes the Chautauqua Fund link', () => {
    const fund = quickLinks.find((l) => l.id === 'chautauqua-fund');
    expect(fund?.title).toBe('Chautauqua Fund');
    expect(fund?.url).toBe('https://giving.chq.org/');
  });

  it('every link has a non-empty id, title, and absolute https url', () => {
    for (const link of quickLinks) {
      expect(link.id).toMatch(/^[a-z0-9-]+$/);
      expect(link.title.trim().length).toBeGreaterThan(0);
      expect(link.url).toMatch(/^https:\/\//);
    }
  });

  it('feedback keeps its relative webPath for same-site navigation', () => {
    expect(quickLinks.find((l) => l.id === 'feedback')?.webPath).toBe('/feedback');
  });

  it('ids are unique', () => {
    expect(new Set(quickLinks.map((l) => l.id)).size).toBe(quickLinks.length);
  });
});
```

- [ ] **Step 4: Run it — expect FAIL (module not found)**

Run: `cd frontend && npx vitest run src/lib/__tests__/quickLinks.test.ts`

- [ ] **Step 5: Implement `frontend/src/lib/quickLinks.ts`**

```ts
import linksJson from '@shared/links.json';

export interface QuickLink {
  id: string;
  title: string;
  url: string;
  /** Relative path the web app opens instead of `url` (keeps local dev on localhost). */
  webPath?: string;
}

export const quickLinks: QuickLink[] = linksJson.quickLinks;
```

- [ ] **Step 6: Run test — expect PASS**, then `npm run type-check`

- [ ] **Step 7: Commit** — `feat(web): shared links.json as single source for header quick links`

---

### Task 2: Header renders from the shared list

**Files:**
- Modify: `frontend/src/components/layout/Header.tsx`
- Test: `frontend/src/components/layout/__tests__/Header.test.tsx`

**Interfaces:**
- Consumes: `quickLinks`, `QuickLink` from `@/lib/quickLinks` (Task 1).

- [ ] **Step 1: Extend Header tests to be data-driven**

Keep the existing behavioral tests (they pin Questions and Bus & Tram Tracker via `window.open` spies). Add:

```tsx
import { quickLinks } from '@/lib/quickLinks';

it.each(quickLinks)('desktop nav opens $title from shared links.json', (link) => {
  const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  render(<Header selectedYear={2026} availableYears={[2026]} defaultYear={2026} onYearChange={() => {}} />);
  fireEvent.click(screen.getAllByText(link.title)[0]);
  expect(openSpy).toHaveBeenCalledWith(link.webPath ?? link.url, '_blank', 'noopener,noreferrer');
});

it('mobile More menu opens the Chautauqua Fund link', () => {
  const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  render(<Header selectedYear={2026} availableYears={[2026]} defaultYear={2026} onYearChange={() => {}} />);
  fireEvent.click(screen.getByText('More'));
  fireEvent.click(screen.getByText('Chautauqua Fund'));
  expect(openSpy).toHaveBeenCalledWith('https://giving.chq.org/', '_blank', 'noopener,noreferrer');
});
```

(Adapt imports/render helpers to match the existing test file's conventions — read it first.)

- [ ] **Step 2: Run — expect FAIL** (Chautauqua Fund not rendered yet)

- [ ] **Step 3: Refactor Header.tsx**

Replace the four hardcoded desktop `<button>`s with:

```tsx
{quickLinks.map((link) => (
  <button
    key={link.id}
    onClick={() => window.open(link.webPath ?? link.url, '_blank', 'noopener,noreferrer')}
    className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
  >
    {link.title}
  </button>
))}
```

And the four mobile menu `<button>`s with the same map using the mobile classes and `setMenuOpen(false)` after opening. Import `quickLinks` from `@/lib/quickLinks`.

- [ ] **Step 4: Run all Header + quickLinks tests — expect PASS**

- [ ] **Step 5: Full frontend verification** — `cd frontend && npm run build`

- [ ] **Step 6: Commit** — `feat(web): Chautauqua Fund header link; header driven by shared links.json (#169)`

---

### Task 3: iOS — add the link + consistency test against shared JSON

**Files:**
- Modify: `ios/ChqCalendar/Features/About/AboutInfo.swift`
- Test: `ios/ChqCalendarTests/AboutInfoTests.swift`

**Interfaces:**
- Consumes: `shared/links.json` (Task 1) read from the repo checkout via `#filePath`.

- [ ] **Step 1: Update the hardcoded expectations and add the consistency test**

In `AboutInfoTests.swift`, extend `quickLinksMatchTheWebHeader` arrays with `"chautauqua-fund"` / `"Chautauqua Fund"` / `"https://giving.chq.org/"`, and add:

```swift
/// The cross-platform source of truth is shared/links.json (also consumed
/// by the web header). This test reads it from the repo checkout so any
/// drift between the Swift list and the JSON fails CI on either side.
@Test func quickLinksMatchSharedLinksJson() throws {
    struct SharedLinksFile: Decodable {
        struct SharedLink: Decodable {
            let id: String
            let title: String
            let url: String
        }
        let quickLinks: [SharedLink]
    }

    let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // AboutInfoTests.swift
        .deletingLastPathComponent() // ChqCalendarTests
        .deletingLastPathComponent() // ios
    let jsonURL = repoRoot.appendingPathComponent("shared/links.json")
    let data = try Data(contentsOf: jsonURL)
    let shared = try JSONDecoder().decode(SharedLinksFile.self, from: data)

    #expect(AboutInfo.quickLinks.map(\.id) == shared.quickLinks.map(\.id))
    #expect(AboutInfo.quickLinks.map(\.title) == shared.quickLinks.map(\.title))
    #expect(AboutInfo.quickLinks.map { $0.url.absoluteString } == shared.quickLinks.map(\.url))
}
```

- [ ] **Step 2: Run iOS tests — expect the new test and the updated hardcoded test to FAIL** (Swift list lacks the fund link)

- [ ] **Step 3: Add the link to `AboutInfo.quickLinks`**

```swift
Link(id: "chautauqua-fund", title: "Chautauqua Fund", url: URL(string: "https://giving.chq.org/")!),
```

Also update the doc comment on `quickLinks` to name `shared/links.json` as the source of truth.

- [ ] **Step 4: Run iOS tests — expect PASS**

- [ ] **Step 5: Commit** — `feat(ios): Chautauqua Fund quick link + consistency test vs shared/links.json (#169)`

---

### Task 4: Verification + PR

- [ ] Frontend: `cd frontend && npm run build` — green.
- [ ] Backend untouched, but run `cd backend && npm run validate` per repo checklist.
- [ ] iOS: full test suite via xcodebuild — green.
- [ ] Push branch, open PR referencing #169 with `[skip-screenshots: shot plan does not cover the More menu; no covered shot changes]` and the standard footer.
