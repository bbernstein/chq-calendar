jest.unmock('@aws-sdk/lib-dynamodb');

import { PublisherRegistryService } from '../services/publisherRegistryService';

const mockSend = jest.fn();
const mockClient: any = { send: mockSend };

describe('PublisherRegistryService', () => {
  let svc: PublisherRegistryService;
  beforeEach(() => {
    jest.resetAllMocks();
    svc = new PublisherRegistryService(mockClient, 'chq-publishers');
  });

  it('listEnabled returns only enabled publishers', async () => {
    mockSend.mockResolvedValue({
      Items: [
        { id: 'a', enabled: true, name: 'A', contactEmail: 'a@b', sourceUrl: 'x', sourceType: 'json', trustLevel: 'auto', createdAt: 't' },
      ],
    });
    const r = await svc.listEnabled();
    expect(r.map(p => p.id)).toEqual(['a']);
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.FilterExpression).toContain('enabled');
  });

  it('listEnabled paginates through LastEvaluatedKey', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{ id: 'a', enabled: true, name: 'A', contactEmail: 'a@b', sourceUrl: 'x', sourceType: 'json', trustLevel: 'auto', createdAt: 't' }],
        LastEvaluatedKey: { id: 'a' },
      })
      .mockResolvedValueOnce({
        Items: [{ id: 'b', enabled: true, name: 'B', contactEmail: 'b@b', sourceUrl: 'y', sourceType: 'json', trustLevel: 'auto', createdAt: 't' }],
      });
    const r = await svc.listEnabled();
    expect(r.map(p => p.id)).toEqual(['a', 'b']);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('listAll returns all publishers without a filter (so disabled rows are included)', async () => {
    mockSend.mockResolvedValue({
      Items: [
        { id: 'a', enabled: true, name: 'A', contactEmail: 'a@b', sourceUrl: 'x', sourceType: 'json', trustLevel: 'auto', createdAt: 't' },
        { id: 'b', enabled: false, name: 'B', contactEmail: 'b@b', sourceUrl: 'y', sourceType: 'json', trustLevel: 'auto', createdAt: 't' },
      ],
    });
    const r = await svc.listAll();
    expect(r.map(p => p.id)).toEqual(['a', 'b']);
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.FilterExpression).toBeUndefined();
  });

  it('recordFetchOutcome updates lastFetchedAt and status', async () => {
    mockSend.mockResolvedValue({});
    await svc.recordFetchOutcome('a', { status: 'ok' });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.Key).toEqual({ id: 'a' });
    expect(cmd.input.ExpressionAttributeValues[':status']).toBe('ok');
  });

  it('get returns null when no item', async () => {
    mockSend.mockResolvedValue({});
    const r = await svc.get('missing');
    expect(r).toBeNull();
  });

  it('setThresholdHalt clears halt when null passed', async () => {
    mockSend.mockResolvedValue({});
    await svc.setThresholdHalt('a', undefined);
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.ExpressionAttributeValues[':h']).toBeNull();
  });
});
