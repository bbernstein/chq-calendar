jest.unmock('@aws-sdk/lib-dynamodb');

import { PublisherEventStore } from '../services/publisherEventStore';
import type { StoredPublisherEvent } from '../types/publisher';

const mockSend = jest.fn();
const mockClient: any = { send: mockSend };

describe('PublisherEventStore', () => {
  let store: PublisherEventStore;
  beforeEach(() => {
    jest.resetAllMocks();
    store = new PublisherEventStore(mockClient, 'chq-publisher-events');
  });

  it('listForPublisher queries by publisherId', async () => {
    mockSend.mockResolvedValue({ Items: [{ publisherId: 'p', eventId: 'e1', state: 'published' }] });
    const r = await store.listForPublisher('p');
    expect(r).toHaveLength(1);
    expect(r[0].eventId).toBe('e1');
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.KeyConditionExpression).toContain('publisherId');
    expect(cmd.input.ExpressionAttributeValues[':p']).toBe('p');
  });

  it('listForPublisher paginates through LastEvaluatedKey', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [{ publisherId: 'p', eventId: 'e1', state: 'published' }], LastEvaluatedKey: { x: 1 } })
      .mockResolvedValueOnce({ Items: [{ publisherId: 'p', eventId: 'e2', state: 'published' }] });
    const r = await store.listForPublisher('p');
    expect(r).toHaveLength(2);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('applyDiff issues TransactWriteItems with inserts + updates + deletes', async () => {
    mockSend.mockResolvedValue({});
    const ins: StoredPublisherEvent = {
      publisherId: 'p', eventId: 'i1', startDate: 's', endDate: 'e', lastModified: 'm',
      payload: {} as any, state: 'published', updatedAt: 'u',
    };
    const upd: StoredPublisherEvent = { ...ins, eventId: 'u1' };
    const rem: StoredPublisherEvent = { ...ins, eventId: 'r1' };
    await store.applyDiff({ inserts: [ins], updates: [upd], removals: [rem], unchanged: 0 });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.TransactItems).toHaveLength(3);
    expect(cmd.input.TransactItems[0].Put).toBeDefined();
    expect(cmd.input.TransactItems[2].Delete).toBeDefined();
  });

  it('applyDiff with empty diff does not call DynamoDB', async () => {
    await store.applyDiff({ inserts: [], updates: [], removals: [], unchanged: 5 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('applyDiff chunks at 100 items per transaction', async () => {
    mockSend.mockResolvedValue({});
    const ins: StoredPublisherEvent = {
      publisherId: 'p', eventId: 'i', startDate: 's', endDate: 'e', lastModified: 'm',
      payload: {} as any, state: 'published', updatedAt: 'u',
    };
    const items = Array.from({ length: 150 }, (_, i) => ({ ...ins, eventId: `e${i}` }));
    await store.applyDiff({ inserts: items, updates: [], removals: [], unchanged: 0 });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('listAllPublished queries the by-state GSI', async () => {
    mockSend.mockResolvedValue({ Items: [{ publisherId: 'p', eventId: 'e1', state: 'published' }] });
    const r = await store.listAllPublished();
    expect(r).toHaveLength(1);
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.IndexName).toBe('by-state');
    expect(cmd.input.ExpressionAttributeValues[':s']).toBe('published');
  });
});
