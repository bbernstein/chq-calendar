import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { FEED_JSON_SCHEMA } from '../src/schema';

describe('feed.schema.json', () => {
  it('compiles with Ajv', () => {
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(FEED_JSON_SCHEMA);
    expect(typeof validate).toBe('function');
  });

  it('accepts a minimal valid feed', () => {
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(FEED_JSON_SCHEMA);
    const ok = validate({
      formatVersion: '1.0',
      publisher: { id: 'pub', name: 'Pub', contactEmail: 'a@b.com' },
      events: [],
    });
    expect(ok).toBe(true);
  });

  it('rejects naive (no-offset) datetimes', () => {
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(FEED_JSON_SCHEMA);
    const ok = validate({
      formatVersion: '1.0',
      publisher: { id: 'pub', name: 'Pub', contactEmail: 'a@b.com' },
      events: [{
        id: 'e1', title: 'E',
        startDate: '2026-07-04T18:00:00',
        endDate:   '2026-07-04T19:00:00',
        category: 'Lecture',
        lastModified: '2026-05-01T12:00:00-04:00',
      }],
    });
    expect(ok).toBe(false);
  });
});
