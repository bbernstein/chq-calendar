/// <reference types="vitest/globals" />
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'node:url';

// Resolve entry HTML relative to this test file (frontend/src/__tests__/),
// so assertions are stable regardless of the process working directory.
const FRONTEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string) => readFileSync(join(FRONTEND_ROOT, rel), 'utf8');

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
