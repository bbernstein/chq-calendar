import type { FeedDocument, FeedEvent } from '../src/types';

describe('types module', () => {
  it('exports FeedDocument and FeedEvent', () => {
    const sample: FeedDocument = {
      formatVersion: '1.0',
      publisher: { id: 'x', name: 'X', contactEmail: 'x@example.org' },
      events: [],
    };
    const ev: FeedEvent = {
      id: 'a', title: 'A',
      startDate: '2026-07-04T18:00:00-04:00',
      endDate: '2026-07-04T19:00:00-04:00',
      category: 'Lecture',
      lastModified: '2026-05-01T12:00:00-04:00',
    };
    expect(sample.events.length).toBe(0);
    expect(ev.id).toBe('a');
  });
});
