// `filterEvents` has no date stage and no week stage. Which part of the year
// the reader is looking at is a scroll position, not a filter (#274 phase 4),
// so what is left is search, venue, category and favourites.
//
// This file used to be almost entirely characterization of the date and week
// stages — four scope-specific predicates, then the `ViewWindow` range check
// that replaced them, then #257's day-granular week spans. All of it went
// with its subject. What survives here is coverage of the stages that are
// still in the pipeline, which had none of their own before.
import { describe, it, expect, vi } from 'vitest';
import { filterEvents, type FilterOptions } from '@/lib/utils/filterHelpers';
import type { Event } from '@/lib/types';

function makeEvent(id: string, date: Date, extra: Partial<Event> = {}): Event {
  return {
    id,
    title: `Event ${id}`,
    startDate: date.toISOString(),
    ...extra,
  } as Event;
}

function options(overrides: Partial<FilterOptions> = {}): FilterOptions {
  return {
    searchTerm: '',
    selectedTagsLowerSet: new Set<string>(),
    selectedLocationsLowerSet: new Set<string>(),
    ...overrides,
  };
}

const january = makeEvent('january', new Date(2026, 0, 12, 9, 0));
const july = makeEvent('july', new Date(2026, 6, 15, 9, 0));
const september = makeEvent('september', new Date(2026, 8, 20, 9, 0));

describe('filterEvents with no date stage (#274 phase 4)', () => {
  it('every event in the year is admitted when nothing is filtered', () => {
    const events = [january, july, september];
    expect(filterEvents(events, options())).toHaveLength(3);
  });

  // The date was the one thing that could have made these differ, and it is
  // gone: an event years outside the season is admitted exactly as readily as
  // one in the middle of it.
  it('admits an event years away from the season', () => {
    const far = makeEvent('far', new Date(2030, 0, 1, 9, 0));
    expect(filterEvents([far], options()).map(e => e.id)).toEqual(['far']);
  });

  it('never looks at startDate at all — an unparseable one is still admitted', () => {
    // Deliberate, and the reason `groupEventsByDay` grew the guard this
    // stage's deletion removed: filtering has no opinion about dates any
    // more, so a row with a broken `startDate` reaches the grouping step and
    // is dropped there, where it would otherwise have become an
    // "Invalid Date" day section.
    const bad = { id: 'bad', title: 'Event bad', startDate: 'garbage' } as Event;
    expect(filterEvents([bad], options()).map(e => e.id)).toEqual(['bad']);
  });
});

describe('filterEvents search stage', () => {
  it('narrows to matching events', () => {
    const events = [
      makeEvent('organ', new Date(2026, 6, 15, 9, 0), { title: 'Organ Recital' }),
      makeEvent('lecture', new Date(2026, 6, 15, 11, 0), { title: 'Morning Lecture' }),
    ];
    expect(filterEvents(events, options({ searchTerm: 'organ' })).map(e => e.id)).toEqual(['organ']);
  });

  it('runs no search pass at all for an empty term', () => {
    const events = [january, july];
    expect(filterEvents(events, options({ searchTerm: '' }))).toHaveLength(2);
  });
});

describe('filterEvents venue stage', () => {
  const amp = makeEvent('amp', new Date(2026, 6, 15, 9, 0), { location: 'Amphitheater' });
  const hop = makeEvent('hop', new Date(2026, 6, 15, 11, 0), { location: 'Hall of Philosophy' });
  const nowhere = makeEvent('nowhere', new Date(2026, 6, 15, 13, 0));

  it('matches case-insensitively', () => {
    const result = filterEvents([amp, hop], options({
      selectedLocationsLowerSet: new Set(['amphitheater']),
    }));
    expect(result.map(e => e.id)).toEqual(['amp']);
  });

  it('drops an event with no location once a venue is selected', () => {
    const result = filterEvents([amp, nowhere], options({
      selectedLocationsLowerSet: new Set(['amphitheater']),
    }));
    expect(result.map(e => e.id)).toEqual(['amp']);
  });

  it('ORs multiple selected venues', () => {
    const result = filterEvents([amp, hop, nowhere], options({
      selectedLocationsLowerSet: new Set(['amphitheater', 'hall of philosophy']),
    }));
    expect(result.map(e => e.id)).toEqual(['amp', 'hop']);
  });
});

describe('filterEvents category stage', () => {
  it('uses the pre-computed lowercase tag set when the event carries one', () => {
    const music = makeEvent('music', new Date(2026, 6, 15, 9, 0), {
      _tagsLowerSet: new Set(['music', 'evening']),
    });
    const lecture = makeEvent('lecture', new Date(2026, 6, 15, 11, 0), {
      _tagsLowerSet: new Set(['lecture']),
    });
    const result = filterEvents([music, lecture], options({
      selectedTagsLowerSet: new Set(['music']),
    }));
    expect(result.map(e => e.id)).toEqual(['music']);
  });

  it('falls back to tags and categories for an event with no pre-computed set', () => {
    const byTag = makeEvent('byTag', new Date(2026, 6, 15, 9, 0), { tags: ['Music'] });
    const byCategory = makeEvent('byCategory', new Date(2026, 6, 15, 10, 0), {
      categories: [{ name: 'Music' }],
    } as Partial<Event>);
    const neither = makeEvent('neither', new Date(2026, 6, 15, 11, 0), { tags: ['Dance'] });
    const result = filterEvents([byTag, byCategory, neither], options({
      selectedTagsLowerSet: new Set(['music']),
    }));
    expect(result.map(e => e.id)).toEqual(['byTag', 'byCategory']);
  });

  it('ANDs the category stage with the venue stage', () => {
    const both = makeEvent('both', new Date(2026, 6, 15, 9, 0), {
      location: 'Amphitheater', _tagsLowerSet: new Set(['music']),
    });
    const venueOnly = makeEvent('venueOnly', new Date(2026, 6, 15, 10, 0), {
      location: 'Amphitheater', _tagsLowerSet: new Set(['lecture']),
    });
    const result = filterEvents([both, venueOnly], options({
      selectedLocationsLowerSet: new Set(['amphitheater']),
      selectedTagsLowerSet: new Set(['music']),
    }));
    expect(result.map(e => e.id)).toEqual(['both']);
  });
});

describe('filterEvents favourites stage', () => {
  it('keeps only favourited events', () => {
    const result = filterEvents([january, july, september], options({
      showFavoritesOnly: true,
      favoriteIds: new Set(['july']),
    }));
    expect(result.map(e => e.id)).toEqual(['july']);
  });

  it('returns nothing when favourites-only is on with no favourites saved', () => {
    expect(filterEvents([january, july], options({
      showFavoritesOnly: true, favoriteIds: new Set<string>(),
    }))).toEqual([]);
    expect(filterEvents([january, july], options({
      showFavoritesOnly: true,
    }))).toEqual([]);
  });
});

describe('filterEvents does not mutate its input', () => {
  it('leaves the caller’s array alone', () => {
    const events = [january, july, september];
    const snapshot = [...events];
    filterEvents(events, options({ showFavoritesOnly: true, favoriteIds: new Set(['july']) }));
    expect(events).toEqual(snapshot);
  });
});

// Guards the import list itself: the merged date/week pass was the only
// thing in this module that parsed an event date, and it is what made
// `filterEvents` the second-most expensive thing in the pipeline.
describe('filterEvents parses no dates', () => {
  it('never touches startDate, even for a thousand events', () => {
    const events = Array.from({ length: 1000 }, (_, i) =>
      makeEvent(`e${i}`, new Date(2026, 6, 15, 9, 0)));
    const spy = vi.spyOn(Date.prototype, 'getTime');
    try {
      filterEvents(events, options({ selectedTagsLowerSet: new Set(['music']) }));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
