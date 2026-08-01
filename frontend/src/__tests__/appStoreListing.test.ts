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
    expect(fields.marketingUrl).toBe('https://www.chqcal.org');
    expect(fields.supportUrl).toBe('https://www.chqcal.org/support');
    expect(fields.privacyPolicyUrl).toBe('https://www.chqcal.org/privacy');
  });
});
