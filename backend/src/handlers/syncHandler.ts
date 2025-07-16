import { APIGatewayProxyEvent, APIGatewayProxyResult, ScheduledEvent } from 'aws-lambda';
import { DataSyncService } from '../services/dataSyncService';
import { EventsCalendarDataSyncService } from '../services/eventsCalendarDataSyncService';
import { SyncStatusService } from '../services/syncStatusService';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// Feature flag to switch between old and new sync services
const USE_NEW_API = process.env.USE_NEW_API === 'true';

// Initialize DynamoDB client
const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

// Initialize sync status service
const syncStatusService = new SyncStatusService(docClient);

/**
 * Lambda handler for scheduled sync operations
 */
export const scheduledSyncHandler = async (event: ScheduledEvent): Promise<void> => {
  console.log('Starting scheduled sync operation:', JSON.stringify(event, null, 2));
  
  try {
    let result;
    
    if (USE_NEW_API) {
      const newSyncService = new EventsCalendarDataSyncService(undefined, docClient);
      
      // Check event source to determine sync frequency
      const ruleName = event.source === 'aws.events' ? event['detail-type'] : 'default';
      
      switch (ruleName) {
        case 'Hourly Sync':
          result = await newSyncService.performIncrementalSync();
          break;
        case 'Daily Sync':
          result = await newSyncService.performIncrementalSync();
          break;
        case 'Weekly Full Sync':
          result = await newSyncService.syncAllSeasonEvents();
          break;
        default:
          result = await newSyncService.performIncrementalSync();
      }
      
      console.log('New API sync completed:', {
        success: result.success,
        eventsProcessed: result.eventsProcessed,
        eventsCreated: result.eventsCreated,
        eventsUpdated: result.eventsUpdated,
        eventsDeleted: result.eventsDeleted,
        errorCount: result.errors.length,
        duration: result.duration
      });
    } else {
      const syncService = new DataSyncService();
      
      // Determine sync scope based on schedule frequency
      let monthsToSync = 3; // Default
      let forceUpdate = false;
      
      // Check event source to determine sync frequency
      const ruleName = event.source === 'aws.events' ? event['detail-type'] : 'default';
      
      switch (ruleName) {
        case 'Hourly Sync':
          monthsToSync = 1; // Current month only for hourly syncs
          break;
        case 'Daily Sync':
          monthsToSync = 3; // Standard 3-month window
          break;
        case 'Weekly Full Sync':
          monthsToSync = 6; // Extended window for weekly full syncs
          forceUpdate = true;
          break;
        default:
          monthsToSync = 3;
      }
      
      console.log(`Syncing ${monthsToSync} months, forceUpdate: ${forceUpdate}`);
      
      result = await syncService.syncEventData({
        monthsToSync,
        forceUpdate,
      });
      
      console.log('Legacy sync completed:', {
        success: result.success,
        eventsAdded: result.eventsAdded,
        eventsUpdated: result.eventsUpdated,
        eventsSkipped: result.eventsSkipped,
        errorCount: result.errors.length,
      });
    }
    
    // Log errors if any
    if (result.errors.length > 0) {
      console.error('Sync errors:', result.errors.slice(0, 10)); // Log first 10 errors
    }
    
  } catch (error) {
    console.error('Scheduled sync failed:', error);
    throw error; // Re-throw to trigger Lambda error handling
  }
};

/**
 * API Gateway handler for manual sync operations
 */
export const manualSyncHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Manual sync requested:', JSON.stringify(event, null, 2));
  
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { syncType = 'incremental', year = 2025, monthsToSync = 3, forceUpdate = false } = body;
    
    // Create sync status record
    const syncId = await syncStatusService.createSyncStatus(
      'manual',
      event.requestContext.requestId,
      { syncType, year, monthsToSync, forceUpdate }
    );
    
    // Start async sync execution
    console.log(`Starting async sync: ${syncId}`);
    
    // Don't await this - let it run asynchronously
    performAsyncSync(syncId, syncType, year, monthsToSync, forceUpdate).catch(error => {
      console.error(`Async sync ${syncId} failed:`, error);
    });
    
    // Return immediately with sync ID
    return {
      statusCode: 202, // Accepted
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        syncId,
        status: 'started',
        message: 'Sync started successfully. Use the sync ID to check progress.',
        statusEndpoint: `/sync/status/${syncId}`,
      }),
    };
    
  } catch (error) {
    console.error('Manual sync failed to start:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

/**
 * Perform sync asynchronously
 */
async function performAsyncSync(
  syncId: string,
  syncType: string,
  year: number,
  monthsToSync: number,
  forceUpdate: boolean
): Promise<void> {
  try {
    // Mark sync as in progress
    await syncStatusService.startSync(syncId, {
      currentStep: 'Initializing',
      totalSteps: 3,
      completedSteps: 0,
      percentage: 0,
    });
    
    let result;
    
    if (USE_NEW_API) {
      const newSyncService = new EventsCalendarDataSyncService(undefined, docClient);
      
      // Update progress
      await syncStatusService.updateProgress(syncId, {
        currentStep: 'Connecting to API',
        totalSteps: 3,
        completedSteps: 1,
        percentage: 33,
      });
      
      if (syncType === 'full') {
        result = await newSyncService.syncAllSeasonEvents(year);
      } else {
        result = await newSyncService.performIncrementalSync();
      }
    } else {
      const syncService = new DataSyncService(docClient);
      
      // Update progress
      await syncStatusService.updateProgress(syncId, {
        currentStep: 'Fetching events',
        totalSteps: 3,
        completedSteps: 1,
        percentage: 33,
      });
      
      result = await syncService.syncEventData({
        monthsToSync,
        forceUpdate,
      });
    }
    
    // Update progress
    await syncStatusService.updateProgress(syncId, {
      currentStep: 'Finalizing',
      totalSteps: 3,
      completedSteps: 2,
      percentage: 66,
    });
    
    // Mark sync as completed
    await syncStatusService.completeSyncSuccess(syncId, {
      eventsProcessed: result.eventsProcessed || (result.eventsAdded + result.eventsUpdated + result.eventsSkipped),
      eventsCreated: result.eventsCreated || result.eventsAdded,
      eventsUpdated: result.eventsUpdated || 0,
      eventsDeleted: result.eventsDeleted || 0,
      eventsSkipped: result.eventsSkipped || 0,
      errors: result.errors || [],
    });
    
    console.log(`Async sync ${syncId} completed successfully`);
    
  } catch (error) {
    console.error(`Async sync ${syncId} failed:`, error);
    
    await syncStatusService.completeSyncFailure(
      syncId,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

/**
 * Sync status polling handler
 */
export const syncStatusHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const syncId = event.pathParameters?.syncId;
    
    if (!syncId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: 'Missing sync ID',
        }),
      };
    }
    
    const syncStatus = await syncStatusService.getSyncStatus(syncId);
    
    if (!syncStatus) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: 'Sync not found',
        }),
      };
    }
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        syncId: syncStatus.id,
        status: syncStatus.status,
        type: syncStatus.type,
        startTime: syncStatus.startTime,
        endTime: syncStatus.endTime,
        duration: syncStatus.duration,
        progress: syncStatus.progress,
        result: syncStatus.result,
        error: syncStatus.error,
        timestamp: syncStatus.timestamp,
      }),
    };
    
  } catch (error) {
    console.error('Sync status check failed:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

/**
 * List recent sync statuses
 */
export const syncListHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const queryParams = event.queryStringParameters || {};
    const type = queryParams.type as any; // Type filtering
    const limit = parseInt(queryParams.limit || '10', 10);
    
    const recentSyncs = await syncStatusService.getRecentSyncStatuses(type, limit);
    const activeSyncs = await syncStatusService.getActiveSyncs();
    const stats = await syncStatusService.getSyncStatistics();
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        activeSyncs,
        recentSyncs,
        statistics: stats,
      }),
    };
    
  } catch (error) {
    console.error('Sync list failed:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

/**
 * Health check handler for monitoring
 */
export const healthCheckHandler = async (): Promise<APIGatewayProxyResult> => {
  try {
    let healthData;
    
    if (USE_NEW_API) {
      const newSyncService = new EventsCalendarDataSyncService(undefined, docClient);
      const health = await newSyncService.getHealthStatus();
      const stats = await newSyncService.getSyncStatistics();
      
      healthData = {
        status: health.healthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        apiType: 'events-calendar-api',
        health: health,
        stats: stats,
      };
    } else {
      const syncService = new DataSyncService();
      const eventsNeedingSync = await syncService.getEventsNeedingSync();
      
      healthData = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        apiType: 'legacy-ics',
        eventsNeedingSync: eventsNeedingSync.length,
        events: eventsNeedingSync.slice(0, 5).map(event => ({
          id: event.id,
          title: event.title,
          startDate: event.startDate,
          syncStatus: event.syncStatus,
        })),
      };
    }
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(healthData),
    };
    
  } catch (error) {
    console.error('Health check failed:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};