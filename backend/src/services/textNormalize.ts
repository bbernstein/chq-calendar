/**
 * Lowercase, strip punctuation/symbols to spaces, and collapse whitespace.
 * Shared by the matcher and the concept normalizer so both compare text the
 * same way. NOTE: this intentionally does NOT fold diacritics — see issue #138.
 */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
