import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ApplicationStatus, FetchStatus, PublisherRecord } from '../types/publisher';

// Thrown by setApplicationStatus when the optional `expectedFromStatus` does
// not match the current row state. Caller should treat as "another writer
// got there first" — typical UX is to refetch and re-show the row.
export class ConcurrentApplicationUpdateError extends Error {
  constructor(public readonly expectedFromStatus: ApplicationStatus) {
    super(`application status was not '${expectedFromStatus}' at write time`);
    this.name = 'ConcurrentApplicationUpdateError';
  }
}

export class PublisherRegistryService {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get(id: string): Promise<PublisherRecord | null> {
    const r = await this.db.send(new GetCommand({ TableName: this.tableName, Key: { id } }));
    return (r.Item as PublisherRecord) ?? null;
  }

  async listEnabled(): Promise<PublisherRecord[]> {
    const out: PublisherRecord[] = [];
    let last: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'enabled = :t',
        ExpressionAttributeValues: { ':t': true },
        ExclusiveStartKey: last,
      }));
      out.push(...((r.Items ?? []) as PublisherRecord[]));
      last = r.LastEvaluatedKey;
    } while (last);
    return out;
  }

  async listAll(): Promise<PublisherRecord[]> {
    const out: PublisherRecord[] = [];
    let last: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(new ScanCommand({
        TableName: this.tableName,
        ExclusiveStartKey: last,
      }));
      out.push(...((r.Items ?? []) as PublisherRecord[]));
      last = r.LastEvaluatedKey;
    } while (last);
    return out;
  }

  async upsert(rec: PublisherRecord): Promise<void> {
    await this.db.send(new PutCommand({ TableName: this.tableName, Item: rec }));
  }

  async recordFetchOutcome(id: string, outcome: { status: FetchStatus; message?: string }): Promise<void> {
    await this.db.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { id },
      UpdateExpression: 'SET lastFetchedAt = :now, lastFetchStatus = :status, lastFetchMessage = :msg',
      ExpressionAttributeValues: {
        ':now': new Date().toISOString(),
        ':status': outcome.status,
        ':msg': outcome.message ?? null,
      },
    }));
  }

  async setThresholdHalt(id: string, halt: PublisherRecord['pendingThresholdHalt']): Promise<void> {
    await this.db.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { id },
      UpdateExpression: 'SET pendingThresholdHalt = :h',
      ExpressionAttributeValues: { ':h': halt ?? null },
    }));
  }

  // ─── Phase B (publisher portal apply flow) ─────────────────────────────
  //
  // Email lookup uses Scan because there is no GSI on contactEmail and the
  // publishers table is small (low double-digits expected). If the table
  // grows past a few hundred rows, add `by-contactEmail` GSI and switch.
  // Email comparison is case-insensitive (we store lowercase, but defensively
  // normalize the query too).
  async getByEmail(email: string): Promise<PublisherRecord[]> {
    const normalized = email.trim().toLowerCase();
    const out: PublisherRecord[] = [];
    let last: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'contactEmail = :e',
        ExpressionAttributeValues: { ':e': normalized },
        ExclusiveStartKey: last,
      }));
      out.push(...((r.Items ?? []) as PublisherRecord[]));
      last = r.LastEvaluatedKey;
    } while (last);
    return out;
  }

  async listPending(): Promise<PublisherRecord[]> {
    const out: PublisherRecord[] = [];
    let last: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'applicationStatus = :s',
        ExpressionAttributeValues: { ':s': 'pending' as ApplicationStatus },
        ExclusiveStartKey: last,
      }));
      out.push(...((r.Items ?? []) as PublisherRecord[]));
      last = r.LastEvaluatedKey;
    } while (last);
    return out;
  }

  // setApplicationStatus updates the row's review fields atomically. When
  // `expectedFromStatus` is supplied the write is conditioned on the row's
  // current applicationStatus equalling that value — this prevents two
  // admins from successfully approving/rejecting the same row at the same
  // time (only the first commit wins). The optional `enabled` flag lets the
  // approve/reject paths flip the ingest gate in the same write so we don't
  // leave the row in a half-updated state.
  //
  // ConcurrentApplicationUpdateError is thrown on condition fail.
  async setApplicationStatus(
    id: string,
    status: ApplicationStatus,
    opts: {
      reviewerEmail?: string;
      rejectionReason?: string;
      expectedFromStatus?: ApplicationStatus;
      enabled?: boolean;
    } = {},
  ): Promise<void> {
    const setParts = [
      'applicationStatus = :s',
      'reviewedAt = :now',
      'reviewerEmail = :r',
      'rejectionReason = :rr',
    ];
    const values: Record<string, unknown> = {
      ':s': status,
      ':now': new Date().toISOString(),
      ':r': opts.reviewerEmail ?? null,
      ':rr': opts.rejectionReason ?? null,
    };
    if (opts.enabled !== undefined) {
      setParts.push('enabled = :enabled');
      values[':enabled'] = opts.enabled;
    }
    if (opts.expectedFromStatus !== undefined) {
      values[':expected'] = opts.expectedFromStatus;
    }
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { id },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeValues: values,
        ...(opts.expectedFromStatus !== undefined
          ? { ConditionExpression: 'applicationStatus = :expected' }
          : {}),
      }));
    } catch (err) {
      // SDK v3 throws ConditionalCheckFailedException by name; check by name
      // string to avoid coupling to the Dynamo SDK error class import.
      const name = (err as { name?: string } | undefined)?.name;
      if (name === 'ConditionalCheckFailedException' && opts.expectedFromStatus !== undefined) {
        throw new ConcurrentApplicationUpdateError(opts.expectedFromStatus);
      }
      throw err;
    }
  }
}
