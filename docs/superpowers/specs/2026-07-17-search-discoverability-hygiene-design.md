# Search Discoverability — Phase 1 Hygiene (Design)

**Date:** 2026-07-17
**Status:** Approved for implementation (Phase 1 only)
**Author:** brainstorming session

## Goal

Make chqcal.org legible and measurable to search engines, and improve how
shared links unfurl — **without** doing anything that targets Chautauqua
Institution's brand queries or exposes their copyrighted event prose on
crawlable pages. This is the "safe now" half of a two-phase plan.

## Context & Constraints

- **Relationship with CHQ:** unofficial; the Institution is not aware of the
  app. Growth is currently word-of-mouth inside the community.
- **Key strategic tension:** ranking well for Chautauqua-related queries is
  precisely how the Institution would discover the app. Phase 1 is therefore
  scoped to be *defensible and low-profile*: crawl hygiene, measurement, and
  better link-sharing — nothing that ranks against chq.org or republishes their
  marketing text at scale.
- **Current SEO state (as found 2026-07-17):**
  - No `robots.txt`, no `sitemap.xml`.
  - No `rel=canonical` on any page.
  - No structured data (JSON-LD) anywhere.
  - `/admin/*` and `/publish/*` are **fully crawlable** — the one active
    problem.
  - OG/Twitter tags exist only on `index.html`; other public pages have bare
    heads.
  - The homepage renders no content until JS fetches `all-events.json`; a
    crawler or social unfurl hitting the raw HTML sees an empty `#root`.
- **Architecture constraints (from CLAUDE.md):** static Vite + Preact MPA to
  S3/CloudFront; `frontend/public/` is served at site root; each page is its own
  HTML entry. No SSR.

## Out of Scope (Phase 2 — deferred, decide after contacting CHQ)

Documented here as an explicit decision-point, **not built** in this phase:

- Crawlable per-event / per-week URLs (the real ranking unlock — and the
  aggressive move).
- `Event` JSON-LD + prerendered event content (requires a decision on how much
  CHQ prose appears on indexable pages).
- Deliberate targeting of brand queries ("chautauqua institution schedule").
- Shareable deep-links: explicitly **excluded from Phase 1** by decision. When
  built, they may start as `noindex` for app-sharing UX and flip to indexable
  as part of the Phase 2 decision.

## Phase 1 Scope — Eight Items

1. **`robots.txt`** (`frontend/public/robots.txt`)
   - `Allow` the root; `Disallow: /admin/` and `Disallow: /publish/`.
   - `Sitemap:` line pointing at `https://www.chqcal.org/sitemap.xml`.

2. **`noindex` on admin/publish entries**
   - Add `<meta name="robots" content="noindex, nofollow" />` to the `<head>`
     of every `admin/**/index.html` and `publish/**/index.html` entry.
   - Belt-and-suspenders: robots.txt blocks crawling, but a URL discovered by
     other means can still be indexed without the meta tag.

3. **`sitemap.xml`**
   - Generated at build time (mirrors the existing `emitVersionJson` Vite
     plugin pattern in `vite.config.ts`) so it stays honest and auto-grows if
     Phase 2 adds URLs.
   - Phase 1 contents: the public pages only — `/` and `/feedback`.
   - Emit to `out/sitemap.xml`.

4. **`rel=canonical`**
   - Add `<link rel="canonical" href="https://www.chqcal.org/" />` to the
     homepage and the matching absolute URL to `/feedback`.
   - Prevents filter query-strings (`?category=…`, `?week=…`) from fragmenting
     into duplicate indexed URLs.

5. **Static content fallback in `index.html`**
   - Put a real `<h1>` and a short paragraph of original prose *about the app*
     inside `#root`, which Preact replaces on mount.
   - Content describes the tool ("filter, search, and export Chautauqua
     Institution's summer season events…") — the author's own words, **no
     scraped event text**, zero copyright exposure.
   - Gives crawlers and social unfurls immediate content on the raw HTML.

6. **`WebSite` + `Organization` JSON-LD** on the homepage
   - Describes the application itself, not events.
   - Deliberately excludes `Event` structured data (that is Phase 2).

7. **Consistent OG/Twitter tags across public pages**
   - Ensure `/` and `/feedback` both have complete OG + Twitter card tags so
     shared links unfurl cleanly. This directly supports the existing
     word-of-mouth growth channel.
   - Add an OG image reference (existing icon asset is acceptable for Phase 1).

8. **Google Search Console — handoff**
   - Prepare everything; the **user** performs verification (DNS TXT record or
     HTML-file token) and submits the sitemap, since it requires account/domain
     access.
   - This is the primary "let Google find it" + measurement step.

## Parallel, Non-Code Track (user-owned)

- **Outreach to CHQ.** The user will contact the Institution in parallel. A
  friendly "I built a thing your community already uses; I'd like your
  blessing" note, ideally *before* the app ranks. A link from chq.org would
  outweigh every technical item here and converts the main risk into an asset.
  Claude can draft this on request; sending is the user's decision.

## Testing / Verification

- Build (`npm run build`) succeeds; `out/robots.txt` and `out/sitemap.xml`
  exist with expected contents.
- Unit test for the sitemap generator plugin (URL list, valid XML).
- Snapshot/DOM assertion that admin/publish HTML entries contain the `noindex`
  meta, and that public entries do **not**.
- Validate JSON-LD parses and is schema-valid (a small test asserting the
  `@type` and required fields).
- Manual: view-source on built `index.html` shows the static `<h1>`/paragraph
  and canonical tag; run the page URL through a rich-results / OG debugger after
  deploy.

## Success Criteria

- Admin/publish pages no longer indexable.
- Homepage has crawlable content + canonical + valid structured data.
- Sitemap and robots.txt live and submitted to Search Console.
- Search Console begins reporting impressions (measurement baseline
  established) — the signal that "Google can find it" is now true.
