# Captions Quick Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Chautauqua's live CART captioning site (`captions.chq.org`) as a seventh entry in the shared quick-links list, so it appears in both the web header and the iOS toolbar **More** menu.

**Architecture:** No new mechanism. `shared/links.json` is the cross-platform source of truth; the web reads it directly through `frontend/src/lib/quickLinks.ts`, and iOS hand-mirrors it in `AboutInfo.quickLinks` with an ordered-array equality test pinning the two together. This change is two data edits plus one test.

**Tech Stack:** JSON, TypeScript (Vitest), Swift (Swift Testing / `xcodebuild`)

**Spec:** `docs/superpowers/specs/2026-08-12-captions-link-design.md`

## Global Constraints

- Branch is `feat/captions-link`, already created off `main`. Never commit to `main`.
- The link's exact values, used identically in both files: id `captions`, title `Captions`, url `https://captions.chq.org/` — **with the trailing slash**.
- Position: index 4 of 7, immediately after `questions` and immediately before `bus-tram-tracker`. Final order: `about, feedback, programs, questions, captions, bus-tram-tracker, chautauqua-fund`.
- No `webPath` key on this entry. That field only exists to keep same-site links on localhost in dev; this destination is external.
- The working tree carries an **unrelated, uncommitted** `MARKETING_VERSION = 1.1.2` change in `ios/ChqCalendar.xcodeproj/project.pbxproj`. It must never be staged by this plan. Every `git add` below names explicit paths — do not substitute `git add -A` or `git add .`.
- `CODE_SIGNING_ALLOWED=NO` is required on every local `xcodebuild` invocation. It is not cosmetic: `AppGroupTests.containerURLIsNilInTheUnitTestHost` asserts there is *no* App Group entitlement, which is the condition this flag creates. A signed run turns a green tree red.

---

### Task 1: Add the Captions link to both platforms

Web and iOS are one task, not two, because `AboutInfoTests.quickLinksMatchSharedLinksJson` reads `shared/links.json` off disk at test time and compares it to the Swift list as ordered arrays. Editing either file alone leaves the iOS suite red. There is no commit boundary between them that a reviewer could accept.

The task runs two RED/GREEN cycles. The second one is not ceremony: it is the only evidence that the cross-platform pin actually fires. If step 7 shows the iOS suite still passing after `links.json` gained an entry the Swift file lacks, the pin is broken and that is a bigger finding than this feature.

**Files:**
- Modify: `shared/links.json:6-7` (insert a line between them)
- Modify: `ios/ChqCalendar/Features/About/AboutInfo.swift:43-44` (insert a line between them)
- Test: `frontend/src/lib/__tests__/quickLinks.test.ts` (add one case)
- Test (existing, must keep passing): `ios/ChqCalendarTests/AboutInfoTests.swift:88`

**Interfaces:**
- Consumes: nothing from earlier tasks — this is the first task.
- Produces: a quick link with id `captions` present in `quickLinks` (TypeScript, from `@/lib/quickLinks`) and in `AboutInfo.quickLinks` (Swift). Task 2 describes this addition in release notes but does not import from it.

- [ ] **Step 1: Write the failing web test**

Add this case to `frontend/src/lib/__tests__/quickLinks.test.ts`, directly after the existing `includes the Chautauqua Fund link` case (which it deliberately mirrors):

```ts
  it('includes the captions link', () => {
    const captions = quickLinks.find((l) => l.id === 'captions');
    expect(captions?.title).toBe('Captions');
    expect(captions?.url).toBe('https://captions.chq.org/');
  });
```

Why this test exists when both header render tests already iterate `quickLinks` via `it.each`: a data-driven test cannot fail on a *deleted* entry. Remove the link and `it.each` simply runs one fewer case, all green. This case is what turns a silent deletion into a red build.

- [ ] **Step 2: Run the web test and verify it fails**

Run:
```bash
cd frontend && npx vitest run src/lib/__tests__/quickLinks.test.ts
```

Expected: FAIL on `includes the captions link`. `find` returns `undefined`, so `captions?.title` is `undefined` and the first `expect` reports `expected undefined to be 'Captions'`.

If it passes, stop — an entry with that id already exists and this plan's premise is wrong.

- [ ] **Step 3: Establish the iOS baseline is green**

Run the one Swift test this change can break, before changing anything:

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  -only-testing:ChqCalendarTests/AboutInfoTests \
  CODE_SIGNING_ALLOWED=NO
```

Expected: PASS.

If that destination does not exist on this machine, list what does with `xcrun simctl list devices available` and substitute a name/OS from the output. Do not assume the README's `iPhone 17, OS=26.1` is installed — CI resolves a UDID at runtime precisely because pinned destinations are not portable between machines.

- [ ] **Step 4: Add the entry to `shared/links.json`**

Insert between the `questions` line and the `bus-tram-tracker` line, so the file reads:

```json
{
  "quickLinks": [
    { "id": "about", "title": "Guide", "url": "https://www.chqcal.org/about", "webPath": "/about" },
    { "id": "feedback", "title": "Feedback", "url": "https://www.chqcal.org/feedback", "webPath": "/feedback" },
    { "id": "programs", "title": "Programs", "url": "https://programs.chq.org/" },
    { "id": "questions", "title": "Questions", "url": "https://questions.chq.org/" },
    { "id": "captions", "title": "Captions", "url": "https://captions.chq.org/" },
    { "id": "bus-tram-tracker", "title": "Bus Tracker", "url": "https://busandtramtracker.chq.org" },
    { "id": "chautauqua-fund", "title": "CHQ Fund", "url": "https://giving.chq.org/" }
  ]
}
```

- [ ] **Step 5: Run the web test and verify it passes**

Run:
```bash
cd frontend && npx vitest run src/lib/__tests__/quickLinks.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 6: Run the full frontend test suite**

Run:
```bash
cd frontend && npm test
```

Expected: PASS. The two `it.each(quickLinks)` cases in `src/components/layout/__tests__/Header.test.tsx` now each run a seventh iteration — `desktop nav opens Captions from shared/links.json` and `mobile dropdown opens Captions from shared/links.json` — and both should be green without any edit to that file. Confirm those two case names appear in the output; that is the evidence the header picked the entry up.

- [ ] **Step 7: Run the iOS test and verify it now FAILS**

Same command as step 3:

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  -only-testing:ChqCalendarTests/AboutInfoTests \
  CODE_SIGNING_ALLOWED=NO
```

Expected: FAIL on `quickLinksMatchSharedLinksJson`. The Swift list has 6 entries, the JSON now has 7, so all three array comparisons (ids, titles, urls) differ.

**If this passes, do not continue.** It means the cross-platform pin is not actually reading `shared/links.json` — the `#filePath`-relative path in `AboutInfoTests.swift:98-102` has drifted, or the decode is silently failing. Report that instead of proceeding; it is a defect that predates this change and it makes the whole shared-links mechanism unenforced.

- [ ] **Step 8: Add the mirrored entry to `AboutInfo.swift`**

In `ios/ChqCalendar/Features/About/AboutInfo.swift`, insert between the `questions` line and the `bus-tram-tracker` line so `quickLinks` reads:

```swift
    static let quickLinks: [Link] = [
        Link(id: "about", title: "Guide", url: URL(string: "https://www.chqcal.org/about")!),
        Link(id: "feedback", title: "Feedback", url: URL(string: "https://www.chqcal.org/feedback")!),
        Link(id: "programs", title: "Programs", url: URL(string: "https://programs.chq.org/")!),
        Link(id: "questions", title: "Questions", url: URL(string: "https://questions.chq.org/")!),
        Link(id: "captions", title: "Captions", url: URL(string: "https://captions.chq.org/")!),
        Link(id: "bus-tram-tracker", title: "Bus Tracker", url: URL(string: "https://busandtramtracker.chq.org")!),
        Link(id: "chautauqua-fund", title: "CHQ Fund", url: URL(string: "https://giving.chq.org/")!),
    ]
```

Do not touch the doc comment above it — it already names `shared/links.json` as the source of truth and tells the next reader to change both. Nothing in it becomes untrue.

- [ ] **Step 9: Run the iOS test and verify it passes**

Same command as steps 3 and 7. Expected: PASS.

- [ ] **Step 10: Run the full iOS suite**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO
```

Expected: PASS, 720 tests. `quickLinksAreDistinctFromTheAboutSheetLinks` also covers this entry now — `captions` must not collide with the About sheet's ids (`guide`, `privacy`, `support`, `chq`), and it does not.

- [ ] **Step 11: Run the full frontend build**

```bash
cd frontend && npm run build
```

Expected: PASS. This runs `validate` (type-check + lint), then `test:ci` (Vitest with coverage), then `vite build`. Coverage is floored per `.coverage-floor.json`; a data-only addition to a file that is already fully covered will not move it down.

- [ ] **Step 12: Commit**

Stage only these three paths. The `project.pbxproj` change in the working tree is unrelated and must stay unstaged.

```bash
git add shared/links.json \
        ios/ChqCalendar/Features/About/AboutInfo.swift \
        frontend/src/lib/__tests__/quickLinks.test.ts
git status --short
```

Confirm `git status --short` shows the three files staged (`M ` in the first column) and `ios/ChqCalendar.xcodeproj/project.pbxproj` still unstaged (` M`). Then:

```bash
git commit -m "feat: Captions quick link (captions.chq.org) on web and iOS

Chautauqua runs live CART captioning at captions.chq.org for attendees
who are deaf or hard of hearing. Nothing in the app pointed at it — a
user in the Amphitheater had to already know the hostname.

Added to shared/links.json between Questions and Bus Tracker, and
mirrored in AboutInfo.quickLinks. Both neighbours are things you use in
the room during a talk, which is where captions belong; the order is
shared, so the iOS More menu reorders to match.

The URL is a 301 CHQ re-points at whichever session is currently being
captioned, so off-session it lands on a stopped-session page. Shown
unconditionally anyway: gating would need a liveness signal only CHQ's
DNS can provide, and a hidden accessibility affordance is worse than a
visible one that is sometimes idle.

One explicit test despite the header tests already iterating quickLinks
with it.each — a data-driven test runs one fewer case on a deleted
entry and stays green, so it cannot catch a silent deletion.

Verified the cross-platform pin fires rather than assuming it: with
links.json edited and AboutInfo.swift not yet,
quickLinksMatchSharedLinksJson failed on all three array comparisons.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QavxQ1q5L5J5nwTwGeA1cG"
```

---

### Task 2: Record the release note

Separate from Task 1 because it is a release-process artifact on a different review axis — a reviewer can reasonably accept the feature and reword the user-facing sentence, or vice versa.

**Files:**
- Modify: `docs/app-store/RELEASE_CHECKLIST.md:265-267` (append a bullet after the existing one)

**Interfaces:**
- Consumes: the shipped link from Task 1. This bullet describes behavior that must already be on the branch — the section's own header says not to list unshipped changes above the "Pending" divider.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the bullet**

In `docs/app-store/RELEASE_CHECKLIST.md`, under `## Release notes for the next version`, append after the existing "Filtering moved to the bottom of the screen" bullet and **before** the `**Pending, not yet shipped**` divider:

```markdown
- Captions: the More menu now links to Chautauqua's live captioning at
  captions.chq.org, for attendees who are deaf or hard of hearing.
```

It goes above the divider, not below it, because Task 1 already landed the change on this branch. The "Pending" section is only for changes a later PR will make.

- [ ] **Step 2: Verify placement**

```bash
sed -n '259,280p' docs/app-store/RELEASE_CHECKLIST.md
```

Expected: the new bullet appears after the filtering bullet and before the line beginning `**Pending, not yet shipped**`.

- [ ] **Step 3: Commit**

```bash
git add docs/app-store/RELEASE_CHECKLIST.md
git commit -m "docs: release note for the Captions quick link

Tracked above the 'Pending, not yet shipped' divider because the change
is on this branch, not deferred to a later PR.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QavxQ1q5L5J5nwTwGeA1cG"
```

---

### Task 3: Open the pull request

The screenshot guard is why this is a task with explicit content rather than a throwaway final step. `.github/workflows/app-store-assets.yml` fires on any change under `ios/ChqCalendar/Features/**`, and Task 1 modified `AboutInfo.swift`. Without the opt-out string in the PR body, the guard fails the PR.

**Files:**
- None in the repo. The deliverable is the PR.

**Interfaces:**
- Consumes: commits from Tasks 1 and 2.
- Produces: nothing.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/captions-link
```

- [ ] **Step 2: Open the PR with the screenshot opt-out**

The opt-out is legitimate, not a dodge. No shot in `ios/Scripts/screenshot-plan.json` opens the toolbar **More** menu — the ten shots cover the season list, filters, search, detail, articles, add-to-calendar, My Day, map, reminders, and the widget. A full regeneration run would leave `screenshots.manifest.json` unchanged, and the guard checks whether that file changed since the merge-base.

```bash
gh pr create --title "feat: Captions quick link (captions.chq.org) on web and iOS" --body "$(cat <<'EOF'
Adds Chautauqua's live CART captioning site to the shared quick-links list
that drives the web header and the iOS More menu.

Order is now: Guide · Feedback · Programs · Questions · **Captions** · Bus
Tracker · CHQ Fund. Programs and Questions are both things you use in the
room during a talk, so captions sits with them rather than next to the
donate link. The order is shared between platforms, so the iOS More menu
reorders to match — pinned by `AboutInfoTests.quickLinksMatchSharedLinksJson`,
which compares the two lists as ordered arrays.

## What the URL actually is

`captions.chq.org` is a 301 that CHQ re-points at whichever session is
currently being captioned. On 2026-08-12 it resolved to a 1CapApp CART session
page for Chautauqua that read "Session has been stopped".

Shown unconditionally anyway. Gating on liveness would need a second source of
truth we cannot populate — CHQ controls the redirect, not us — and a hidden
accessibility affordance is worse than a visible one that is sometimes idle.
Bus Tracker is equally idle in February and is also shown unconditionally.

## Testing

One new explicit case in `quickLinks.test.ts`, despite both header render
tests already iterating `quickLinks` with `it.each`. A data-driven test cannot
fail on a deleted entry — it just runs one fewer case, all green — so the
explicit case is what catches a silent deletion.

The cross-platform pin was verified to fire rather than assumed: with
`links.json` edited and `AboutInfo.swift` not yet, `quickLinksMatchSharedLinksJson`
failed on all three array comparisons.

Full frontend build green; full iOS suite green at 720 tests.

Design: `docs/superpowers/specs/2026-08-12-captions-link-design.md`

[skip-screenshots: no covered shot renders the More menu]

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01QavxQ1q5L5J5nwTwGeA1cG
EOF
)"
```

- [ ] **Step 3: Confirm the guard accepted the opt-out**

```bash
gh pr checks --watch
```

Expected: the app-store-assets check passes on the opt-out reason rather than demanding a manifest change. If it fails, the reason string is malformed — it must be a non-empty reason inside `[skip-screenshots: ...]`.
