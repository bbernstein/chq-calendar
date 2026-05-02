jest.unmock('@aws-sdk/lib-dynamodb');

import { PublisherEventStore } from '../services/publisherEventStore';

const mockClient = { send: jest.fn() };

describe('PublisherEventStore admin ops', () => {
  let store: PublisherEventStore;
  beforeEach(() => {
    jest.resetAllMocks();
    store = new PublisherEventStore(mockClient as any, 'chq-publisher-events');
  });

  it('listPending uses the by-state GSI with state=pending', async () => {
    mockClient.send.mockResolvedValue({ Items: [] });
    await store.listPending();
    const cmd: any = mockClient.send.mock.calls[0][0];
    expect(cmd.input.IndexName).toBe('by-state');
    expect(cmd.input.ExpressionAttributeValues[':s']).toBe('pending');
  });

  it('approveEvent updates state to published guarded by attribute_exists + state=pending', async () => {
    mockClient.send.mockResolvedValue({});
    await store.approveEvent('p', 'e');
    const cmd: any = mockClient.send.mock.calls[0][0];
    expect(cmd.input.UpdateExpression).toContain('#s');
    expect(cmd.input.ExpressionAttributeValues[':published']).toBe('published');
    expect(cmd.input.ConditionExpression).toBe('attribute_exists(publisherId) AND #s = :pending');
    expect(cmd.input.ExpressionAttributeValues[':pending']).toBe('pending');
  });

  it('approveEvent throws a descriptive error when ConditionalCheckFailedException is raised', async () => {
    const err = Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
    mockClient.send.mockRejectedValue(err);
    await expect(store.approveEvent('p', 'e')).rejects.toThrow(/cannot approve p\/e/);
  });

  it('approveEvent re-throws other errors unchanged', async () => {
    mockClient.send.mockRejectedValue(new Error('boom'));
    await expect(store.approveEvent('p', 'e')).rejects.toThrow('boom');
  });

  it('rejectEvent deletes the row guarded by state=pending', async () => {
    mockClient.send.mockResolvedValue({});
    await store.rejectEvent('p', 'e');
    const cmd: any = mockClient.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('DeleteCommand');
    expect(cmd.input.ConditionExpression).toBe('#s = :pending');
    expect(cmd.input.ExpressionAttributeNames['#s']).toBe('state');
    expect(cmd.input.ExpressionAttributeValues[':pending']).toBe('pending');
  });

  it('rejectEvent treats ConditionalCheckFailedException as a no-op success', async () => {
    const err = Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
    mockClient.send.mockRejectedValue(err);
    await expect(store.rejectEvent('p', 'e')).resolves.toBeUndefined();
  });

  it('rejectEvent re-throws other errors', async () => {
    mockClient.send.mockRejectedValue(new Error('boom'));
    await expect(store.rejectEvent('p', 'e')).rejects.toThrow('boom');
  });
});
