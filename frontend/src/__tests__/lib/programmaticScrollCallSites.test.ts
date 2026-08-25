import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Every scroll the app performs on the reader's behalf must announce itself.
 *
 * This is a source scan rather than a behavioural test because the failure it
 * guards is an omission, and an omission has no call site to assert on. The
 * header's reveal (#272) reads scroll direction; a jump that does not announce
 * itself reads as the largest scroll up the reader could possibly make, so a
 * single forgotten call site brings back the exact defect the announcement
 * exists to prevent — and only at that one call site, which is precisely the
 * kind of gap a behavioural suite passes straight over.
 *
 * `programmaticScroll.ts` itself is the one place `window.scrollBy` belongs.
 */

const SRC = resolve(__dirname, '..', '..');
// Built with `join`, not a literal: `relative()` returns backslashes on
// Windows, so a hard-coded slash would make the helper itself an offender AND
// make the sanity check below miss it — the guard would fail for the one
// reason it can never be right about.
const ALLOWED = join('lib', 'programmaticScroll.ts');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });

describe('programmatic scroll call sites', () => {
  it('routes every window.scrollBy through the announcing helper', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => relative(SRC, file) !== ALLOWED)
      .filter((file) => /window\.scrollBy\s*\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));

    expect(offenders).toEqual([]);
  });

  // The scan is only worth anything if it is looking at real files. A wrong
  // root, a changed extension filter or a directory walk that silently
  // returns nothing would make the assertion above vacuously true forever.
  it('is actually scanning the source tree', () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => relative(SRC, f) === ALLOWED)).toBe(true);
  });
});
