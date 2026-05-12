import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand, GetCommand, QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

export const VALID_SYNC_TYPES = [
  'manual', 'scheduled', 'full', 'incremental', 'daily', 'hourly',
] as const;

export type SyncType = typeof VALID_SYNC_TYPES[number];

export interface SyncStatusRecord {
  id: string;
  type: SyncType;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  timestamp: number;
  startTime: string;
  endTime?: string;
  duration?: number;
  progress?: {
    currentStep: string;
    totalSteps: number;
    completedSteps: number;
    percentage: number;
  };
  result?: {
    eventsProcessed: number;
    eventsCreated: number;
    eventsUpdated: number;
    eventsDeleted: number;
    eventsSkipped: number;
    errors: string[];
  };
  error?: string;
  requestId?: string;
  metadata?: Record<string, any>;
}

export class SyncStatusService {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor(docClient: DynamoDBDocumentClient, tableName?: string) {
    this.docClient = docClient;
    this.tableName = tableName || process.env.SYNC_STATUS_TABLE_NAME || 'chautauqua-calendar-sync-status';
  }

  /**
   * Create a new sync status record
   */
  async createSyncStatus(
    type: SyncStatusRecord['type'],
    requestId?: string,
    metadata?: Record<string, any>
  ): Promise<string> {
    const syncId = uuidv4();
    const timestamp = Date.now();
    
    const record: SyncStatusRecord = {
      id: syncId,
      type,
      status: 'pending',
      timestamp,
      startTime: new Date().toISOString(),
      requestId,
      metadata,
    };

    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: record,
    }));

    console.log(`Created sync status record: ${syncId} (type: ${type})`);
    return syncId;
  }

  /**
   * Update sync status to in_progress
   */
  async startSync(syncId: string, initialProgress?: SyncStatusRecord['progress']): Promise<void> {
    let updateExpression = 'SET #status = :status, #startTime = :startTime';
    const expressionAttributeNames: Record<string, string> = {
      '#status': 'status',
      '#startTime': 'startTime',
    };
    const expressionAttributeValues: Record<string, any> = {
      ':status': 'in_progress',
      ':startTime': new Date().toISOString(),
    };

    if (initialProgress) {
      updateExpression += ', #progress = :progress';
      expressionAttributeNames['#progress'] = 'progress';
      expressionAttributeValues[':progress'] = initialProgress;
    }

    await this.docClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { id: syncId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    }));

    console.log(`Started sync: ${syncId}`);
  }

  /**
   * Update sync progress
   */
  async updateProgress(
    syncId: string,
    progress: SyncStatusRecord['progress']
  ): Promise<void> {
    await this.docClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { id: syncId },
      UpdateExpression: 'SET #progress = :progress',
      ExpressionAttributeNames: {
        '#progress': 'progress',
      },
      ExpressionAttributeValues: {
        ':progress': progress,
      },
    }));
  }

  /**
   * Complete sync with results
   */
  async completeSyncSuccess(
    syncId: string,
    result: SyncStatusRecord['result']
  ): Promise<void> {
    const endTime = new Date().toISOString();
    
    // Get the start time to calculate duration
    const currentRecord = await this.getSyncStatus(syncId);
    let duration = 0;
    if (currentRecord?.startTime) {
      duration = Date.now() - new Date(currentRecord.startTime).getTime();
    }

    await this.docClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { id: syncId },
      UpdateExpression: 'SET #status = :status, #endTime = :endTime, #duration = :duration, #result = :result',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#endTime': 'endTime',
        '#duration': 'duration',
        '#result': 'result',
      },
      ExpressionAttributeValues: {
        ':status': 'completed',
        ':endTime': endTime,
        ':duration': duration,
        ':result': result,
      },
    }));

    console.log(`Completed sync: ${syncId} (duration: ${duration}ms)`);
  }

  /**
   * Mark sync as failed
   */
  async completeSyncFailure(
    syncId: string,
    error: string,
    partialResult?: SyncStatusRecord['result']
  ): Promise<void> {
    const endTime = new Date().toISOString();
    
    // Get the start time to calculate duration
    const currentRecord = await this.getSyncStatus(syncId);
    let duration = 0;
    if (currentRecord?.startTime) {
      duration = Date.now() - new Date(currentRecord.startTime).getTime();
    }

    let updateExpression = 'SET #status = :status, #endTime = :endTime, #duration = :duration, #error = :error';
    const expressionAttributeNames: Record<string, string> = {
      '#status': 'status',
      '#endTime': 'endTime',
      '#duration': 'duration',
      '#error': 'error',
    };
    const expressionAttributeValues: Record<string, any> = {
      ':status': 'failed',
      ':endTime': endTime,
      ':duration': duration,
      ':error': error,
    };

    if (partialResult) {
      updateExpression += ', #result = :result';
      expressionAttributeNames['#result'] = 'result';
      expressionAttributeValues[':result'] = partialResult;
    }

    await this.docClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { id: syncId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    }));

    console.log(`Failed sync: ${syncId} (duration: ${duration}ms, error: ${error})`);
  }

  /**
   * Get sync status by ID
   */
  async getSyncStatus(syncId: string): Promise<SyncStatusRecord | null> {
    const response = await this.docClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { id: syncId },
    }));

    return (response.Item ? response.Item as SyncStatusRecord : null);
  }

  /**
   * Get recent sync statuses. If `type` is provided, queries the
   * TypeIndex GSI directly. If omitted, fans out one query per known
   * sync type in parallel, merges the results, sorts by `timestamp`
   * descending, and returns the first `limit` records — the table has
   * no GSI that covers "all types sorted by timestamp", so this is the
   * cheapest correct path without adding an index.
   */
  async getRecentSyncStatuses(
    type?: SyncType,
    limit: number = 10
  ): Promise<SyncStatusRecord[]> {
    if (type) {
      const command = new QueryCommand({
        TableName: this.tableName,
        IndexName: 'TypeIndex',
        KeyConditionExpression: '#type = :type',
        ExpressionAttributeNames: {
          '#type': 'type',
        },
        ExpressionAttributeValues: {
          ':type': type,
        },
        ScanIndexForward: false, // Sort by timestamp descending
        Limit: limit,
      });
      const response = await this.docClient.send(command) as QueryCommandOutput;
      return (response.Items ? response.Items as SyncStatusRecord[] : []);
    }

    const perTypeResults = await Promise.all(
      VALID_SYNC_TYPES.map(async (t) => {
        const response = await this.docClient.send(new QueryCommand({
          TableName: this.tableName,
          IndexName: 'TypeIndex',
          KeyConditionExpression: '#type = :type',
          ExpressionAttributeNames: { '#type': 'type' },
          ExpressionAttributeValues: { ':type': t },
          ScanIndexForward: false,
          Limit: limit,
        })) as QueryCommandOutput;
        return (response.Items ?? []) as SyncStatusRecord[];
      })
    );

    return perTypeResults
      .flat()
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }
}