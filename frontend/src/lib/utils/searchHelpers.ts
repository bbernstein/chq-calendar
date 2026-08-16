import type { Event } from '@/lib/types';

/**
 * The term list `searchEvents` scores from.
 *
 * Splits on a literal single space, not general whitespace, so `"a\tb"` is
 * one term while `"a b"` is two. **This is the tokenization, not the whole
 * matching story**: `searchEvents` scores each term both as a verbatim
 * phrase and by splitting it again on `/\s+/` into words, so a tab does act
 * as a separator inside the lower-weight word pass. Do not read this
 * function as a summary of what matches.
 *
 * What it is good for is *identity*: every later stage is a pure function of
 * this array, so two raw strings with the same terms produce the same
 * results. Exported so callers needing that equivalence (a render-window
 * reset key) share this definition rather than writing a second normalizer
 * that could drift from it.
 */
export function searchTermsOf(term: string): string[] {
  return term.toLowerCase().split(' ').filter(t => t.length > 0);
}

export function searchEvents(events: Event[], term: string): Event[] {
  if (!term) return events;

  // Create search terms array from the input term
  const searchTerms = searchTermsOf(term);

  const scored = events.map(event => {
    // Ensure we're working with decoded strings for search
    const title = (event.title || '').toLowerCase();
    const description = (event.description || '').toLowerCase();
    const presenter = (event.presenter || '').toLowerCase();
    const location = (event.location || '').toLowerCase();

    // Combine all tags and categories for searching
    // Use pre-computed lowercase tags set for better performance
    const allTagsLower = event._tagsLowerSet || new Set([
      ...(event.tags || []),
      ...(event.categories?.map(cat => cat.name) || [])
    ].map(tag => tag.toLowerCase()));

    let score = 0;

    // Check all search terms (original + shortcuts)
    searchTerms.forEach(currentTerm => {
      // Exact phrase matches (highest priority)
      if (title.includes(currentTerm)) score += 100;
      if (location.includes(currentTerm)) score += 90;
      if (description.includes(currentTerm)) score += 50;
      if (presenter.includes(currentTerm)) score += 25;

      // Tag matching (including partial matches for Symphony Orchestra)
      allTagsLower.forEach(tag => {
        if (tag.includes(currentTerm)) score += 85;
      });

      // Word matches (lower priority)
      const words = currentTerm.split(/\s+/);
      words.forEach(word => {
        if (word.length > 2) { // Avoid matching very short words
          if (title.includes(word)) score += 10;
          if (location.includes(word)) score += 9;
          if (description.includes(word)) score += 5;
          if (presenter.includes(word)) score += 3;

          allTagsLower.forEach(tag => {
            if (tag.includes(word)) score += 7;
          });
        }
      });
    });

    return { event, score };
  });

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.event);
}
