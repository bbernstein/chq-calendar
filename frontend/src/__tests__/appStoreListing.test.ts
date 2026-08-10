// Enforces Apple's App Store Connect field limits against the single
// source of truth at docs/app-store/listing-fields.json, so a copy edit
// can never silently exceed a limit and get truncated in the portal.
//
// This file is extended in later tasks to also assert that the canonical
// disclaimer appears verbatim everywhere it is duplicated.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const FIELDS_PATH = resolve(__dirname, '../../../docs/app-store/listing-fields.json');

interface ListingFields {
  appName: string;
  subtitle: string;
  promotionalText: string;
  keywords: string;
  description: string;
  whatsNew: string;
  reviewNotes: string;
  disclaimer: string;
  copyright: string;
  primaryCategory: string;
  secondaryCategory: string;
  ageRating: string;
  marketingUrl: string;
  supportUrl: string;
  privacyPolicyUrl: string;
}

const fields: ListingFields = JSON.parse(readFileSync(FIELDS_PATH, 'utf8'));

// Apple's documented maximums for App Store Connect text fields.
const LIMITS: Record<string, number> = {
  appName: 30,
  subtitle: 30,
  promotionalText: 170,
  keywords: 100,
  description: 4000,
  whatsNew: 4000,
};

describe('App Store listing fields', () => {
  it.each(Object.entries(LIMITS))('%s is within Apple\'s %d character limit', (field, limit) => {
    const value = fields[field as keyof ListingFields];
    expect(value, `${field} is missing`).toBeTypeOf('string');
    expect(value.length, `${field} is ${value.length} chars, limit ${limit}`).toBeLessThanOrEqual(limit);
  });

  it('has no empty required fields', () => {
    for (const [key, value] of Object.entries(fields)) {
      expect(typeof value === 'string' && value.trim().length > 0, `${key} is empty`).toBe(true);
    }
  });

  it('keywords are comma-separated with no spaces after commas', () => {
    // App Store Connect counts spaces against the 100-char budget, so the
    // convention is comma-only separation.
    expect(fields.keywords).not.toMatch(/,\s/);
    expect(fields.keywords.split(',').every((k) => k.length > 0)).toBe(true);
  });

  it('does not repeat app name or subtitle words in keywords', () => {
    // Apple already indexes appName and subtitle; repeating those terms
    // wastes the 100-char keyword budget.
    const indexed = `${fields.appName} ${fields.subtitle}`.toLowerCase().match(/[a-z]+/g) ?? [];
    const keywords = fields.keywords.toLowerCase().split(',');
    for (const word of indexed) {
      expect(keywords, `"${word}" is already indexed via appName/subtitle`).not.toContain(word);
    }
  });

  it('description opens with the canonical disclaimer', () => {
    expect(fields.description.startsWith(fields.disclaimer)).toBe(true);
  });

  it('uses the chqcal.org URLs App Store Connect requires', () => {
    // The marketing URL points at the guide, not the calendar itself — a
    // visitor arriving from the App Store listing needs context before they
    // get dropped into a filtered event list.
    expect(fields.marketingUrl).toBe('https://www.chqcal.org/about');
    expect(fields.supportUrl).toBe('https://www.chqcal.org/support');
    expect(fields.privacyPolicyUrl).toBe('https://www.chqcal.org/privacy');
  });

  // Regression coverage: reviewNotes must not contradict the corrected
  // App Privacy posture (Usage Data / Product Interaction — Not Linked to
  // You, Not Used for Tracking). "The app collects no data" and "not used
  // for profiling" are both the specific wrong claims this project already
  // made and corrected once; see docs/app-store/privacy-nutrition-label.md.
  it('reviewNotes does not claim the app collects no data', () => {
    expect(fields.reviewNotes.toLowerCase()).not.toContain('collects no data');
  });

  it('reviewNotes does not deny profiling', () => {
    expect(fields.reviewNotes.toLowerCase()).not.toContain('not used for profiling');
  });

  it('reviewNotes discloses the aggregate visitor measurement', () => {
    const lower = fields.reviewNotes.toLowerCase();
    expect(lower, 'missing pseudonymous key disclosure').toContain('pseudonymous');
    expect(lower, 'missing aggregate framing').toContain('aggregate');
    expect(lower, 'missing unique/returning visitor disclosure').toContain(
      'unique and returning visitors'
    );
  });
});

// The canonical disclaimer is duplicated across languages that can't share
// a constant (JSON, TSX, Swift). These assertions are what stop the copies
// from drifting apart — a drifted disclaimer weakens the Guideline 5.2.1
// position that the whole submission rests on.
describe('canonical disclaimer is duplicated verbatim', () => {
  const repoRoot = resolve(__dirname, '../../..');
  const sources = [
    'frontend/src/app/privacy/page.tsx',
    'frontend/src/app/support/page.tsx',
    'frontend/src/app/page.tsx',
    'frontend/src/app/about/AboutLayout.tsx',
    'ios/ChqCalendar/Features/About/AboutInfo.swift',
  ];

  // JSX splits long prose across lines, so compare on collapsed whitespace
  // rather than requiring the literal string to survive the formatter.
  const collapse = (s: string) => s.replace(/\s+/g, ' ');

  it.each(sources)('%s contains the disclaimer', (relPath) => {
    const source = collapse(readFileSync(resolve(repoRoot, relPath), 'utf8'));
    expect(source).toContain(collapse(fields.disclaimer));
  });
});
