// Self-tests for the in-memory DynamoDBDocumentClient fake. Validate every
// command shape used by production services in backend/src/services/
// (see header comment in inMemoryDocClient.ts for the survey).

import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  BatchGetCommand,
  BatchWriteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { InMemoryDocClient } from '../inMemoryDocClient';

// Override the global jest.mock('@aws-sdk/lib-dynamodb') from setup.ts so
// `cmd instanceof PutCommand` etc. works inside the fake.
jest.unmock('@aws-sdk/lib-dynamodb');

function makeClient() {
  return new InMemoryDocClient([
    { name: 'simple', hashKey: 'id' },
    { name: 'composite', hashKey: 'pk', sortKey: 'sk' },
    {
      name: 'events',
      hashKey: 'publisherId',
      sortKey: 'eventId',
      gsis: [{ name: 'by-state', hashKey: 'state', sortKey: 'startDate' }],
    },
  ]);
}

describe('InMemoryDocClient', () => {
  it('Put + Get round-trip with hash-only key', async () => {
    const c = makeClient();
    await c.send(new PutCommand({ TableName: 'simple', Item: { id: 'a', n: 1 } }));
    const r = await c.send(new GetCommand({ TableName: 'simple', Key: { id: 'a' } })) as { Item?: any };
    expect(r.Item).toEqual({ id: 'a', n: 1 });
  });

  it('Put + Get round-trip with hash+sort key', async () => {
    const c = makeClient();
    await c.send(new PutCommand({ TableName: 'composite', Item: { pk: 'p1', sk: 's1', v: 'x' } }));
    await c.send(new PutCommand({ TableName: 'composite', Item: { pk: 'p1', sk: 's2', v: 'y' } }));
    const r = await c.send(new GetCommand({ TableName: 'composite', Key: { pk: 'p1', sk: 's2' } })) as { Item?: any };
    expect(r.Item).toEqual({ pk: 'p1', sk: 's2', v: 'y' });
  });

  it("Put with attribute_not_exists succeeds on empty, fails on existing", async () => {
    const c = makeClient();
    await c.send(new PutCommand({
      TableName: 'simple',
      Item: { id: 'a' },
      ConditionExpression: 'attribute_not_exists(id)',
    }));
    await expect(
      c.send(new PutCommand({
        TableName: 'simple',
        Item: { id: 'a' },
        ConditionExpression: 'attribute_not_exists(id)',
      })),
    ).rejects.toMatchObject({ name: 'ConditionalCheckFailedException' });
  });

  it('Update SET sets one attribute', async () => {
    const c = makeClient();
    await c.send(new PutCommand({ TableName: 'simple', Item: { id: 'a', n: 1 } }));
    await c.send(new UpdateCommand({
      TableName: 'simple',
      Key: { id: 'a' },
      UpdateExpression: 'SET #x = :v',
      ExpressionAttributeNames: { '#x': 'name' },
      ExpressionAttributeValues: { ':v': 'hello' },
    }));
    const r = await c.send(new GetCommand({ TableName: 'simple', Key: { id: 'a' } })) as { Item: any };
    expect(r.Item).toEqual({ id: 'a', n: 1, name: 'hello' });
  });

  it('Update ADD increments a number', async () => {
    const c = makeClient();
    await c.send(new PutCommand({ TableName: 'simple', Item: { id: 'a', counter: 0 } }));
    await c.send(new UpdateCommand({
      TableName: 'simple',
      Key: { id: 'a' },
      UpdateExpression: 'ADD #c :one',
      ExpressionAttributeNames: { '#c': 'counter' },
      ExpressionAttributeValues: { ':one': 1 },
    }));
    await c.send(new UpdateCommand({
      TableName: 'simple',
      Key: { id: 'a' },
      UpdateExpression: 'ADD #c :one',
      ExpressionAttributeNames: { '#c': 'counter' },
      ExpressionAttributeValues: { ':one': 1 },
    }));
    const r = await c.send(new GetCommand({ TableName: 'simple', Key: { id: 'a' } })) as { Item: any };
    expect(r.Item.counter).toBe(2);
  });

  it('Update with REMOVE deletes attribute', async () => {
    const c = makeClient();
    await c.send(new PutCommand({ TableName: 'simple', Item: { id: 'a', extra: 'x' } }));
    await c.send(new UpdateCommand({
      TableName: 'simple',
      Key: { id: 'a' },
      UpdateExpression: 'REMOVE extra',
    }));
    const r = await c.send(new GetCommand({ TableName: 'simple', Key: { id: 'a' } })) as { Item: any };
    expect(r.Item).toEqual({ id: 'a' });
  });

  it('Update with attribute_exists guards row missing', async () => {
    const c = makeClient();
    await expect(
      c.send(new UpdateCommand({
        TableName: 'simple',
        Key: { id: 'gone' },
        ConditionExpression: 'attribute_exists(id)',
        UpdateExpression: 'SET v = :v',
        ExpressionAttributeValues: { ':v': 1 },
      })),
    ).rejects.toMatchObject({ name: 'ConditionalCheckFailedException' });
  });

  it('Delete with conditional returns old attributes', async () => {
    const c = makeClient();
    await c.send(new PutCommand({ TableName: 'simple', Item: { id: 'a', n: 1 } }));
    const r = await c.send(new DeleteCommand({
      TableName: 'simple',
      Key: { id: 'a' },
      ConditionExpression: 'attribute_exists(id)',
      ReturnValues: 'ALL_OLD',
    })) as { Attributes?: any };
    expect(r.Attributes).toEqual({ id: 'a', n: 1 });
  });

  it('Query returns matching items', async () => {
    const c = makeClient();
    await c.send(new PutCommand({ TableName: 'composite', Item: { pk: 'p', sk: 's1', v: 1 } }));
    await c.send(new PutCommand({ TableName: 'composite', Item: { pk: 'p', sk: 's2', v: 2 } }));
    await c.send(new PutCommand({ TableName: 'composite', Item: { pk: 'q', sk: 's1', v: 3 } }));
    const r = await c.send(new QueryCommand({
      TableName: 'composite',
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': 'pk' },
      ExpressionAttributeValues: { ':pk': 'p' },
    })) as { Items: any[] };
    expect(r.Items).toHaveLength(2);
    expect(r.Items.map(i => i.sk)).toEqual(['s1', 's2']);
  });

  it('Query against a GSI returns matching items sorted by sort key', async () => {
    const c = makeClient();
    await c.send(new PutCommand({ TableName: 'events', Item: { publisherId: 'p1', eventId: 'e1', state: 'published', startDate: '2026-08-01' } }));
    await c.send(new PutCommand({ TableName: 'events', Item: { publisherId: 'p1', eventId: 'e2', state: 'published', startDate: '2026-07-01' } }));
    await c.send(new PutCommand({ TableName: 'events', Item: { publisherId: 'p2', eventId: 'e3', state: 'pending', startDate: '2026-06-01' } }));
    const r = await c.send(new QueryCommand({
      TableName: 'events',
      IndexName: 'by-state',
      KeyConditionExpression: '#s = :s',
      ExpressionAttributeNames: { '#s': 'state' },
      ExpressionAttributeValues: { ':s': 'published' },
    })) as { Items: any[] };
    expect(r.Items).toHaveLength(2);
    expect(r.Items.map(i => i.startDate)).toEqual(['2026-07-01', '2026-08-01']);
  });

  it('Scan with FilterExpression filters items', async () => {
    const c = makeClient();
    await c.send(new PutCommand({ TableName: 'simple', Item: { id: 'a', enabled: true } }));
    await c.send(new PutCommand({ TableName: 'simple', Item: { id: 'b', enabled: false } }));
    const r = await c.send(new ScanCommand({
      TableName: 'simple',
      FilterExpression: 'enabled = :t',
      ExpressionAttributeValues: { ':t': true },
    })) as { Items: any[] };
    expect(r.Items.map(i => i.id)).toEqual(['a']);
  });

  it('TransactWrite with three Puts atomically commits', async () => {
    const c = makeClient();
    await c.send(new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: 'simple', Item: { id: 'a', v: 1 } } },
        { Put: { TableName: 'simple', Item: { id: 'b', v: 2 } } },
        { Put: { TableName: 'simple', Item: { id: 'c', v: 3 } } },
      ],
    }));
    expect(c.dump('simple')).toHaveLength(3);
  });

  it('TransactWrite with one failing condition rolls back all writes', async () => {
    const c = makeClient();
    await c.send(new PutCommand({ TableName: 'simple', Item: { id: 'guard' } }));
    await expect(c.send(new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: 'simple', Item: { id: 'a', v: 1 } } },
        {
          ConditionCheck: {
            TableName: 'simple',
            Key: { id: 'absent' },
            ConditionExpression: 'attribute_exists(id)',
          },
        },
        { Put: { TableName: 'simple', Item: { id: 'b', v: 2 } } },
      ],
    }))).rejects.toMatchObject({ name: 'TransactionCanceledException' });
    // Original guard row remains; no new rows.
    expect(c.dump('simple').map(i => (i as any).id).sort()).toEqual(['guard']);
  });

  it('BatchWrite with both Puts and Deletes processes all', async () => {
    const c = makeClient();
    await c.send(new PutCommand({ TableName: 'simple', Item: { id: 'old' } }));
    await c.send(new BatchWriteCommand({
      RequestItems: {
        simple: [
          { PutRequest: { Item: { id: 'new1' } } },
          { PutRequest: { Item: { id: 'new2' } } },
          { DeleteRequest: { Key: { id: 'old' } } },
        ],
      },
    }));
    expect(c.dump('simple').map(i => (i as any).id).sort()).toEqual(['new1', 'new2']);
  });

  it('BatchGet returns all requested keys that exist', async () => {
    const c = makeClient();
    await c.send(new PutCommand({ TableName: 'simple', Item: { id: 'a' } }));
    const r = await c.send(new BatchGetCommand({
      RequestItems: { simple: { Keys: [{ id: 'a' }, { id: 'missing' }] } },
    })) as { Responses: Record<string, any[]> };
    expect(r.Responses.simple).toHaveLength(1);
  });

  it('throws clearly on unsupported command shapes', async () => {
    const c = makeClient();
    await expect(c.send({ constructor: { name: 'TransactGetItemsCommand' } } as any))
      .rejects.toThrow(/unsupported command/);
  });

  it('Scan with dotted-path FilterExpression handles nested attrs', async () => {
    const c = makeClient();
    await c.send(new PutCommand({
      TableName: 'simple',
      Item: { id: 'a', payload: { newEmail: 'x@example.com' } },
    }));
    const r = await c.send(new ScanCommand({
      TableName: 'simple',
      FilterExpression: 'payload.newEmail = :e',
      ExpressionAttributeValues: { ':e': 'x@example.com' },
    })) as { Items: any[] };
    expect(r.Items).toHaveLength(1);
  });

  // ─── Pagination ─────────────────────────────────────────────────────────

  it('Query with Limit < total returns LastEvaluatedKey built from hash+sort', async () => {
    const c = makeClient();
    for (let i = 0; i < 5; i++) {
      await c.send(new PutCommand({
        TableName: 'composite',
        Item: { pk: 'p1', sk: `s${i}`, n: i },
      }));
    }
    const r = await c.send(new QueryCommand({
      TableName: 'composite',
      KeyConditionExpression: 'pk = :p',
      ExpressionAttributeValues: { ':p': 'p1' },
      Limit: 2,
    })) as { Items: any[]; Count: number; LastEvaluatedKey?: Record<string, unknown> };
    expect(r.Items).toHaveLength(2);
    expect(r.Items.map(i => i.sk)).toEqual(['s0', 's1']);
    expect(r.LastEvaluatedKey).toEqual({ pk: 'p1', sk: 's1' });
  });

  it('Query resumes from ExclusiveStartKey to return remaining items', async () => {
    const c = makeClient();
    for (let i = 0; i < 5; i++) {
      await c.send(new PutCommand({
        TableName: 'composite',
        Item: { pk: 'p1', sk: `s${i}`, n: i },
      }));
    }
    // Page 1: Limit 2 → returns s0, s1; LastEvaluatedKey = { pk:'p1', sk:'s1' }
    const r1 = await c.send(new QueryCommand({
      TableName: 'composite',
      KeyConditionExpression: 'pk = :p',
      ExpressionAttributeValues: { ':p': 'p1' },
      Limit: 2,
    })) as { Items: any[]; LastEvaluatedKey?: Record<string, unknown> };
    expect(r1.LastEvaluatedKey).toBeDefined();
    // Page 2: resume → returns s2, s3, s4; no further LastEvaluatedKey.
    const r2 = await c.send(new QueryCommand({
      TableName: 'composite',
      KeyConditionExpression: 'pk = :p',
      ExpressionAttributeValues: { ':p': 'p1' },
      ExclusiveStartKey: r1.LastEvaluatedKey,
    })) as { Items: any[]; LastEvaluatedKey?: Record<string, unknown> };
    expect(r2.Items.map(i => i.sk)).toEqual(['s2', 's3', 's4']);
    expect(r2.LastEvaluatedKey).toBeUndefined();
  });

  it('Query with Limit ≥ total: no LastEvaluatedKey emitted', async () => {
    const c = makeClient();
    for (let i = 0; i < 3; i++) {
      await c.send(new PutCommand({
        TableName: 'composite',
        Item: { pk: 'p1', sk: `s${i}`, n: i },
      }));
    }
    const r = await c.send(new QueryCommand({
      TableName: 'composite',
      KeyConditionExpression: 'pk = :p',
      ExpressionAttributeValues: { ':p': 'p1' },
      Limit: 10,
    })) as { Items: any[]; LastEvaluatedKey?: Record<string, unknown> };
    expect(r.Items).toHaveLength(3);
    expect(r.LastEvaluatedKey).toBeUndefined();
  });

  it("ConditionExpression '=' compares objects structurally (key order independent)", async () => {
    // Construct two objects with the same key set but different insertion
    // orders. With the old JSON.stringify-based deepEq these would compare
    // unequal; structural deepEq must treat them as equal.
    const c = makeClient();
    const stored = { a: 1, b: 'two', c: { x: 1, y: 2 } };
    await c.send(new PutCommand({
      TableName: 'simple',
      Item: { id: 'a', payload: stored },
    }));
    // Same keys, opposite insertion order on both the outer and nested object.
    const compareTo: Record<string, unknown> = {};
    compareTo.c = { y: 2, x: 1 };
    compareTo.b = 'two';
    compareTo.a = 1;
    const r = await c.send(new ScanCommand({
      TableName: 'simple',
      FilterExpression: 'payload = :p',
      ExpressionAttributeValues: { ':p': compareTo },
    })) as { Items: any[] };
    expect(r.Items).toHaveLength(1);
    expect(r.Items[0].id).toBe('a');
  });

  it('Scan with Limit + ExclusiveStartKey paginates over hash-only table', async () => {
    const c = makeClient();
    for (let i = 0; i < 4; i++) {
      await c.send(new PutCommand({ TableName: 'simple', Item: { id: `id${i}`, n: i } }));
    }
    const r1 = await c.send(new ScanCommand({
      TableName: 'simple',
      Limit: 2,
    })) as { Items: any[]; LastEvaluatedKey?: Record<string, unknown> };
    expect(r1.Items).toHaveLength(2);
    expect(r1.LastEvaluatedKey).toBeDefined();
    // The LEK should only carry the hash key for a hash-only table.
    expect(Object.keys(r1.LastEvaluatedKey!)).toEqual(['id']);
    const r2 = await c.send(new ScanCommand({
      TableName: 'simple',
      ExclusiveStartKey: r1.LastEvaluatedKey,
    })) as { Items: any[]; LastEvaluatedKey?: Record<string, unknown> };
    // The two pages combined should cover all 4 items.
    const seen = [...r1.Items, ...r2.Items].map(i => i.id).sort();
    expect(seen).toEqual(['id0', 'id1', 'id2', 'id3']);
    expect(r2.LastEvaluatedKey).toBeUndefined();
  });
});
