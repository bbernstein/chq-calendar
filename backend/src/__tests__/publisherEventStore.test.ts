jest.unmock('@aws-sdk/lib-dynamodb');

import { PublisherEventStore, PublisherDeletedDuringApplyError } from '../services/publisherEventStore';
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

  it('countForPublisher issues a Select=COUNT Query and sums Count across pages', async () => {
    mockSend
      .mockResolvedValueOnce({ Count: 7, LastEvaluatedKey: { x: 1 } })
      .mockResolvedValueOnce({ Count: 4 });
    const total = await store.countForPublisher('p');
    expect(total).toBe(11);
    expect(mockSend).toHaveBeenCalledTimes(2);
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.KeyConditionExpression).toContain('publisherId');
    expect(cmd.input.ExpressionAttributeValues[':p']).toBe('p');
    expect(cmd.input.Select).toBe('COUNT');
    // The COUNT query MUST NOT request items — that would defeat the point.
    // DDB returns Count only when Select='COUNT'; the Items array (if
    // present) is empty in that mode.
  });

  it('countForPublisher returns 0 when DDB reports Count=0 with no pagination', async () => {
    mockSend.mockResolvedValueOnce({ Count: 0 });
    expect(await store.countForPublisher('p')).toBe(0);
  });

  it('countForPublisher tolerates an absent Count field (treats as 0)', async () => {
    // Defensive: the SDK's typing has Count optional. Make sure we don't
    // NaN out if a stub or a future SDK version omits it.
    mockSend.mockResolvedValueOnce({});
    expect(await store.countForPublisher('p')).toBe(0);
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

  it('deleteAllForPublisher is a no-op when no events exist', async () => {
    mockSend.mockResolvedValue({ Items: [] });
    const n = await store.deleteAllForPublisher('p');
    expect(n).toBe(0);
    // Only the list query, no TransactWrite
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('deleteAllForPublisher issues a single TransactWrite with all event keys', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          { publisherId: 'p', eventId: 'e1', state: 'published' },
          { publisherId: 'p', eventId: 'e2', state: 'published' },
        ],
      })
      .mockResolvedValueOnce({});
    const n = await store.deleteAllForPublisher('p');
    expect(n).toBe(2);
    expect(mockSend).toHaveBeenCalledTimes(2);
    const txn: any = mockSend.mock.calls[1][0];
    expect(txn.input.TransactItems).toHaveLength(2);
    expect(txn.input.TransactItems[0].Delete.Key).toEqual({ publisherId: 'p', eventId: 'e1' });
    expect(txn.input.TransactItems[1].Delete.Key).toEqual({ publisherId: 'p', eventId: 'e2' });
  });

  it('deleteAllForPublisher chunks at 100 keys per TransactWrite', async () => {
    const items = Array.from({ length: 250 }, (_, i) => ({
      publisherId: 'p', eventId: `e${i}`, state: 'published',
    }));
    mockSend
      .mockResolvedValueOnce({ Items: items })
      .mockResolvedValue({});
    const n = await store.deleteAllForPublisher('p');
    expect(n).toBe(250);
    // 1 list call + ceil(250/100) = 3 transact calls = 4 total
    expect(mockSend).toHaveBeenCalledTimes(4);
  });

  it('listAllPublished queries the by-state GSI', async () => {
    mockSend.mockResolvedValue({ Items: [{ publisherId: 'p', eventId: 'e1', state: 'published' }] });
    const r = await store.listAllPublished();
    expect(r).toHaveLength(1);
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.IndexName).toBe('by-state');
    expect(cmd.input.ExpressionAttributeValues[':s']).toBe('published');
  });

  describe('applyDiff with requirePublisher', () => {
    const evt = (eventId: string): StoredPublisherEvent => ({
      publisherId: 'p1',
      eventId,
      startDate: '2026-07-01T00:00:00-04:00',
      endDate: '2026-07-01T01:00:00-04:00',
      lastModified: '2026-05-01T00:00:00.000Z',
      payload: {} as any,
      state: 'published',
      updatedAt: '2026-05-01T00:00:00.000Z',
    });

    it('prepends a ConditionCheck on the publisher row to every transaction batch', async () => {
      mockSend.mockResolvedValue({});
      await store.applyDiff(
        { inserts: [evt('e1')], updates: [], removals: [], unchanged: 0 },
        { requirePublisher: { tableName: 'chq-publishers', id: 'p1' } },
      );
      const cmd: any = mockSend.mock.calls[0][0];
      const items = cmd.input.TransactItems;
      expect(items[0].ConditionCheck).toBeDefined();
      expect(items[0].ConditionCheck.TableName).toBe('chq-publishers');
      expect(items[0].ConditionCheck.Key).toEqual({ id: 'p1' });
      expect(items[0].ConditionCheck.ConditionExpression).toBe('attribute_exists(id)');
      expect(items[1].Put.Item.eventId).toBe('e1');
    });

    it('throws PublisherDeletedDuringApplyError when the FIRST reason is ConditionalCheckFailed', async () => {
      // The ConditionCheck on the publisher row is always the first item
      // we attach when requirePublisher is set, so the corresponding
      // CancellationReasons entry is also at index 0.
      const cancelErr = Object.assign(new Error('canceled'), {
        name: 'TransactionCanceledException',
        CancellationReasons: [
          { Code: 'ConditionalCheckFailed', Message: 'attribute_exists(id) failed' },
          { Code: 'None' },
        ],
      });
      mockSend.mockRejectedValue(cancelErr);
      await expect(
        store.applyDiff(
          { inserts: [evt('e1')], updates: [], removals: [], unchanged: 0 },
          { requirePublisher: { tableName: 'chq-publishers', id: 'p1' } },
        ),
      ).rejects.toBeInstanceOf(PublisherDeletedDuringApplyError);
    });

    it('does NOT wrap TransactionCanceledException when the cause is something other than ConditionalCheckFailed', async () => {
      // Concurrent-write race / throughput exhaustion / etc. raise the
      // same exception class but for an entirely different reason. Wrapping
      // those as "publisher deleted" would silently drop legitimate updates.
      const cancelErr = Object.assign(new Error('canceled'), {
        name: 'TransactionCanceledException',
        CancellationReasons: [
          { Code: 'None' },
          { Code: 'TransactionConflict' },
        ],
      });
      mockSend.mockRejectedValue(cancelErr);
      await expect(
        store.applyDiff(
          { inserts: [evt('e1')], updates: [], removals: [], unchanged: 0 },
          { requirePublisher: { tableName: 'chq-publishers', id: 'p1' } },
        ),
      ).rejects.toBe(cancelErr);
    });

    it('does NOT wrap when CancellationReasons is missing entirely (defensive)', async () => {
      const cancelErr = Object.assign(new Error('canceled'), {
        name: 'TransactionCanceledException',
      });
      mockSend.mockRejectedValue(cancelErr);
      await expect(
        store.applyDiff(
          { inserts: [evt('e1')], updates: [], removals: [], unchanged: 0 },
          { requirePublisher: { tableName: 'chq-publishers', id: 'p1' } },
        ),
      ).rejects.toBe(cancelErr);
    });

    it('does not wrap TransactionCanceledException when requirePublisher is omitted', async () => {
      const cancelErr = Object.assign(new Error('canceled'), {
        name: 'TransactionCanceledException',
        CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
      });
      mockSend.mockRejectedValue(cancelErr);
      await expect(
        store.applyDiff({ inserts: [evt('e1')], updates: [], removals: [], unchanged: 0 }),
      ).rejects.toBe(cancelErr);
    });

    it('shrinks the per-batch event budget to 99 to leave room for the ConditionCheck', async () => {
      mockSend.mockResolvedValue({});
      // 100 events with requirePublisher → must split into 2 transactions
      // (99 events in the first, 1 event in the second), since the first
      // slot is taken by the ConditionCheck and TransactWriteItems caps at 100.
      const inserts = Array.from({ length: 100 }, (_, i) => evt(`e${i}`));
      await store.applyDiff(
        { inserts, updates: [], removals: [], unchanged: 0 },
        { requirePublisher: { tableName: 'chq-publishers', id: 'p1' } },
      );
      expect(mockSend).toHaveBeenCalledTimes(2);
      const first: any = mockSend.mock.calls[0][0];
      const second: any = mockSend.mock.calls[1][0];
      expect(first.input.TransactItems).toHaveLength(100); // 1 cond + 99 events
      expect(second.input.TransactItems).toHaveLength(2);  // 1 cond + 1 event
    });
  });
});
