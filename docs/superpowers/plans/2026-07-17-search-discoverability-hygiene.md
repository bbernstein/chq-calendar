# Search Discoverability — Phase 1 Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chqcal.org crawlable and measurable to search engines (robots.txt, sitemap, canonical, structured data, crawlable homepage content, consistent social tags) while keeping admin/publish pages out of the index — with no changes that target CHQ brand queries or expose event prose.

**Architecture:** Static Vite + Preact MPA. Crawl directives and structured data are static edits to the per-page `index.html` entry files. The sitemap is generated at build time by a Vite plugin (mirroring the existing `emitVersionJson` plugin), backed by a pure, unit-tested function in `src/lib/`. HTML-content assertions are verified by a vitest test that reads the entry files from disk.

**Tech Stack:** Vite 7, Preact 10, TypeScript 5, vitest 4 (jsdom), schema.org JSON-LD.

## Global Constraints

- Never commit to `main`. Work happens on branch `seo/phase1-discoverability-hygiene` (already created).
- Tests must live under `src/**/*.test.{ts,tsx}` — that is the only path vitest includes (`vitest.config.ts`).
- Canonical site origin is exactly `https://www.chqcal.org` (no trailing path, `www` subdomain).
- Public/indexable routes are ONLY `/` and `/feedback`. Every `admin/*` and `publish/*` entry must be `noindex`.
- Structured data describes the **app**, never individual events (Event JSON-LD is deferred Phase 2).
- Static fallback copy must be the author's own words about the tool — no scraped/verbatim CHQ event text.
- Run `npm run build` (which runs `validate` + `test:ci` + `vite build`) from `frontend/` before every commit. Backend is untouched.
- Coverage floor is enforced (`.coverage-floor.json`); new `src/lib/` code must be fully covered by its test.

---

## File Structure

- `frontend/src/lib/sitemap.ts` — **new.** Pure functions/constants: `SITE_ORIGIN`, `PUBLIC_PATHS`, `buildSitemapXml()`. One responsibility: produce sitemap XML text. No Vite/fs imports so it is trivially unit-testable.
- `frontend/src/lib/sitemap.test.ts` — **new.** Unit tests for `buildSitemapXml`.
- `frontend/public/robots.txt` — **new.** Static crawl directives.
- `frontend/vite.config.ts` — **modify.** Add an `emitSitemapXml` build plugin that calls `buildSitemapXml`.
- `frontend/src/__tests__/seoHtml.test.ts` — **new.** Reads entry HTML files from disk; asserts noindex gating, canonical, JSON-LD, and social tags.
- 14 gated entries (`admin/**/index.html`, `publish/**/index.html`) — **modify.** Add `noindex` meta.
- `frontend/index.html` — **modify.** Add canonical, static `#root` fallback content, JSON-LD, `og:image`.
- `frontend/src/entries/main.tsx` — **modify.** Clear `#root` before mount so fallback content can't duplicate.
- `frontend/feedback/index.html` — **modify.** Add canonical + OG/Twitter parity.
- `docs/runbooks/search-console-setup.md` — **new.** User-owned handoff steps for verification + sitemap submission.

---

## Task 1: Sitemap generator + robots.txt

**Files:**
- Create: `frontend/src/lib/sitemap.ts`
- Test: `frontend/src/lib/sitemap.test.ts`
- Create: `frontend/public/robots.txt`
- Modify: `frontend/vite.config.ts` (plugin list + one new plugin function)

**Interfaces:**
- Produces: `SITE_ORIGIN: string`, `PUBLIC_PATHS: readonly string[]`, `buildSitemapXml(paths: readonly string[], origin?: string): string`. Consumed by `vite.config.ts` and by Task 3/4 tests indirectly (via `SITE_ORIGIN`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/sitemap.test.ts`:

```ts
/// <reference types="vitest/globals" />
import { buildSitemapXml, PUBLIC_PATHS, SITE_ORIGIN } from '@/lib/sitemap';

describe('buildSitemapXml', () => {
  it('renders each path as an absolute <loc> under the given origin', () => {
    const xml = buildSitemapXml(['/', '/feedback'], 'https://example.org');
    expect(xml).toContain('<loc>https://example.org/</loc>');
    expect(xml).toContain('<loc>https://example.org/feedback</loc>');
  });

  it('emits exactly one <url> element per path', () => {
    const xml = buildSitemapXml(PUBLIC_PATHS);
    const count = (xml.match(/<url>/g) || []).length;
    expect(count).toBe(PUBLIC_PATHS.length);
  });

  it('defaults to the production origin', () => {
    expect(buildSitemapXml(['/'])).toContain(`<loc>${SITE_ORIGIN}/</loc>`);
  });

  it('never lists admin or publish routes', () => {
    const xml = buildSitemapXml(PUBLIC_PATHS);
    expect(xml).not.toContain('/admin');
    expect(xml).not.toContain('/publish');
  });

  it('is well-formed XML with a urlset root', () => {
    const xml = buildSitemapXml(PUBLIC_PATHS);
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/sitemap.test.ts`
Expected: FAIL — cannot resolve `@/lib/sitemap`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/lib/sitemap.ts`:

```ts
/**
 * Sitemap generation for chqcal.org.
 *
 * Pure and dependency-free so it is unit-testable and can be imported by
 * both the Vite build plugin and tests. Only PUBLIC, indexable routes belong
 * here — admin/publish pages are intentionally excluded and are additionally
 * noindex'd at the page level.
 */
export const SITE_ORIGIN = 'https://www.chqcal.org';

// The only routes we want in the search index for Phase 1.
export const PUBLIC_PATHS = ['/', '/feedback'] as const;

export function buildSitemapXml(
  paths: readonly string[],
  origin: string = SITE_ORIGIN,
): string {
  const urls = paths
    .map((p) => `  <url>\n    <loc>${origin}${p}</loc>\n  </url>`)
    .join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${urls}\n` +
    '</urlset>\n'
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/sitemap.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Create robots.txt**

Create `frontend/public/robots.txt`:

```
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /publish/

Sitemap: https://www.chqcal.org/sitemap.xml
```

- [ ] **Step 6: Wire the sitemap plugin into the build**

In `frontend/vite.config.ts`, add the import near the top (after the existing imports):

```ts
import { buildSitemapXml, PUBLIC_PATHS } from './src/lib/sitemap';
```

Add this plugin function next to `emitVersionJson` (above `const APP_VERSION`):

```ts
// Emits out/sitemap.xml at build time from the canonical public route list.
function emitSitemapXml(): PluginOption {
  return {
    name: 'emit-sitemap-xml',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: buildSitemapXml(PUBLIC_PATHS),
      });
    },
  };
}
```

Then add it to the `plugins` array in `defineConfig`:

```ts
  plugins: [devServerMiddleware(), preact(), emitVersionJson(APP_VERSION), emitSitemapXml()],
```

- [ ] **Step 7: Verify the build emits both files**

Run: `cd frontend && npm run build`
Expected: build succeeds. Then:
Run: `cat out/robots.txt && echo '---' && cat out/sitemap.xml`
Expected: robots.txt contents as written; sitemap.xml lists `https://www.chqcal.org/` and `https://www.chqcal.org/feedback`, no admin/publish.

- [ ] **Step 8: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add frontend/src/lib/sitemap.ts frontend/src/lib/sitemap.test.ts frontend/public/robots.txt frontend/vite.config.ts
git commit -m "feat(seo): generate sitemap.xml at build + add robots.txt"
```

---

## Task 2: noindex the admin and publish entries

**Files:**
- Modify (add one `<meta>` to each `<head>`): the 14 gated entries listed below.
- Test: `frontend/src/__tests__/seoHtml.test.ts` (create)

**Interfaces:**
- Consumes: nothing. Produces: the `read()` helper reused by Tasks 3–4 in the same test file.

The 14 gated entries:
`admin/index.html`, `admin/login/index.html`, `admin/feedback/index.html`, `admin/publishers/index.html`, `admin/publisher-events/index.html`, `publish/index.html`, `publish/test/index.html`, `publish/apply/index.html`, `publish/docs/index.html`, `publish/verify/index.html`, `publish/login/index.html`, `publish/status/index.html`, `publish/email-change/verify/index.html`, `publish/email-change/cancel/index.html`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/seoHtml.test.ts`:

```ts
/// <reference types="vitest/globals" />
import { readFileSync } from 'fs';
import { join } from 'path';

// vitest runs with cwd = frontend/, so entry HTML files resolve from there.
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const GATED = [
  'admin/index.html',
  'admin/login/index.html',
  'admin/feedback/index.html',
  'admin/publishers/index.html',
  'admin/publisher-events/index.html',
  'publish/index.html',
  'publish/test/index.html',
  'publish/apply/index.html',
  'publish/docs/index.html',
  'publish/verify/index.html',
  'publish/login/index.html',
  'publish/status/index.html',
  'publish/email-change/verify/index.html',
  'publish/email-change/cancel/index.html',
];

const PUBLIC = ['index.html', 'feedback/index.html'];

describe('SEO: index gating', () => {
  it.each(GATED)('%s is noindex,nofollow', (f) => {
    expect(read(f)).toMatch(/<meta\s+name="robots"\s+content="noindex,\s*nofollow"\s*\/?>/);
  });

  it.each(PUBLIC)('%s is NOT noindexed', (f) => {
    expect(read(f)).not.toMatch(/content="noindex/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/seoHtml.test.ts`
Expected: FAIL — the 14 gated files have no robots meta yet.

- [ ] **Step 3: Add the meta tag to each gated entry**

In each of the 14 files, add this line inside `<head>`, immediately after the `<meta name="viewport" ... />` line:

```html
    <meta name="robots" content="noindex, nofollow" />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/seoHtml.test.ts`
Expected: PASS (16 assertions: 14 gated + 2 public).

- [ ] **Step 5: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add frontend/admin frontend/publish frontend/src/__tests__/seoHtml.test.ts
git commit -m "feat(seo): noindex admin and publish pages"
```

---

## Task 3: Homepage — canonical, crawlable content, JSON-LD

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/entries/main.tsx`
- Test: `frontend/src/__tests__/seoHtml.test.ts` (extend)

**Interfaces:**
- Consumes: `read()` from Task 2's test file.

- [ ] **Step 1: Write the failing tests (append to `seoHtml.test.ts`)**

```ts
describe('SEO: homepage', () => {
  const html = read('index.html');

  it('declares a canonical URL', () => {
    expect(html).toMatch(/<link\s+rel="canonical"\s+href="https:\/\/www\.chqcal\.org\/"\s*\/?>/);
  });

  it('has crawlable <h1> fallback content inside #root', () => {
    const root = html.match(/<div id="root">([\s\S]*?)<\/div>/);
    expect(root).toBeTruthy();
    expect(root![1]).toMatch(/<h1[^>]*>[\s\S]*Chautauqua[\s\S]*<\/h1>/);
    expect(root![1]).toMatch(/<p[^>]*>[\s\S]+<\/p>/);
  });

  it('embeds valid app-level JSON-LD including a WebSite', () => {
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    const data = JSON.parse(m![1]);
    const types = (Array.isArray(data) ? data : [data]).map((d) => d['@type']);
    expect(types).toContain('WebSite');
    // Must NOT describe individual events in Phase 1.
    expect(m![1]).not.toContain('"Event"');
  });

  it('has an absolute og:image', () => {
    expect(html).toMatch(/<meta\s+property="og:image"\s+content="https:\/\/www\.chqcal\.org\/[^"]+"/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/seoHtml.test.ts`
Expected: FAIL on the homepage block.

- [ ] **Step 3: Update `frontend/index.html`**

Add inside `<head>`, after the existing `og:*`/`twitter:*` block and before the `<link rel="icon" ...>` line:

```html
    <meta property="og:image" content="https://www.chqcal.org/icon-512.png" />
    <meta name="twitter:image" content="https://www.chqcal.org/icon-512.png" />
    <link rel="canonical" href="https://www.chqcal.org/" />
    <script type="application/ld+json">
    [
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": "Chautauqua Calendar",
        "url": "https://www.chqcal.org/",
        "description": "Filter, search, and export events from the Chautauqua Institution summer season."
      },
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "Chautauqua Calendar",
        "url": "https://www.chqcal.org/",
        "logo": "https://www.chqcal.org/icon-512.png"
      }
    ]
    </script>
```

Replace the empty `<div id="root"></div>` with fallback content (the author's own words — no event text):

```html
    <div id="root">
      <h1>Chautauqua Calendar</h1>
      <p>
        Browse, search, filter, and export events from the Chautauqua
        Institution summer season. Find talks, concerts, and worship by day,
        week, category, or venue, and add them to your own calendar.
      </p>
    </div>
```

- [ ] **Step 4: Clear `#root` before mounting so fallback can't duplicate**

In `frontend/src/entries/main.tsx`, replace the render line:

```ts
const root = document.getElementById('root')!;
root.replaceChildren(); // drop static SEO fallback before Preact mounts
render(<Home />, root);
```

- [ ] **Step 5: Run tests + build to verify**

Run: `cd frontend && npx vitest run src/__tests__/seoHtml.test.ts`
Expected: PASS.
Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Manual smoke — no duplicated content**

Run: `cd frontend && npm run dev` then open `http://localhost:3000`.
Expected: exactly one "Chautauqua Calendar" heading; the app renders normally with no leftover fallback paragraph. Stop the dev server when done.

- [ ] **Step 7: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add frontend/index.html frontend/src/entries/main.tsx frontend/src/__tests__/seoHtml.test.ts
git commit -m "feat(seo): homepage canonical, crawlable fallback content, and app JSON-LD"
```

---

## Task 4: Feedback page — canonical + social tag parity

**Files:**
- Modify: `frontend/feedback/index.html`
- Test: `frontend/src/__tests__/seoHtml.test.ts` (extend)

**Interfaces:**
- Consumes: `read()` from Task 2's test file.

- [ ] **Step 1: Write the failing tests (append to `seoHtml.test.ts`)**

```ts
describe('SEO: feedback page', () => {
  const html = read('feedback/index.html');

  it('declares its own canonical URL', () => {
    expect(html).toMatch(/<link\s+rel="canonical"\s+href="https:\/\/www\.chqcal\.org\/feedback"\s*\/?>/);
  });

  it('has Open Graph and Twitter card tags', () => {
    expect(html).toMatch(/<meta\s+property="og:title"\s+content="[^"]+"/);
    expect(html).toMatch(/<meta\s+name="twitter:card"\s+content="summary/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/seoHtml.test.ts`
Expected: FAIL on the feedback block.

- [ ] **Step 3: Update `frontend/feedback/index.html`**

Add inside `<head>`, after the existing `<meta name="description" ...>` line:

```html
    <link rel="canonical" href="https://www.chqcal.org/feedback" />
    <meta property="og:title" content="Feedback | Chautauqua Calendar" />
    <meta property="og:description" content="Share feedback and suggestions for the Chautauqua Calendar." />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://www.chqcal.org/feedback" />
    <meta property="og:image" content="https://www.chqcal.org/icon-512.png" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="Feedback | Chautauqua Calendar" />
    <meta name="twitter:description" content="Share feedback for the Chautauqua Calendar." />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/seoHtml.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add frontend/feedback/index.html frontend/src/__tests__/seoHtml.test.ts
git commit -m "feat(seo): canonical + social tags for feedback page"
```

---

## Task 5: Google Search Console handoff runbook

**Files:**
- Create: `docs/runbooks/search-console-setup.md`

**Interfaces:** none (documentation deliverable). This task has no automated test — its deliverable is a runbook the user follows manually, so the "test" is a completeness review of the steps.

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/search-console-setup.md`:

```markdown
# Runbook: Google Search Console setup for chqcal.org

**Owner:** site operator (requires Google account + DNS or S3 access).
**When:** after the Phase 1 SEO hygiene PR is deployed to production.

## 1. Add the property
1. Go to https://search.google.com/search-console and sign in.
2. Add property → choose **URL prefix** → enter `https://www.chqcal.org`.
   (URL-prefix is simpler than Domain; upgrade to a Domain property later if
   you want apex + subdomain coverage.)

## 2. Verify ownership (pick one)
- **HTML file (simplest here):** download the `googleXXXX.html` token file,
  place it at `frontend/public/googleXXXX.html`, commit, deploy, then click
  Verify. It is served at `https://www.chqcal.org/googleXXXX.html`.
- **DNS TXT (for a Domain property):** add the TXT record Google provides to
  the `chqcal.org` zone (Route 53 in `infrastructure/`), then Verify.

## 3. Submit the sitemap
1. In Search Console → **Sitemaps**.
2. Enter `sitemap.xml` and Submit. Confirm it reads `https://www.chqcal.org/sitemap.xml`
   and shows 2 discovered URLs.

## 4. Confirm crawl hygiene
1. Use **URL Inspection** on `https://www.chqcal.org/` → Request Indexing.
2. Inspect an admin URL (e.g. `https://www.chqcal.org/admin/`) → confirm it
   reports "Excluded by 'noindex' tag" or blocked by robots. That is expected.

## 5. Baseline
- Note the date. Impressions/clicks appear in the **Performance** report within
  a few days — this is the measurement baseline for whether Phase 1 worked and
  informs the Phase 2 decision.

## Related
- Design: `docs/superpowers/specs/2026-07-17-search-discoverability-hygiene-design.md`
- The verification token file (if used) lives in `frontend/public/` and is the
  ONLY Search-Console artifact that belongs in the repo.
```

- [ ] **Step 2: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add docs/runbooks/search-console-setup.md
git commit -m "docs(seo): Search Console setup runbook"
```

---

## Final verification (after all tasks)

- [ ] Run the full gate: `cd frontend && npm run build` — expect validate + `test:ci` (with coverage) + `vite build` all green.
- [ ] Confirm `out/robots.txt` and `out/sitemap.xml` exist with expected contents.
- [ ] Confirm `frontend/src/__tests__/seoHtml.test.ts` and `frontend/src/lib/sitemap.test.ts` both pass and coverage floor holds.
- [ ] Push the branch and open a PR (do not merge; the user merges). PR body should note: Phase 1 hygiene only; Phase 2 (crawlable event pages) deferred pending CHQ outreach.
```
