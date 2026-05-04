jest.unmock('@aws-sdk/lib-dynamodb');

import { ConcurrentApplicationUpdateError, PublisherRegistryService } from '../services/publisherRegistryService';

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

  it('recordFetchOutcome updates lastFetchedAt and status with attribute_exists guard', async () => {
    mockSend.mockResolvedValue({});
    await svc.recordFetchOutcome('a', { status: 'ok' });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.Key).toEqual({ id: 'a' });
    expect(cmd.input.ExpressionAttributeValues[':status']).toBe('ok');
    // Guards against an in-flight ingest resurrecting a deleted publisher row.
    expect(cmd.input.ConditionExpression).toBe('attribute_exists(id)');
  });

  it('recordFetchOutcome silently swallows ConditionalCheckFailedException (publisher deleted mid-run)', async () => {
    const condErr = Object.assign(new Error('cond fail'), { name: 'ConditionalCheckFailedException' });
    mockSend.mockRejectedValue(condErr);
    // Returns void without throwing — the publisher is gone, so there's no
    // outcome to record, but it's not a caller-visible error.
    await expect(svc.recordFetchOutcome('deleted', { status: 'ok' })).resolves.toBeUndefined();
  });

  it('recordFetchOutcome surfaces non-condition DDB errors unchanged', async () => {
    const err = Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' });
    mockSend.mockRejectedValue(err);
    await expect(svc.recordFetchOutcome('a', { status: 'ok' })).rejects.toBe(err);
  });

  it('get returns null when no item', async () => {
    mockSend.mockResolvedValue({});
    const r = await svc.get('missing');
    expect(r).toBeNull();
  });

  it('setThresholdHalt clears halt when null passed and emits the attribute_exists guard', async () => {
    mockSend.mockResolvedValue({});
    await svc.setThresholdHalt('a', undefined);
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.ExpressionAttributeValues[':h']).toBeNull();
    expect(cmd.input.ConditionExpression).toBe('attribute_exists(id)');
  });

  it('setThresholdHalt silently swallows ConditionalCheckFailedException', async () => {
    const condErr = Object.assign(new Error('cond fail'), { name: 'ConditionalCheckFailedException' });
    mockSend.mockRejectedValue(condErr);
    await expect(svc.setThresholdHalt('deleted', undefined)).resolves.toBeUndefined();
  });

  // ─── Phase B (publisher portal apply flow) ─────────────────────────────

  it('getByEmail normalizes to lowercase before scanning', async () => {
    mockSend.mockResolvedValue({ Items: [] });
    await svc.getByEmail('  Foo@Bar.COM  ');
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.FilterExpression).toBe('contactEmail = :e');
    expect(cmd.input.ExpressionAttributeValues[':e']).toBe('foo@bar.com');
  });

  it('getByEmail returns matched publishers with pagination', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{ id: 'a', contactEmail: 'x@y.com' }],
        LastEvaluatedKey: { id: 'a' },
      })
      .mockResolvedValueOnce({
        Items: [{ id: 'b', contactEmail: 'x@y.com' }],
      });
    const r = await svc.getByEmail('x@y.com');
    expect(r.map(p => p.id)).toEqual(['a', 'b']);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('listPending filters on applicationStatus = pending', async () => {
    mockSend.mockResolvedValue({
      Items: [{ id: 'p1', applicationStatus: 'pending' }],
    });
    const r = await svc.listPending();
    expect(r.map(p => p.id)).toEqual(['p1']);
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.FilterExpression).toBe('applicationStatus = :s');
    expect(cmd.input.ExpressionAttributeValues[':s']).toBe('pending');
  });

  it('setApplicationStatus to approved records reviewer + clears rejection reason', async () => {
    mockSend.mockResolvedValue({});
    await svc.setApplicationStatus('p1', 'approved', { reviewerEmail: 'admin@chqcal.org' });
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.Key).toEqual({ id: 'p1' });
    expect(cmd.input.ExpressionAttributeValues[':s']).toBe('approved');
    expect(cmd.input.ExpressionAttributeValues[':r']).toBe('admin@chqcal.org');
    expect(cmd.input.ExpressionAttributeValues[':rr']).toBeNull();
  });

  it('setApplicationStatus to rejected records rejection reason', async () => {
    mockSend.mockResolvedValue({});
    await svc.setApplicationStatus('p1', 'rejected', {
      reviewerEmail: 'admin@chqcal.org',
      rejectionReason: 'feed not parseable',
    });
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.ExpressionAttributeValues[':s']).toBe('rejected');
    expect(cmd.input.ExpressionAttributeValues[':rr']).toBe('feed not parseable');
  });

  it('setApplicationStatus with expectedFromStatus emits a ConditionExpression', async () => {
    mockSend.mockResolvedValue({});
    await svc.setApplicationStatus('p1', 'approved', {
      reviewerEmail: 'admin@chqcal.org',
      expectedFromStatus: 'pending',
    });
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.ConditionExpression).toBe('applicationStatus = :expected');
    expect(cmd.input.ExpressionAttributeValues[':expected']).toBe('pending');
  });

  it('setApplicationStatus with enabled flag includes it in the SET clause', async () => {
    mockSend.mockResolvedValue({});
    await svc.setApplicationStatus('p1', 'approved', {
      reviewerEmail: 'admin@chqcal.org',
      enabled: true,
    });
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.UpdateExpression).toMatch(/enabled = :enabled/);
    expect(cmd.input.ExpressionAttributeValues[':enabled']).toBe(true);
  });

  it('setApplicationStatus translates ConditionalCheckFailedException to ConcurrentApplicationUpdateError when condition was supplied', async () => {
    const ddbErr = Object.assign(new Error('cond fail'), { name: 'ConditionalCheckFailedException' });
    mockSend.mockRejectedValue(ddbErr);
    await expect(svc.setApplicationStatus('p1', 'approved', {
      reviewerEmail: 'admin@chqcal.org',
      expectedFromStatus: 'pending',
    })).rejects.toBeInstanceOf(ConcurrentApplicationUpdateError);
  });

  it('setApplicationStatus surfaces ConditionalCheckFailedException unchanged when no condition was supplied', async () => {
    const ddbErr = Object.assign(new Error('cond fail'), { name: 'ConditionalCheckFailedException' });
    mockSend.mockRejectedValue(ddbErr);
    // No expectedFromStatus → the error should pass through (this code path
    // shouldn't normally trigger because there's no condition, but if some
    // other DDB constraint fails we don't want to mis-translate).
    await expect(svc.setApplicationStatus('p1', 'approved', {
      reviewerEmail: 'admin@chqcal.org',
    })).rejects.not.toBeInstanceOf(ConcurrentApplicationUpdateError);
  });

  it('delete sends DeleteCommand keyed by id', async () => {
    mockSend.mockResolvedValue({});
    await svc.delete('p-to-delete');
    expect(mockSend).toHaveBeenCalledTimes(1);
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.TableName).toBe('chq-publishers');
    expect(cmd.input.Key).toEqual({ id: 'p-to-delete' });
  });
});
