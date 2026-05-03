jest.unmock('@aws-sdk/client-s3');

import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { PublisherSidecarPublisher } from '../services/publisherSidecarPublisher';
import type { StoredPublisherEvent } from '../types/publisher';

const mockSend = jest.fn();
const mockS3: any = { send: mockSend };

function mockListReturns(...years: number[]): void {
  const Contents = years.map(y => ({ Key: `cache/calendar-cache/publisher-events-${y}.json` }));
  mockSend.mockImplementation((cmd: any) => {
    if (cmd instanceof ListObjectsV2Command) return Promise.resolve({ Contents });
    return Promise.resolve({});
  });
}

const ev = (id: string, year = 2026, state: 'published' | 'pending' = 'published'): StoredPublisherEvent => ({
  publisherId: 'p',
  eventId: id,
  startDate: `${year}-07-04T18:00:00-04:00`,
  endDate: `${year}-07-04T19:00:00-04:00`,
  lastModified: 't',
  payload: {
    id,
    title: id,
    startDate: `${year}-07-04T18:00:00-04:00`,
    endDate: `${year}-07-04T19:00:00-04:00`,
    category: 'Lecture',
    lastModified: 't',
    sourcePublisherId: 'p',
    sourcePublisherName: 'P',
  } as any,
  state,
  updatedAt: 't',
});

describe('PublisherSidecarPublisher', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('groups by year and writes one object per year', async () => {
    mockListReturns();
    const pub = new PublisherSidecarPublisher(mockS3, 'bucket', 'cache/calendar-cache');
    await pub.publish([ev('a', 2026), ev('b', 2026), ev('c', 2027)]);
    const puts = mockSend.mock.calls.filter(c => c[0] instanceof PutObjectCommand);
    expect(puts).toHaveLength(2);
  });

  it('writes nothing for empty input when no existing sidecars', async () => {
    mockListReturns();
    const pub = new PublisherSidecarPublisher(mockS3, 'bucket', 'cache/calendar-cache');
    await pub.publish([]);
    const puts = mockSend.mock.calls.filter(c => c[0] instanceof PutObjectCommand);
    const deletes = mockSend.mock.calls.filter(c => c[0] instanceof DeleteObjectCommand);
    expect(puts).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });

  it('writes nothing for the body when no events are in published state', async () => {
    mockListReturns();
    const pub = new PublisherSidecarPublisher(mockS3, 'bucket', 'cache/calendar-cache');
    await pub.publish([ev('a', 2026, 'pending'), ev('b', 2027, 'pending')]);
    const puts = mockSend.mock.calls.filter(c => c[0] instanceof PutObjectCommand);
    expect(puts).toHaveLength(0);
  });

  it('uses correct S3 key shape', async () => {
    mockListReturns();
    const pub = new PublisherSidecarPublisher(mockS3, 'bucket', 'cache/calendar-cache');
    await pub.publish([ev('a', 2026)]);
    const putCall = mockSend.mock.calls.find(c => c[0] instanceof PutObjectCommand);
    expect(putCall).toBeDefined();
    const cmd: any = putCall![0];
    expect(cmd.input.Bucket).toBe('bucket');
    expect(cmd.input.Key).toBe('cache/calendar-cache/publisher-events-2026.json');
    expect(cmd.input.ContentType).toBe('application/json');
    const body = JSON.parse(cmd.input.Body as string);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('a');
  });

  it('only includes published events in the body', async () => {
    mockListReturns();
    const pub = new PublisherSidecarPublisher(mockS3, 'bucket', 'cache/calendar-cache');
    await pub.publish([ev('a', 2026, 'published'), ev('b', 2026, 'pending')]);
    const putCall = mockSend.mock.calls.find(c => c[0] instanceof PutObjectCommand);
    const cmd: any = putCall![0];
    const body = JSON.parse(cmd.input.Body as string);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('a');
  });

  it('deletes a stale sidecar when its year drops to zero published events', async () => {
    mockListReturns(2025, 2026);
    const pub = new PublisherSidecarPublisher(mockS3, 'bucket', 'cache/calendar-cache');
    await pub.publish([ev('a', 2026)]);
    const deletes = mockSend.mock.calls.filter(c => c[0] instanceof DeleteObjectCommand);
    expect(deletes).toHaveLength(1);
    const cmd: any = deletes[0][0];
    expect(cmd.input.Key).toBe('cache/calendar-cache/publisher-events-2025.json');
  });

  it('deletes all sidecars when all published events are removed', async () => {
    mockListReturns(2025, 2026, 2027);
    const pub = new PublisherSidecarPublisher(mockS3, 'bucket', 'cache/calendar-cache');
    await pub.publish([]);
    const deletes = mockSend.mock.calls.filter(c => c[0] instanceof DeleteObjectCommand);
    expect(deletes).toHaveLength(3);
  });

  describe('venue resolution', () => {
    const venueEvent = (overrides: Record<string, unknown> = {}): StoredPublisherEvent => ({
      ...ev('venue-evt', 2026, 'published'),
      payload: {
        id: 'venue-evt',
        title: 'Venue Evt',
        startDate: '2026-07-04T18:00:00-04:00',
        endDate: '2026-07-04T19:00:00-04:00',
        category: 'Lecture',
        lastModified: 't',
        sourcePublisherId: 'p',
        sourcePublisherName: 'P',
        venueId: 'hall-of-philosophy',
        ...overrides,
      } as any,
    });

    function getPayload(): any {
      const putCall = mockSend.mock.calls.find(c => c[0] instanceof PutObjectCommand);
      const body = JSON.parse((putCall![0] as any).input.Body as string);
      return body.data[0];
    }

    it('resolves venueId to location and venue when a lookup is provided', async () => {
      mockListReturns();
      const venuesById = new Map([
        ['hall-of-philosophy', { id: 'hall-of-philosophy', name: 'Hall of Philosophy', address: '34 South Ave' }],
      ]);
      const pub = new PublisherSidecarPublisher(mockS3, 'bucket', 'cache/calendar-cache', venuesById);
      await pub.publish([venueEvent()]);
      const p = getPayload();
      expect(p.location).toBe('Hall of Philosophy');
      expect(p.venue).toEqual({ name: 'Hall of Philosophy', address: '34 South Ave' });
    });

    it('leaves payload unchanged when venueId is unknown', async () => {
      mockListReturns();
      const pub = new PublisherSidecarPublisher(mockS3, 'bucket', 'cache/calendar-cache', new Map());
      await pub.publish([venueEvent({ venueId: 'unknown-venue' })]);
      const p = getPayload();
      expect(p.location).toBeUndefined();
      expect(p.venue).toBeUndefined();
    });

    it('does not overwrite an explicit publisher-supplied location', async () => {
      mockListReturns();
      const venuesById = new Map([
        ['hall-of-philosophy', { id: 'hall-of-philosophy', name: 'Hall of Philosophy' }],
      ]);
      const pub = new PublisherSidecarPublisher(mockS3, 'bucket', 'cache/calendar-cache', venuesById);
      await pub.publish([venueEvent({ location: 'Custom Location Override' })]);
      const p = getPayload();
      expect(p.location).toBe('Custom Location Override');
      // venue object still gets attached
      expect(p.venue).toEqual({ name: 'Hall of Philosophy' });
    });

    it('omits venue.address when the lookup has no address', async () => {
      mockListReturns();
      const venuesById = new Map([
        ['hall-of-philosophy', { id: 'hall-of-philosophy', name: 'Hall of Philosophy' }],
      ]);
      const pub = new PublisherSidecarPublisher(mockS3, 'bucket', 'cache/calendar-cache', venuesById);
      await pub.publish([venueEvent()]);
      const p = getPayload();
      expect(p.venue).toEqual({ name: 'Hall of Philosophy' });
    });

    it('preserves publisher-supplied venue fields (e.g. url) when merging the lookup', async () => {
      mockListReturns();
      const venuesById = new Map([
        ['hall-of-philosophy', { id: 'hall-of-philosophy', name: 'Hall of Philosophy', address: '34 South Ave' }],
      ]);
      const pub = new PublisherSidecarPublisher(mockS3, 'bucket', 'cache/calendar-cache', venuesById);
      await pub.publish([
        venueEvent({
          venue: { name: 'Custom Hall', url: 'https://example.com/hall' },
        }),
      ]);
      const p = getPayload();
      // Publisher's venue.name + url survive; address is supplied by the lookup.
      expect(p.venue).toEqual({
        name: 'Custom Hall',
        url: 'https://example.com/hall',
        address: '34 South Ave',
      });
    });

    it('passes through events with no venueId unchanged', async () => {
      mockListReturns();
      const venuesById = new Map([
        ['hall-of-philosophy', { id: 'hall-of-philosophy', name: 'Hall of Philosophy' }],
      ]);
      const pub = new PublisherSidecarPublisher(mockS3, 'bucket', 'cache/calendar-cache', venuesById);
      await pub.publish([venueEvent({ venueId: undefined })]);
      const p = getPayload();
      expect(p.location).toBeUndefined();
      expect(p.venue).toBeUndefined();
    });
  });
});
