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
