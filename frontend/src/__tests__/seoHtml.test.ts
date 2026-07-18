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
