jest.unmock('@aws-sdk/lib-dynamodb');

import {
  ConcurrentApplicationUpdateError,
  PublisherNotFoundError,
  PublisherRegistryService,
} from '../services/publisherRegistryService';

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

  it('getByEmail queries the by-contactEmail GSI with normalized lowercase input', async () => {
    mockSend.mockResolvedValue({ Items: [] });
    await svc.getByEmail('  Foo@Bar.COM  ');
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.IndexName).toBe('by-contactEmail');
    expect(cmd.input.KeyConditionExpression).toBe('contactEmail = :e');
    expect(cmd.input.ExpressionAttributeValues[':e']).toBe('foo@bar.com');
    // It's a Query, not a Scan — so no FilterExpression.
    expect(cmd.input.FilterExpression).toBeUndefined();
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

  it('getByEmail falls back to Scan when the GSI is missing (deploy-window race)', async () => {
    // Simulate the ValidationException DDB throws before the Terraform apply
    // has propagated the new index. The fallback path Scans and logs a warn
    // — caller still gets a correct result rather than a 500.
    const missingIndexErr = Object.assign(new Error('The table does not have the specified index: by-contactEmail'), {
      name: 'ValidationException',
    });
    mockSend
      .mockRejectedValueOnce(missingIndexErr)
      .mockResolvedValueOnce({ Items: [{ id: 'a', contactEmail: 'x@y.com' }] });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = await svc.getByEmail('x@y.com');
      expect(r.map(p => p.id)).toEqual(['a']);
      // First call was the Query, second call was the Scan fallback.
      expect(mockSend).toHaveBeenCalledTimes(2);
      const fallbackCmd: any = mockSend.mock.calls[1][0];
      expect(fallbackCmd.input.FilterExpression).toBe('contactEmail = :e');
      expect(fallbackCmd.input.IndexName).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('getByEmail surfaces non-validation DDB errors unchanged (no fallback)', async () => {
    const throttle = Object.assign(new Error('throttled'), {
      name: 'ProvisionedThroughputExceededException',
    });
    mockSend.mockRejectedValueOnce(throttle);
    await expect(svc.getByEmail('x@y.com')).rejects.toBe(throttle);
    // Did NOT fall back to Scan.
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('upsert normalizes contactEmail before persisting (lowercase + trim)', async () => {
    // Without write-side normalization, an admin who entered 'Foo@Bar.COM '
    // would write a row that getByEmail('foo@bar.com') misses on the GSI.
    // The registry enforces this at the boundary so callers don't have to
    // remember.
    mockSend.mockResolvedValue({});
    await svc.upsert({
      id: 'pub-1',
      name: 'Mixed',
      contactEmail: '  Foo@Bar.COM  ',
      sourceUrl: 'https://example.com/feed.json',
      sourceType: 'json',
      trustLevel: 'review',
      enabled: true,
      createdAt: '2026-01-01T00:00:00Z',
    });
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.Item.contactEmail).toBe('foo@bar.com');
    // Other fields untouched.
    expect(cmd.input.Item.id).toBe('pub-1');
    expect(cmd.input.Item.name).toBe('Mixed');
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

  // ─── Phase C (publisher portal self-service helpers) ─────────────────

  describe('setPausedFlag', () => {
    it('with paused=true and selfInitiated=true sets paused + selfPausedAt', async () => {
      mockSend.mockResolvedValue({});
      await svc.setPausedFlag('pub-1', true, { selfInitiated: true });
      const cmd: any = mockSend.mock.calls[0][0];
      expect(cmd.input.Key).toEqual({ id: 'pub-1' });
      expect(cmd.input.UpdateExpression).toMatch(/SET paused = :p, selfPausedAt = :now/);
      expect(cmd.input.UpdateExpression).not.toMatch(/REMOVE/);
      expect(cmd.input.ExpressionAttributeValues[':p']).toBe(true);
      expect(typeof cmd.input.ExpressionAttributeValues[':now']).toBe('string');
      // Guards against resurrecting a deleted row as a partial fragment.
      expect(cmd.input.ConditionExpression).toBe('attribute_exists(id)');
    });

    it('with paused=true and selfInitiated=false sets paused only (admin-paused)', async () => {
      mockSend.mockResolvedValue({});
      await svc.setPausedFlag('pub-1', true, {});
      const cmd: any = mockSend.mock.calls[0][0];
      expect(cmd.input.UpdateExpression).toBe('SET paused = :p');
      expect(cmd.input.ExpressionAttributeValues[':p']).toBe(true);
      expect(cmd.input.ExpressionAttributeValues[':now']).toBeUndefined();
      expect(cmd.input.ConditionExpression).toBe('attribute_exists(id)');
    });

    it('with paused=false clears paused and removes selfPausedAt', async () => {
      mockSend.mockResolvedValue({});
      await svc.setPausedFlag('pub-1', false, {});
      const cmd: any = mockSend.mock.calls[0][0];
      expect(cmd.input.UpdateExpression).toMatch(/SET paused = :p/);
      expect(cmd.input.UpdateExpression).toMatch(/REMOVE selfPausedAt/);
      expect(cmd.input.ExpressionAttributeValues[':p']).toBe(false);
      expect(cmd.input.ConditionExpression).toBe('attribute_exists(id)');
    });

    it('translates ConditionalCheckFailedException to PublisherNotFoundError', async () => {
      const condErr = Object.assign(new Error('cond fail'), { name: 'ConditionalCheckFailedException' });
      mockSend.mockRejectedValue(condErr);
      await expect(svc.setPausedFlag('deleted', true, {})).rejects.toBeInstanceOf(PublisherNotFoundError);
    });

    it('surfaces non-condition DDB errors unchanged', async () => {
      const err = Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' });
      mockSend.mockRejectedValue(err);
      await expect(svc.setPausedFlag('p', true, {})).rejects.toBe(err);
    });
  });

  describe('setSelfDisabled', () => {
    it('clears enabled, sets selfDisabledAt, and bumps tokenVersion atomically', async () => {
      mockSend.mockResolvedValue({});
      await svc.setSelfDisabled('pub-1');
      const cmd: any = mockSend.mock.calls[0][0];
      expect(cmd.input.Key).toEqual({ id: 'pub-1' });
      expect(cmd.input.UpdateExpression).toMatch(/SET enabled = :f, selfDisabledAt = :now/);
      expect(cmd.input.UpdateExpression).toMatch(/ADD tokenVersion :one/);
      expect(cmd.input.ExpressionAttributeValues[':f']).toBe(false);
      expect(cmd.input.ExpressionAttributeValues[':one']).toBe(1);
      expect(typeof cmd.input.ExpressionAttributeValues[':now']).toBe('string');
      expect(cmd.input.ConditionExpression).toBe('attribute_exists(id)');
    });

    it('translates ConditionalCheckFailedException to PublisherNotFoundError', async () => {
      const condErr = Object.assign(new Error('cond fail'), { name: 'ConditionalCheckFailedException' });
      mockSend.mockRejectedValue(condErr);
      await expect(svc.setSelfDisabled('deleted')).rejects.toBeInstanceOf(PublisherNotFoundError);
    });
  });

  describe('setEnabledFlag', () => {
    it('writes only the enabled field, with attribute_exists guard', async () => {
      mockSend.mockResolvedValue({});
      await svc.setEnabledFlag('pub-1', false);
      const cmd: any = mockSend.mock.calls[0][0];
      expect(cmd.input.Key).toEqual({ id: 'pub-1' });
      expect(cmd.input.UpdateExpression).toBe('SET enabled = :e');
      expect(cmd.input.ExpressionAttributeValues[':e']).toBe(false);
      expect(cmd.input.ConditionExpression).toBe('attribute_exists(id)');
    });

    it('passes through enabled=true unchanged', async () => {
      mockSend.mockResolvedValue({});
      await svc.setEnabledFlag('pub-1', true);
      const cmd: any = mockSend.mock.calls[0][0];
      expect(cmd.input.ExpressionAttributeValues[':e']).toBe(true);
    });

    it('translates ConditionalCheckFailedException to PublisherNotFoundError', async () => {
      const condErr = Object.assign(new Error('cond fail'), { name: 'ConditionalCheckFailedException' });
      mockSend.mockRejectedValue(condErr);
      await expect(svc.setEnabledFlag('deleted', false)).rejects.toBeInstanceOf(PublisherNotFoundError);
    });
  });

  describe('setEmailChangeLock', () => {
    it('emits attribute_exists guard and writes the lock timestamp', async () => {
      mockSend.mockResolvedValue({});
      await svc.setEmailChangeLock('pub-1', '2026-05-06T00:00:00.000Z');
      const cmd: any = mockSend.mock.calls[0][0];
      expect(cmd.input.UpdateExpression).toBe('SET emailChangeLockedUntil = :u');
      expect(cmd.input.ExpressionAttributeValues[':u']).toBe('2026-05-06T00:00:00.000Z');
      expect(cmd.input.ConditionExpression).toBe('attribute_exists(id)');
    });

    it('translates ConditionalCheckFailedException to PublisherNotFoundError', async () => {
      const condErr = Object.assign(new Error('cond fail'), { name: 'ConditionalCheckFailedException' });
      mockSend.mockRejectedValue(condErr);
      await expect(svc.setEmailChangeLock('deleted', 't')).rejects.toBeInstanceOf(PublisherNotFoundError);
    });
  });

  describe('clearEmailChangeLock', () => {
    it('emits attribute_exists guard and a REMOVE expression', async () => {
      mockSend.mockResolvedValue({});
      await svc.clearEmailChangeLock('pub-1');
      const cmd: any = mockSend.mock.calls[0][0];
      expect(cmd.input.UpdateExpression).toBe('REMOVE emailChangeLockedUntil');
      expect(cmd.input.ConditionExpression).toBe('attribute_exists(id)');
    });

    it('translates ConditionalCheckFailedException to PublisherNotFoundError', async () => {
      const condErr = Object.assign(new Error('cond fail'), { name: 'ConditionalCheckFailedException' });
      mockSend.mockRejectedValue(condErr);
      await expect(svc.clearEmailChangeLock('deleted')).rejects.toBeInstanceOf(PublisherNotFoundError);
    });
  });

  describe('commitEmailChange', () => {
    it('emits attribute_exists guard, sets contactEmail, and bumps tokenVersion', async () => {
      mockSend.mockResolvedValue({});
      await svc.commitEmailChange('pub-1', 'new@example.com');
      const cmd: any = mockSend.mock.calls[0][0];
      expect(cmd.input.UpdateExpression).toBe('SET contactEmail = :e ADD tokenVersion :one');
      expect(cmd.input.ExpressionAttributeValues[':e']).toBe('new@example.com');
      expect(cmd.input.ExpressionAttributeValues[':one']).toBe(1);
      expect(cmd.input.ConditionExpression).toBe('attribute_exists(id)');
    });

    it('translates ConditionalCheckFailedException to PublisherNotFoundError', async () => {
      const condErr = Object.assign(new Error('cond fail'), { name: 'ConditionalCheckFailedException' });
      mockSend.mockRejectedValue(condErr);
      await expect(svc.commitEmailChange('deleted', 'x@y.com')).rejects.toBeInstanceOf(PublisherNotFoundError);
    });
  });

  describe('updateProfile', () => {
    it('only writes the supplied fields', async () => {
      mockSend.mockResolvedValue({});
      await svc.updateProfile('pub-1', { name: 'New Name', organization: 'Org' });
      const cmd: any = mockSend.mock.calls[0][0];
      expect(cmd.input.Key).toEqual({ id: 'pub-1' });
      // Guards against resurrecting a deleted row.
      expect(cmd.input.ConditionExpression).toBe('attribute_exists(id)');
      const expr: string = cmd.input.UpdateExpression;
      expect(expr).toMatch(/^SET /);
      // Both supplied fields must appear in the SET clause.
      const namePh = Object.entries(cmd.input.ExpressionAttributeNames as Record<string, string>)
        .find(([, v]) => v === 'name')?.[0];
      const orgPh = Object.entries(cmd.input.ExpressionAttributeNames as Record<string, string>)
        .find(([, v]) => v === 'organization')?.[0];
      expect(namePh).toBeDefined();
      expect(orgPh).toBeDefined();
      expect(expr).toContain(`${namePh} = `);
      expect(expr).toContain(`${orgPh} = `);
      // sourceUrl was not supplied → must not appear.
      expect(JSON.stringify(cmd.input.ExpressionAttributeNames)).not.toContain('sourceUrl');
      // Values match what we passed.
      const vals = cmd.input.ExpressionAttributeValues as Record<string, unknown>;
      expect(Object.values(vals)).toEqual(expect.arrayContaining(['New Name', 'Org']));
    });

    it('REMOVEs organization when passed empty string', async () => {
      mockSend.mockResolvedValue({});
      // organization is the only clearable profile field
      await svc.updateProfile('pub-1', { organization: '' });
      const cmd: any = mockSend.mock.calls[0][0];
      const expr: string = cmd.input.UpdateExpression;
      expect(expr).toMatch(/^REMOVE /);
      // No SET clause and no values.
      expect(expr).not.toMatch(/SET /);
      expect(cmd.input.ExpressionAttributeValues).toBeUndefined();
      const removedNames = Object.values(cmd.input.ExpressionAttributeNames as Record<string, string>);
      expect(removedNames).toContain('organization');
    });

    it('throws when caller attempts to clear a required field', async () => {
      mockSend.mockResolvedValue({});
      await expect(svc.updateProfile('pub-1', { name: '' })).rejects.toThrow(
        /cannot clear required field "name"/,
      );
      await expect(svc.updateProfile('pub-1', { name: undefined })).rejects.toThrow(
        /cannot clear required field "name"/,
      );
      // None of the failed calls should have hit DDB.
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('is a no-op when patch is empty', async () => {
      mockSend.mockResolvedValue({});
      await svc.updateProfile('pub-1', {});
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('translates ConditionalCheckFailedException to PublisherNotFoundError', async () => {
      const condErr = Object.assign(new Error('cond fail'), { name: 'ConditionalCheckFailedException' });
      mockSend.mockRejectedValue(condErr);
      await expect(svc.updateProfile('deleted', { name: 'X' })).rejects.toBeInstanceOf(PublisherNotFoundError);
    });

    it('updateProfile accepts notificationsEnabled boolean', async () => {
      mockSend.mockResolvedValue({});
      await svc.updateProfile('p1', { notificationsEnabled: false });
      const cmd: any = mockSend.mock.calls[0][0];
      // The field name lives in ExpressionAttributeNames (placeholder like #k0 → 'notificationsEnabled')
      const fieldNames = Object.values(cmd.input.ExpressionAttributeNames as Record<string, string>);
      expect(fieldNames).toContain('notificationsEnabled');
      expect(Object.values(cmd.input.ExpressionAttributeValues as Record<string, unknown>)).toContain(false);
    });
  });
});
