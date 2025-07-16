import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

interface SyncStatusRecord {
  id: string;
  type: 'manual' | 'scheduled' | 'full' | 'incremental' | 'daily' | 'hourly';
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

    return response.Item as SyncStatusRecord || null;
  }

  /**
   * Get recent sync statuses by type
   */
  async getRecentSyncStatuses(
    type?: SyncStatusRecord['type'],
    limit: number = 10
  ): Promise<SyncStatusRecord[]> {
    let command;
    
    if (type) {
      command = new QueryCommand({
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
    } else {
      // If no type specified, we'll need to scan (less efficient)
      command = new QueryCommand({
        TableName: this.tableName,
        IndexName: 'TypeIndex',
        KeyConditionExpression: '#type = :type',
        ExpressionAttributeNames: {
          '#type': 'type',
        },
        ExpressionAttributeValues: {
          ':type': 'manual', // Default to manual syncs
        },
        ScanIndexForward: false,
        Limit: limit,
      });
    }

    const response = await this.docClient.send(command);
    return response.Items as SyncStatusRecord[] || [];
  }

  /**
   * Get currently running syncs
   */
  async getActiveSyncs(): Promise<SyncStatusRecord[]> {
    // We'll need to scan for active syncs since status isn't indexed
    // This is not ideal for large datasets, but acceptable for sync status tracking
    const response = await this.docClient.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: 'TypeIndex',
      KeyConditionExpression: '#type = :type',
      FilterExpression: '#status = :status OR #status = :pendingStatus',
      ExpressionAttributeNames: {
        '#type': 'type',
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':type': 'manual', // Check manual syncs first
        ':status': 'in_progress',
        ':pendingStatus': 'pending',
      },
      ScanIndexForward: false,
      Limit: 50, // Reasonable limit for active syncs
    }));

    return response.Items as SyncStatusRecord[] || [];
  }

  /**
   * Get sync statistics
   */
  async getSyncStatistics(days: number = 7): Promise<{
    totalSyncs: number;
    successfulSyncs: number;
    failedSyncs: number;
    averageDuration: number;
    syncsByType: Record<string, number>;
    recentSyncs: SyncStatusRecord[];
  }> {
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    
    // Get recent syncs for all types
    const recentSyncs = await this.getRecentSyncStatuses(undefined, 100);
    
    // Filter by time and calculate statistics
    const filteredSyncs = recentSyncs.filter(sync => sync.timestamp >= cutoffTime);
    
    const stats = {
      totalSyncs: filteredSyncs.length,
      successfulSyncs: filteredSyncs.filter(s => s.status === 'completed').length,
      failedSyncs: filteredSyncs.filter(s => s.status === 'failed').length,
      averageDuration: 0,
      syncsByType: {} as Record<string, number>,
      recentSyncs: filteredSyncs.slice(0, 10),
    };

    // Calculate average duration for completed syncs
    const completedSyncs = filteredSyncs.filter(s => s.status === 'completed' && s.duration);
    if (completedSyncs.length > 0) {
      const totalDuration = completedSyncs.reduce((sum, sync) => sum + (sync.duration || 0), 0);
      stats.averageDuration = totalDuration / completedSyncs.length;
    }

    // Count syncs by type
    filteredSyncs.forEach(sync => {
      stats.syncsByType[sync.type] = (stats.syncsByType[sync.type] || 0) + 1;
    });

    return stats;
  }

  /**
   * Clean up old sync records
   */
  async cleanupOldRecords(daysToKeep: number = 30): Promise<number> {
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    
    // Get old records
    const oldRecords = await this.getRecentSyncStatuses(undefined, 1000);
    const recordsToDelete = oldRecords.filter(record => record.timestamp < cutoffTime);
    
    // Delete old records
    let deletedCount = 0;
    for (const record of recordsToDelete) {
      try {
        await this.docClient.send(new UpdateCommand({
          TableName: this.tableName,
          Key: { id: record.id },
          UpdateExpression: 'REMOVE #id',
          ExpressionAttributeNames: {
            '#id': 'id',
          },
        }));
        deletedCount++;
      } catch (error) {
        console.error(`Failed to delete sync record ${record.id}:`, error);
      }
    }

    console.log(`Cleaned up ${deletedCount} old sync records`);
    return deletedCount;
  }
}