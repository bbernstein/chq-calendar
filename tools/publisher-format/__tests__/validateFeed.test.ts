import * as fs from 'fs';
import * as path from 'path';
import { validateFeed } from '../src/validateFeed';

const fix = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));

describe('validateFeed (schema layer)', () => {
  it('accepts a fully valid feed', () => {
    const r = validateFeed(fix('valid-feed.json'));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects a missing publisher', () => {
    const r = validateFeed({ formatVersion: '1.0', events: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /publisher/.test(e.message) || e.path === '/')).toBe(true);
  });
});
