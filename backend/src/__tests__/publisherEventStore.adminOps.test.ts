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

  it('approveEvent updates state to published', async () => {
    mockClient.send.mockResolvedValue({});
    await store.approveEvent('p', 'e');
    const cmd: any = mockClient.send.mock.calls[0][0];
    expect(cmd.input.UpdateExpression).toContain('#s');
    expect(cmd.input.ExpressionAttributeValues[':s']).toBe('published');
  });

  it('rejectEvent deletes the row', async () => {
    mockClient.send.mockResolvedValue({});
    await store.rejectEvent('p', 'e');
    const cmd: any = mockClient.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('DeleteCommand');
  });
});
