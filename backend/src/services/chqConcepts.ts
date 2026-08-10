import { normalize } from './textNormalize';

/**
 * A Chautauqua program/venue "concept" and the ways it is written.
 *
 * - `key`         stable concept id used only for comparison.
 * - `surfaces`    forms that appear in STRUCTURED fields (event category
 *                 names, article WP categories, article tags). Safe to match
 *                 as whole space-delimited phrases — includes acronyms and
 *                 unambiguous single words (e.g. "symphony", "opera").
 * - `bodyPhrases` multi-word canonical forms safe to search for in free-text
 *                 prose. NEVER single generic words — that is why prose
 *                 corroboration cannot fire on a passing mention of "symphony".
 *
 * Seeded from the venueMap in eventTransformationService.ts and extended to
 * the real event category vocabulary. Add an entry when a new program needs
 * acronym/short-form bridging.
 *
 * This list is intentionally maintained by hand and is allowed to diverge
 * from that venueMap: this maps PROGRAMS (for article↔event category
 * matching), while venueMap also carries pure venue abbreviations (amp, hop,
 * hoc) that are not programs and deliberately have no concept here. Keep only
 * surface forms you can confirm name the same program — do not merge two
 * distinct organizations under one key.
 */
interface Concept {
  key: string;
  surfaces: string[];
  bodyPhrases: string[];
}

const CONCEPTS: Concept[] = [
  {
    key: 'cso',
    surfaces: ['cso', 'symphony', 'chautauqua symphony orchestra', 'classical concerts'],
    bodyPhrases: ['chautauqua symphony orchestra'],
  },
  {
    key: 'ctc',
    surfaces: ['ctc', 'chautauqua theater company'],
    bodyPhrases: ['chautauqua theater company'],
  },
  {
    key: 'clsc',
    surfaces: ['clsc', 'literary and scientific circle', 'chautauqua literary and scientific circle'],
    bodyPhrases: ['literary and scientific circle'],
  },
  {
    key: 'ciwl',
    surfaces: ['ciwl', 'chautauqua institution womens league'],
    bodyPhrases: ['chautauqua institution womens league'],
  },
  {
    key: 'opera',
    surfaces: ['opera', 'chautauqua opera company'],
    bodyPhrases: ['chautauqua opera company'],
  },
  {
    key: 'school-of-music',
    surfaces: ['msfo', 'school of music', 'music school festival orchestra'],
    bodyPhrases: ['music school festival orchestra', 'school of music'],
  },
  {
    key: 'chamber-music',
    surfaces: ['chamber music'],
    bodyPhrases: ['chamber music'],
  },
  {
    key: 'interfaith',
    surfaces: ['interfaith', 'interfaith lecture series'],
    bodyPhrases: ['interfaith lecture series'],
  },
  {
    key: 'dance',
    surfaces: ['dance', 'chautauqua dance'],
    bodyPhrases: ['chautauqua dance'],
  },
];

/** True when `haystack` contains `needle` as a whole space-delimited phrase. */
function containsPhrase(paddedHaystack: string, needle: string): boolean {
  return paddedHaystack.includes(` ${needle} `);
}

/**
 * Concept keys a structured category/tag string maps to. Normalizes its own
 * input; matches surface forms as whole phrases.
 */
export function conceptsFor(text: string): Set<string> {
  const padded = ` ${normalize(text)} `;
  const keys = new Set<string>();
  for (const c of CONCEPTS) {
    if (c.surfaces.some(s => containsPhrase(padded, s))) keys.add(c.key);
  }
  return keys;
}

/**
 * Concept keys whose multi-word bodyPhrases appear in prose. Expects an
 * already-normalized, space-padded string (e.g. ` ${normalize(body)} `).
 */
export function conceptsInBody(normalizedPaddedBody: string): Set<string> {
  const keys = new Set<string>();
  for (const c of CONCEPTS) {
    if (c.bodyPhrases.some(p => containsPhrase(normalizedPaddedBody, p))) keys.add(c.key);
  }
  return keys;
}
