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
});
