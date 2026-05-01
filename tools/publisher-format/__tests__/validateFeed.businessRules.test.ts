import * as fs from 'fs';
import * as path from 'path';
import { validateFeed } from '../src/validateFeed';

const fix = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));

describe('validateFeed (business rules)', () => {
  it('rejects unknown category', () => {
    const r = validateFeed(fix('invalid-bad-category.json'));
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === 'unknown-category')).toBe(true);
  });

  it('rejects both venueId and venue', () => {
    const r = validateFeed(fix('invalid-both-venues.json'));
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === 'venue-both')).toBe(true);
  });

  it('rejects endDate before startDate', () => {
    const r = validateFeed(fix('invalid-end-before-start.json'));
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === 'end-before-start')).toBe(true);
  });
});
