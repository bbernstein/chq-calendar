/**
 * Lowercase, fold diacritics to ASCII base letters, strip punctuation/symbols
 * to spaces, and collapse whitespace. Shared by the matcher and the concept
 * normalizer so both compare text the same way.
 *
 * Diacritic folding (NFD decomposition + stripping the resulting combining
 * marks) runs BEFORE the character-class replace so an accented letter becomes
 * its base letter ("Grgić" → "grgic", "Dvořák" → "dvorak") instead of splitting
 * the word on the accent ("dvor a k"). Without it, a Daily byline spelled with
 * accents never matched the ASCII presenter name in the event feed (issue #138).
 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // strip combining marks left by NFD decomposition
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
