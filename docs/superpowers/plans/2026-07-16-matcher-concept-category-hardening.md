# Matcher Concept-Based Category & Description Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Chautauquan Daily article-to-event matcher's category signal fire on the *concept* an article and event share (bridging acronyms, short WP terms, and full formal names) instead of on coincidental token overlap, and add bounded use of article prose.

**Architecture:** Introduce a self-contained concept-normalization module (`chqConcepts.ts`) that maps program/venue surface forms to stable concept keys. Rewire `scorePair`'s category block into three tiers — concept match (full credit), raw-token fallback (full credit, now including `article.tags`), and multi-word prose corroboration (half credit). Extract the shared `normalize` helper into its own module so both files can use it without a circular import. Bump `MATCHER_VERSION` to force a one-time full recompute.

**Tech Stack:** TypeScript, Node 24, Jest (`jest --passWithNoTests`), ESLint (`--max-warnings=0`).

## Global Constraints

- All backend code must pass `npm run validate --workspace=backend` (type-check + `eslint --max-warnings=0`). Any ESLint warning fails the build. Copied from CLAUDE.md verification checklist.
- Every code change ships with unit tests; coverage floor enforced via `.coverage-floor.json`. Copied from CLAUDE.md.
- Work happens on branch `feat/matcher-concept-category-hardening` (already created; never commit to `main`). Copied from CLAUDE.md.
- All commands below run from the `backend/` directory unless noted.
- Commit trailers on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018EZ5Pts5eyp7eJUaXvYANz
  ```

---

### Task 1: Extract `normalize` into a shared module

**Why:** `chqConcepts.ts` (Task 2) needs the exact same text normalization as `articleMatcher.ts`, but `articleMatcher.ts` will import `chqConcepts`. Defining `normalize` in `articleMatcher` and importing it back into `chqConcepts` would create a circular import. Extract it to a leaf module both can depend on. This is a behavior-preserving refactor — the existing matcher tests are the safety net.

**Files:**
- Create: `backend/src/services/textNormalize.ts`
- Modify: `backend/src/services/articleMatcher.ts:52-54` (remove local `normalize`, import it)
- Test: covered by existing `backend/src/__tests__/articleMatcher.test.ts` (no behavior change)

**Interfaces:**
- Produces: `export function normalize(s: string): string` — lowercases, replaces every non-`[a-z0-9\s]` char with a space, collapses runs of whitespace, trims. **Identical** to the current implementation.

- [ ] **Step 1: Create the shared module**

Create `backend/src/services/textNormalize.ts`:

```ts
/**
 * Lowercase, strip punctuation/symbols to spaces, and collapse whitespace.
 * Shared by the matcher and the concept normalizer so both compare text the
 * same way. NOTE: this intentionally does NOT fold diacritics — see issue #138.
 */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 2: Import it in `articleMatcher.ts` and delete the local copy**

In `backend/src/services/articleMatcher.ts`, add to the imports near the top (after the existing `import type { … } from '../types/articles';` block, around line 10):

```ts
import { normalize } from './textNormalize';
```

Then delete the local definition at lines 52-54:

```ts
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 3: Run the existing matcher tests to prove no behavior change**

Run: `npx jest articleMatcher --silent`
Expected: PASS — all existing `articleMatcher.test.ts` and `articleMatcher.incremental.test.ts` tests green (they exercise `normalize` indirectly through `scorePair`).

- [ ] **Step 4: Type-check and lint**

Run: `npm run validate`
Expected: PASS — no type errors, zero ESLint warnings.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/textNormalize.ts backend/src/services/articleMatcher.ts
git commit -m "refactor(matcher): extract normalize into shared textNormalize module

Behavior-preserving. Lets the upcoming concept normalizer share the exact
same text normalization without a circular import back into articleMatcher.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018EZ5Pts5eyp7eJUaXvYANz"
```

---

### Task 2: Concept-normalization module (`chqConcepts.ts`)

**Files:**
- Create: `backend/src/services/chqConcepts.ts`
- Test: `backend/src/__tests__/chqConcepts.test.ts`

**Interfaces:**
- Consumes: `normalize` from `./textNormalize` (Task 1).
- Produces:
  - `export function conceptsFor(text: string): Set<string>` — normalizes `text` internally, returns the set of concept keys whose **surface** forms appear in it as whole space-delimited phrases. Empty set when none match.
  - `export function conceptsInBody(normalizedPaddedBody: string): Set<string>` — expects an **already-normalized, space-padded** string (i.e. `` ` ${normalize(x)} ` ``). Returns concept keys whose **multi-word `bodyPhrases`** appear in it. Never matches single generic words.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/chqConcepts.test.ts`:

```ts
import { conceptsFor, conceptsInBody } from '../services/chqConcepts';

describe('conceptsFor', () => {
  test.each([
    ['cso', 'cso'],
    ['CSO', 'cso'],
    ['Symphony', 'cso'],
    ['Chautauqua Symphony Orchestra', 'cso'],
    ['Chautauqua Symphony Orchestra/Classical Concerts', 'cso'],
    ['CTC', 'ctc'],
    ['Chautauqua Theater Company', 'ctc'],
    ['CLSC', 'clsc'],
    ['Chautauqua Literary and Scientific Circle', 'clsc'],
    ['Opera', 'opera'],
    ['Interfaith Lecture', 'interfaith'],
  ])('%s resolves to concept %s', (input, key) => {
    expect(conceptsFor(input).has(key)).toBe(true);
  });

  test('unrelated categories map to no concept', () => {
    expect(conceptsFor('Community Group Event').size).toBe(0);
    expect(conceptsFor('Movies').size).toBe(0);
    expect(conceptsFor('Recreation').size).toBe(0);
  });

  test('bare "theater" is not a surface (too ambiguous — only acronym/full name resolve to ctc)', () => {
    expect(conceptsFor('Theater').has('ctc')).toBe(false);
  });
});

describe('conceptsInBody', () => {
  test('multi-word canonical phrase in prose resolves to its concept', () => {
    const body = ' the chautauqua symphony orchestra performs tonight ';
    expect(conceptsInBody(body).has('cso')).toBe(true);
  });

  test('a bare generic word in prose does not resolve (surfaces are not body phrases)', () => {
    const body = ' a symphony of color filled the gallery ';
    expect(conceptsInBody(body).has('cso')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest chqConcepts`
Expected: FAIL — `Cannot find module '../services/chqConcepts'`.

- [ ] **Step 3: Write the module**

Create `backend/src/services/chqConcepts.ts`:

```ts
import { normalize } from './textNormalize';

/**
 * A Chautauqua program/venue "concept" and the ways it is written.
 *
 * - `key`         stable concept id used only for comparison.
 * - `surfaces`    forms that appear in STRUCTURED fields (event category
 *                 names, article WP categories, article tags). Safe to match
 *                 as whole space-delimited phrases — includes acronyms and
 *                 unambiguous single words (e.g. "symphony", "opera").
 * - `bodyPhrases` multi-word canonical forms safe to search for in free-text
 *                 prose. NEVER single generic words — that is why prose
 *                 corroboration cannot fire on a passing mention of "symphony".
 *
 * Seeded from the venueMap in eventTransformationService.ts and extended to
 * the real event category vocabulary. Add an entry when a new program needs
 * acronym/short-form bridging.
 */
interface Concept {
  key: string;
  surfaces: string[];
  bodyPhrases: string[];
}

const CONCEPTS: Concept[] = [
  {
    key: 'cso',
    surfaces: ['cso', 'symphony', 'chautauqua symphony orchestra', 'classical concerts'],
    bodyPhrases: ['chautauqua symphony orchestra'],
  },
  {
    key: 'ctc',
    surfaces: ['ctc', 'chautauqua theater company'],
    bodyPhrases: ['chautauqua theater company'],
  },
  {
    key: 'clsc',
    surfaces: ['clsc', 'literary and scientific circle', 'chautauqua literary and scientific circle'],
    bodyPhrases: ['literary and scientific circle'],
  },
  {
    key: 'ciwl',
    surfaces: ['ciwl', 'chautauqua womens club', 'chautauqua institution womens league'],
    bodyPhrases: ['chautauqua womens club', 'chautauqua institution womens league'],
  },
  {
    key: 'opera',
    surfaces: ['opera', 'chautauqua opera company'],
    bodyPhrases: ['chautauqua opera company'],
  },
  {
    key: 'school-of-music',
    surfaces: ['msfo', 'school of music', 'music school festival orchestra'],
    bodyPhrases: ['music school festival orchestra', 'school of music'],
  },
  {
    key: 'chamber-music',
    surfaces: ['chamber music'],
    bodyPhrases: ['chamber music'],
  },
  {
    key: 'interfaith',
    surfaces: ['interfaith', 'interfaith lecture series'],
    bodyPhrases: ['interfaith lecture series'],
  },
  {
    key: 'dance',
    surfaces: ['dance', 'chautauqua dance'],
    bodyPhrases: ['chautauqua dance'],
  },
];

/** True when `haystack` contains `needle` as a whole space-delimited phrase. */
function containsPhrase(paddedHaystack: string, needle: string): boolean {
  return paddedHaystack.includes(` ${needle} `);
}

/**
 * Concept keys a structured category/tag string maps to. Normalizes its own
 * input; matches surface forms as whole phrases.
 */
export function conceptsFor(text: string): Set<string> {
  const padded = ` ${normalize(text)} `;
  const keys = new Set<string>();
  for (const c of CONCEPTS) {
    if (c.surfaces.some(s => containsPhrase(padded, s))) keys.add(c.key);
  }
  return keys;
}

/**
 * Concept keys whose multi-word bodyPhrases appear in prose. Expects an
 * already-normalized, space-padded string (e.g. ` ${normalize(body)} `).
 */
export function conceptsInBody(normalizedPaddedBody: string): Set<string> {
  const keys = new Set<string>();
  for (const c of CONCEPTS) {
    if (c.bodyPhrases.some(p => containsPhrase(normalizedPaddedBody, p))) keys.add(c.key);
  }
  return keys;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest chqConcepts`
Expected: PASS — all `conceptsFor` and `conceptsInBody` cases green.

- [ ] **Step 5: Type-check and lint**

Run: `npm run validate`
Expected: PASS — no type errors, zero warnings.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/chqConcepts.ts backend/src/__tests__/chqConcepts.test.ts
git commit -m "feat(matcher): add chqConcepts concept-normalization module

Maps Chautauqua program/venue surface forms (acronyms, short WP terms, full
formal names) to stable concept keys. Splits structured 'surfaces' from
multi-word 'bodyPhrases' so prose corroboration cannot fire on a passing
single-word mention.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018EZ5Pts5eyp7eJUaXvYANz"
```

---

### Task 3: Wire the concept-based category signal into `scorePair`

**Files:**
- Modify: `backend/src/services/articleMatcher.ts:16` (`MATCHER_VERSION` 3 → 4)
- Modify: `backend/src/services/articleMatcher.ts:162-170` (rewrite the category block)
- Modify: `backend/src/services/articleMatcher.ts` imports (add `chqConcepts`)
- Test: `backend/src/__tests__/articleMatcher.test.ts` (add cases)

**Interfaces:**
- Consumes: `conceptsFor`, `conceptsInBody` from `./chqConcepts` (Task 2); existing `normalize`, `distinctiveTokens`, `eventCategoryNames`, `WEIGHTS`, and the local `normBody` variable already built in `scorePair`.
- Produces: new `reasons` strings `'category-concept'`, `'category-token'`, `'category-body'` (replacing the single `'category'`). No public signature change to `scorePair`.

- [ ] **Step 1: Write the failing tests**

Add these tests inside the `describe('scorePair', …)` block in `backend/src/__tests__/articleMatcher.test.ts` (e.g. after the existing venue-alias test, around line 87):

```ts
  test('category-concept: article tag "cso" matches event "…/Classical Concerts" via concept', () => {
    const a = article({
      title: 'Grgic to perform guitar concerto',
      categories: ['Amphitheater'],
      tags: ['cso'],
      pubDate: '2026-07-16T00:40:00',
      excerptText: 'A Grammy nominee takes the stage.',
      bodyText: 'A Grammy nominee takes the stage beside the orchestra.',
    });
    const e = event({
      id: 'cso-1',
      title: 'Chautauqua Symphony Orchestra with Mak Grgic',
      startDate: '2026-07-16T20:00:00',
      venue: { name: 'Amphitheater' },
      category: undefined,
      categories: [{ name: 'Chautauqua Symphony Orchestra/Classical Concerts' }],
      presenter: 'Mak Grgic',
    });
    const r = scorePair(a, e);
    expect(r).not.toBeNull();
    expect(r!.reasons).toContain('category-concept');
    expect(r!.reasons).not.toContain('category-token');
  });

  test('category-body: no structured concept/token overlap, but body names the program (half credit)', () => {
    const a = article({
      title: 'A night of guitar with Mak Grgic',
      categories: ['Amphitheater'],
      tags: [],
      excerptText: '',
      bodyText: 'Grgic performs beside the Chautauqua Symphony Orchestra in the Amphitheater.',
      pubDate: '2026-07-16T00:40:00',
    });
    const e = event({
      id: 'cso-2',
      title: 'Symphony night with Mak Grgic',
      startDate: '2026-07-16T20:00:00',
      venue: { name: 'Amphitheater' },
      category: undefined,
      categories: [{ name: 'Chautauqua Symphony Orchestra/Classical Concerts' }],
      presenter: 'Mak Grgic',
    });
    const r = scorePair(a, e);
    expect(r).not.toBeNull();
    expect(r!.reasons).toContain('category-body');
    expect(r!.reasons).not.toContain('category-concept');
    expect(r!.reasons).not.toContain('category-token');
  });

  test('no category signal when taxonomies and body share no concept or token', () => {
    const a = article({
      title: 'Jane Marlow on democracy',
      categories: ['Movies'],
      tags: ['Jane Marlow'],
      excerptText: 'Jane Marlow speaks at 2 p.m. today in the Hall of Philosophy.',
      bodyText: 'Jane Marlow speaks at 2 p.m. today in the Hall of Philosophy.',
    });
    const e = event({
      title: 'Morning talk',
      startDate: '2026-07-15T14:00:00',
      venue: { name: 'Hall of Philosophy' },
      category: 'Recreation',
      presenter: 'Jane Marlow',
    });
    const r = scorePair(a, e);
    expect(r).not.toBeNull();
    expect(r!.reasons.some(x => x.startsWith('category'))).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest articleMatcher.test -t "category-concept"`
Expected: FAIL — the current category block pushes `'category'`, not `'category-concept'`, and does not read `article.tags`.

- [ ] **Step 3: Bump `MATCHER_VERSION`**

In `backend/src/services/articleMatcher.ts:16`, change:

```ts
export const MATCHER_VERSION = 3;
```
to:
```ts
export const MATCHER_VERSION = 4;
```

- [ ] **Step 4: Add the concept import**

In `backend/src/services/articleMatcher.ts`, alongside the `import { normalize } from './textNormalize';` line added in Task 1, add:

```ts
import { conceptsFor, conceptsInBody } from './chqConcepts';
```

- [ ] **Step 5: Rewrite the category block**

Replace the current category block at `backend/src/services/articleMatcher.ts:162-170`:

```ts
  // Category alignment: any distinctive token shared between taxonomies
  const articleCatTokens = new Set(article.categories.flatMap(distinctiveTokens));
  const aligned = eventCategoryNames(event).some(name =>
    distinctiveTokens(name).some(t => articleCatTokens.has(t)),
  );
  if (aligned) {
    score += WEIGHTS.category;
    reasons.push('category');
  }
```

with the three-tier version:

```ts
  // Category alignment, most-precise tier first (at most one fires):
  //  1. concept match — bridges acronyms / short↔long vocabulary (CSO ↔
  //     "Chautauqua Symphony Orchestra/Classical Concerts"). Now also reads
  //     article.tags, where the Daily often puts the program shorthand.
  //  2. raw distinctive-token overlap — the original fallback, over tags too.
  //  3. bounded prose corroboration — half credit, multi-word phrases only.
  const eventCatNames = eventCategoryNames(event);
  const eventConcepts = new Set(eventCatNames.flatMap(name => [...conceptsFor(name)]));
  const articleCatSources = [...article.categories, ...article.tags];
  const articleConcepts = new Set(articleCatSources.flatMap(s => [...conceptsFor(s)]));

  if ([...eventConcepts].some(k => articleConcepts.has(k))) {
    score += WEIGHTS.category;
    reasons.push('category-concept');
  } else {
    const articleCatTokens = new Set(articleCatSources.flatMap(distinctiveTokens));
    const tokenAligned = eventCatNames.some(name =>
      distinctiveTokens(name).some(t => articleCatTokens.has(t)),
    );
    if (tokenAligned) {
      score += WEIGHTS.category;
      reasons.push('category-token');
    } else {
      const bodyConcepts = conceptsInBody(normBody);
      if ([...eventConcepts].some(k => bodyConcepts.has(k))) {
        score += WEIGHTS.category * 0.5;
        reasons.push('category-body');
      }
    }
  }
```

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `npx jest articleMatcher.test`
Expected: PASS — the three new cases and all pre-existing `scorePair` cases green.

- [ ] **Step 7: Run the full matcher suite (guards the version bump)**

Run: `npx jest articleMatcher`
Expected: PASS — `articleMatcher.incremental.test.ts` too. It asserts `state.matcherVersion` against the imported `MATCHER_VERSION` symbol (not a hardcoded `3`) and uses `matcherVersion: 0` for its stale-state case, so the bump to `4` needs no test edits. If any assertion hardcodes `3`, update it to `4`.

- [ ] **Step 8: Type-check and lint**

Run: `npm run validate`
Expected: PASS — no type errors, zero warnings.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/articleMatcher.ts backend/src/__tests__/articleMatcher.test.ts
git commit -m "feat(matcher): concept-based category matching + tags + prose corroboration

Rewrites scorePair's category signal into three tiers: concept match (full
credit, bridges acronyms and short↔long vocabulary, now also reads
article.tags), raw-token fallback (full credit), and bounded multi-word prose
corroboration (half credit). Emits category-concept/category-token/category-body
reasons for observability. Bumps MATCHER_VERSION 3 -> 4 to force a one-time
full recompute so the improvement applies to already-ingested articles.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018EZ5Pts5eyp7eJUaXvYANz"
```

---

### Task 4: Full backend verification (deploy-readiness gate)

**Why:** The `MATCHER_VERSION` bump ripples through `articleIngestRunner` (it stamps `matcherVersion: MATCHER_VERSION` into published output) and the incremental recompute path. Run the whole backend suite + build to confirm no regression before the branch is considered done.

**Files:** none (verification only).

- [ ] **Step 1: Run the entire backend test suite**

Run: `npm test`
Expected: PASS — every backend test (matcher, concepts, runner, publisher, store, client) green.

- [ ] **Step 2: Run validate + production build**

Run: `npm run validate && npm run build`
Expected: PASS — type-check clean, zero ESLint warnings, esbuild bundle succeeds.

- [ ] **Step 3: Confirm the version bump is coherent end-to-end**

Run: `grep -rn "MATCHER_VERSION\|matcherVersion" backend/src/services/articleMatcher.ts backend/src/services/articleIngestRunner.ts`
Expected: `MATCHER_VERSION = 4` in `articleMatcher.ts`; `articleIngestRunner.ts` references the symbol (not a literal). No hardcoded `3` remains.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin feat/matcher-concept-category-hardening
```

Then stop — do not open a PR or merge automatically. Surface the branch to the user for review per project rules.

---

## Notes for the implementer

- **Do not** attempt to fix the diacritics normalization (`"Grgić"` → `grgi`) — that is deliberately out of scope and tracked in **issue #138**. The Task 3 tests use the ASCII spelling `"Grgic"` on purpose.
- **Do not** refactor `eventTransformationService.ts`'s `venueMap` in this change; `chqConcepts` is the matcher's source of truth going forward, and consolidation is a separate follow-up.
- The `MATCHER_VERSION` bump is load-bearing: without it, already-ingested articles keep their old match state and the improvement would not apply retroactively.
- Rollout is automatic: the hourly ingest Lambda detects the version mismatch on its next run, fully recomputes, and republishes `article-links-<year>.json`. No data migration.
