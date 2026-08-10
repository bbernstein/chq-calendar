# Matcher — Concept-Based Category & Description Hardening

**Status:** Approved design — ready for implementation plan
**Date:** 2026-07-16
**Related:** Issue #138 (diacritics — out of scope, filed separately),
`chqdaily-article-links` (Phase 1 heuristic matcher, matcherVersion 3)

## Problem

The Chautauquan Daily article-to-event matcher
(`backend/src/services/articleMatcher.ts`) has a weak, easily-wasted
**category signal**. It matches an article to an event only by raw
shared-token overlap between `article.categories` and the event's category
names. Two structural gaps make the most semantically reliable signal —
the program a category names — fire far less often than it should:

1. **Vocabulary mismatch.** Chautauquan Daily categories/tags are short
   WordPress terms (`"Symphony"`, `"cso"`, `"Amphitheater"`), while calendar
   event categories are long formal names
   (`"Chautauqua Symphony Orchestra/Classical Concerts"`). Raw token
   overlap never bridges `cso` ↔ `chautauqua symphony orchestra` — there is
   no shared token, and `cso` is under the matcher's 4-character token floor
   so it produces no token at all.
2. **Tags ignored.** The category signal reads only `article.categories`,
   never `article.tags` — so an article tagged `cso` contributes nothing to
   category alignment.

### Worked example (the trigger)

Event (2026-07-16): *"Chautauqua Symphony Orchestra with Mak Grgić, guitar"*,
Amphitheater, event category
`"Chautauqua Symphony Orchestra/Classical Concerts"`.

Article: title *"Uplifting the Spirit: Grgić to perform orchestra-backed
guitar concerto with CSO"*, `categories: ["Chautauqua Symphony Orchestra",
"Amphitheater", …]`, `tags: ["cso", …]`, body mentions "Chautauqua Symphony
Orchestra".

Today this pair matches primarily via venue + lucky `orchestra`/`guitar`
title-token overlap + same-day "8 p.m./tonight" phrasing. Whether the
*category* signal contributes at all is wording-dependent and fragile:

- The matcher loads the long-form event category
  `"Chautauqua Symphony Orchestra/Classical Concerts"` (the `"CSO"` chip seen
  on the card is a frontend-derived display tag, not what the matcher reads).
  So the existing token fallback *may* fire here on the shared tokens
  `symphony`/`orchestra` — but only because the article happens to carry a
  spelled-out `"Chautauqua Symphony Orchestra"` category.
- The article's `cso` **tag** — the most unambiguous program signal present —
  is never read by the category block at all.
- Had the article been tagged only `cso` (no spelled-out category), or the
  event category been the acronym form, category alignment would score
  **zero**: `cso` is under the 4-char token floor and shares no token with the
  full name.

So the signal that *should* be rock-solid (both sides unambiguously name the
CSO) instead rides on whether the two happen to spell it the same way. Strip
the wording coincidences — a recap written days later; an event whose title
shares no words with the headline; a venue-less event; an acronym-only tag —
and the pair can collapse even though it is unambiguously about that program.

## Goal

**Robustness hardening, balanced posture.** Make the category signal fire
reliably on the *concept* an article and event share, and make bounded use
of the article description/body — without raising false-positive risk. No
weight or threshold changes. This is not chasing specific known misses; it
hardens matches so they stop depending on lucky wording.

Non-goals: embedding/AI matching (deferred Phase 2); the diacritics
normalization bug (Issue #138); any refactor of `eventTransformationService`.

## Design

### 1. Concept-normalization module — `backend/src/services/chqConcepts.ts`

A new, self-contained module mapping the various surface forms of a
Chautauqua program/venue to a single stable **concept key**. Seeded from the
already-curated `venueMap` in `eventTransformationService.ts:171-179` and
extended to cover the real event category vocabulary (~30 categories,
enumerated in `frontend/data/all-events.json` and `docs/publisher/categories.json`).

```ts
// A concept is a stable id. `surfaces` are forms that appear in STRUCTURED
// fields (event category names, article WP categories, article tags) and are
// safe to match exactly/whole-phrase. `bodyPhrases` are multi-word canonical
// forms that are safe to search for in free-text prose (excerpt/body).
interface Concept {
  key: string;
  surfaces: string[];
  bodyPhrases: string[];
}

const CONCEPTS: Concept[] = [
  { key: 'cso',
    surfaces: ['cso', 'symphony', 'chautauqua symphony orchestra',
               'chautauqua symphony orchestra classical concerts', 'classical concerts'],
    bodyPhrases: ['chautauqua symphony orchestra'] },
  { key: 'ctc',
    surfaces: ['ctc', 'theater', 'theatre', 'chautauqua theater company'],
    bodyPhrases: ['chautauqua theater company'] },
  { key: 'clsc',
    surfaces: ['clsc', 'chautauqua literary and scientific circle'],
    bodyPhrases: ['chautauqua literary and scientific circle'] },
  // …opera, dance, chamber music, interfaith lecture series, chautauqua
  //   lecture series, etc. — the concrete list is finalized during
  //   implementation against the enumerated event vocabulary.
];

/** Concept keys a structured category/tag string maps to (normalized,
 *  whole-phrase surface containment). Empty set when nothing matches. */
export function conceptsFor(text: string): Set<string>;

/** Concept keys whose bodyPhrases appear in already-normalized prose text.
 *  Only multi-word phrases — never single generic words. */
export function conceptsInBody(normalizedBody: string): Set<string>;
```

**Why the `surfaces` / `bodyPhrases` split.** Single generic words like
`symphony` or `theater` are safe to match inside a *curated WordPress
category/tag field* (a category literally named "Symphony" is unambiguous),
but unsafe to scan for in *prose* (an article may mention "symphony"
generically). So structured matching uses `surfaces`; prose corroboration
(section 3) uses only the stricter multi-word `bodyPhrases`.

Matching semantics: `conceptsFor` normalizes with the matcher's existing
`normalize()` and tests whole-phrase (space-padded) containment of each
surface, so `"Chautauqua Symphony Orchestra/Classical Concerts"` →
`{ 'cso' }` and `"cso"` → `{ 'cso' }`.

The map is a single source of truth for the matcher. `eventTransformationService`
keeps its own `venueMap` for now (no refactor this change); a follow-up may
consolidate them.

### 2. Category signal — concept match, now including tags

Replaces the token-only category block (`articleMatcher.ts:162-170`). Three
tiers, most-precise first; at most one fires:

```
eventConcepts   = ∪ conceptsFor(name)  for name in eventCategoryNames(event)
articleConcepts = ∪ conceptsFor(s)     for s in [...article.categories, ...article.tags]

if eventConcepts ∩ articleConcepts ≠ ∅:
    score += WEIGHTS.category            reason 'category-concept'
elif distinctive-token overlap over [...article.categories, ...article.tags]
     shares a token with any event category name:
    score += WEIGHTS.category            reason 'category-token'   // existing fallback, now over tags too
elif <see §3 body corroboration>:
    score += WEIGHTS.category * 0.5      reason 'category-body'
```

Two fixes fall out for free: `article.tags` is now consulted (was ignored),
and the acronym ↔ full-name gap closes at the concept layer instead of
depending on a shared word.

### 3. Description/body corroboration (bounded, half credit)

When neither structured tier fires, consult the article prose — but only for
canonical multi-word program phrases, and only for partial credit:

```
bodyConcepts = conceptsInBody(normBody)     // normBody already built in scorePair
if eventConcepts ∩ bodyConcepts ≠ ∅:
    score += WEIGHTS.category * 0.5          reason 'category-body'
```

`normBody` (normalized `excerptText + bodyText`) is already constructed in
`scorePair` for venue matching, so no new text handling is needed. Half
credit + multi-word-only phrases is the deliberate balanced choice: it honors
"make better use of descriptions" without letting a passing mention drive a
match.

### 4. Weights, threshold, version

**No weight or threshold changes.** Safety argument for why hardening the
category signal is low-risk:

`category (0.15) + venue (0.30) + proximity (≤0.10) = 0.55 < 0.60 threshold`

So an improved category signal can **never** manufacture a match on its own —
a real people (0.35) or time-of-day (0.40) signal is still required. What
hardening *does* do:

- Rescue genuine borderline cases (e.g. people-matched article, no venue tag:
  `0.35 + 0.15 + 0.10 = 0.60` ✅).
- Improve scoring confidence and recurring-event tiebreaking.

`MATCHER_VERSION`: **3 → 4** (required — signal logic changed; forces the
one-time full recompute in `computeMatchState` so the improvement applies
retroactively to already-ingested articles).

### 5. Observability

The new `reasons` values (`category-concept`, `category-token`,
`category-body`) replace the single `category` reason, making it visible in
the persisted match state *which* tier fired — useful for later precision
audits.

## Testing (TDD)

New `backend/src/__tests__/chqConcepts.test.ts`:
- `conceptsFor`: `cso` / `symphony` / `chautauqua symphony orchestra` /
  `chautauqua symphony orchestra/classical concerts` → `{ 'cso' }`;
  `theater` / `ctc` → `{ 'ctc' }`; `clsc` → `{ 'clsc' }`.
- Non-matches: unrelated strings → `∅`; a generic word that is only a
  `bodyPhrase`, not a `surface`, does not match via `conceptsFor`.
- `conceptsInBody`: multi-word phrase present → concept; single generic word
  present → `∅`.

New `scorePair` cases in `backend/src/__tests__/articleMatcher.test.ts`:
- **The trigger example** — article `categories:['Chautauqua Symphony Orchestra','Amphitheater']`,
  `tags:['cso']`, event category `'Chautauqua Symphony Orchestra/Classical Concerts'`
  → `reasons` contains `category-concept`.
- **Tag-only concept match** — concept present only via `article.tags`
  (`['cso']`, empty categories) → `category-concept` fires.
- **Body corroboration** — no structured category/tag concept overlap, but
  body contains `"chautauqua symphony orchestra"` → `category-body` fires with
  half weight; assert the score delta is `WEIGHTS.category * 0.5`.
- **Negative** — no concept overlap anywhere → no category reason, no category
  credit.

Update `backend/src/__tests__/articleMatcher.incremental.test.ts`:
- Any assertion of `matcherVersion === 3` → `4`; confirm a stored state at
  version 3 triggers full recompute.

## Rollout

Standard: merge → the hourly ingest Lambda picks up the new `MATCHER_VERSION`
on its next run, detects the version mismatch, fully recomputes all pairs, and
republishes `article-links-<year>.json`. No data migration, no manual step.

## Out of scope (conscious)

- **Issue #138** — `normalize()` drops diacritics (`"Grgić"` → `grgi`),
  silently breaking the *people/surname* signal for accented names. Real
  adjacent bug, filed separately, fixed on its own branch.
- Consolidating `eventTransformationService`'s `venueMap` into `chqConcepts`.
- Phase 2 embedding/AI matching.
