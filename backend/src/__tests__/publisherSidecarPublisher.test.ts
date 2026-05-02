jest.unmock('@aws-sdk/client-s3');

import { PublisherSidecarPublisher } from '../services/publisherSidecarPublisher';
import type { StoredPublisherEvent } from '../types/publisher';

const mockSend = jest.fn();
const mockS3: any = { send: mockSend };

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
    const pub = new PublisherSidecarPublisher(mockS3, 'bucket', 'cache/calendar-cache');
    await pub.publish([ev('a', 2026), ev('b', 2026), ev('c', 2027)]);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('writes nothing for empty input', async () => {
    const pub = new PublisherSidecarPublisher(mockS3, 'bucket', 'cache/calendar-cache');
    await pub.publish([]);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('writes nothing when no events are in published state', async () => {
    const pub = new PublisherSidecarPublisher(mockS3, 'bucket', 'cache/calendar-cache');
    await pub.publish([ev('a', 2026, 'pending'), ev('b', 2027, 'pending')]);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('uses correct S3 key shape', async () => {
    mockSend.mockResolvedValue({});
    const pub = new PublisherSidecarPublisher(mockS3, 'bucket', 'cache/calendar-cache');
    await pub.publish([ev('a', 2026)]);
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.Bucket).toBe('bucket');
    expect(cmd.input.Key).toBe('cache/calendar-cache/publisher-events-2026.json');
    expect(cmd.input.ContentType).toBe('application/json');
    const body = JSON.parse(cmd.input.Body as string);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('a');
  });

  it('only includes published events in the body', async () => {
    mockSend.mockResolvedValue({});
    const pub = new PublisherSidecarPublisher(mockS3, 'bucket', 'cache/calendar-cache');
    await pub.publish([ev('a', 2026, 'published'), ev('b', 2026, 'pending')]);
    const cmd: any = mockSend.mock.calls[0][0];
    const body = JSON.parse(cmd.input.Body as string);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('a');
  });
});
