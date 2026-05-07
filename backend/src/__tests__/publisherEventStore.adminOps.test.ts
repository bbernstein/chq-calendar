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

  it('rejectEvent updates state to rejected with reason and rejectedAt', async () => {
    mockClient.send.mockResolvedValue({});
    await store.rejectEvent('p', 'e', 'duplicate of upstream feed');
    const cmd: any = mockClient.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('UpdateCommand');
    expect(cmd.input.UpdateExpression).toContain('#s = :rejected');
    expect(cmd.input.UpdateExpression).toContain('rejectedAt = :now');
    expect(cmd.input.UpdateExpression).toContain('rejectionReason = :reason');
    expect(cmd.input.ExpressionAttributeValues[':reason']).toBe('duplicate of upstream feed');
    expect(cmd.input.ExpressionAttributeValues[':rejected']).toBe('rejected');
    expect(cmd.input.ExpressionAttributeValues[':pending']).toBe('pending');
    expect(cmd.input.ConditionExpression).toBe('attribute_exists(publisherId) AND #s = :pending');
    expect(cmd.input.ExpressionAttributeNames['#s']).toBe('state');
  });

  it('rejectEvent omits rejectionReason when reason is undefined', async () => {
    mockClient.send.mockResolvedValue({});
    await store.rejectEvent('p', 'e');
    const cmd: any = mockClient.send.mock.calls[0][0];
    expect(cmd.input.UpdateExpression).not.toContain('rejectionReason');
    expect(cmd.input.ExpressionAttributeValues[':reason']).toBeUndefined();
  });

  it('rejectEvent omits rejectionReason when reason is whitespace-only', async () => {
    mockClient.send.mockResolvedValue({});
    await store.rejectEvent('p', 'e', '   ');
    const cmd: any = mockClient.send.mock.calls[0][0];
    expect(cmd.input.UpdateExpression).not.toContain('rejectionReason');
  });

  it('rejectEvent caps reason at 500 chars defensively', async () => {
    mockClient.send.mockResolvedValue({});
    await store.rejectEvent('p', 'e', 'x'.repeat(600));
    const cmd: any = mockClient.send.mock.calls[0][0];
    expect((cmd.input.ExpressionAttributeValues[':reason'] as string).length).toBe(500);
  });

  it('rejectEvent treats ConditionalCheckFailedException as a no-op success (state !== pending)', async () => {
    const err = Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
    mockClient.send.mockRejectedValue(err);
    await expect(store.rejectEvent('p', 'e', 'r')).resolves.toBeUndefined();
  });

  it('rejectEvent re-throws other errors', async () => {
    mockClient.send.mockRejectedValue(new Error('boom'));
    await expect(store.rejectEvent('p', 'e', 'r')).rejects.toThrow('boom');
  });

  it('approve-after-reject still fails (existing approve ConditionExpression rejects state=rejected)', async () => {
    const err = Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
    mockClient.send.mockRejectedValue(err);
    await expect(store.approveEvent('p', 'e')).rejects.toThrow(/cannot approve/);
  });
});
