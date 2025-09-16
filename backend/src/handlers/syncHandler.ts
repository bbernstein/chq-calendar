import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EventsCalendarDataSyncService } from '../services/eventsCalendarDataSyncService';
import { SyncStatusService } from '../services/syncStatusService';

// Initialize DynamoDB clients
const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

// Initialize services
const syncService = new EventsCalendarDataSyncService(undefined, docClient);
const statusService = new SyncStatusService(docClient);

/**
 * Scheduled sync handler - triggered by EventBridge rules
 */
export const scheduledSyncHandler = async (event: any, context: Context): Promise<void> => {
  console.log('Starting scheduled sync operation:', JSON.stringify(event));

  try {
    let result;
    const detailType = event['detail-type'];

    // Get the active year from environment variable or default to current year
    const activeYear = parseInt(process.env.ACTIVE_YEAR || new Date().getFullYear().toString());
    console.log(`Active year configured as: ${activeYear}`);

    if (detailType === 'Weekly Full Sync') {
      console.log(`Performing weekly full year sync for ${activeYear}`);
      // Use full year sync instead of just season
      result = await syncService.syncFullYearEvents(activeYear);
    } else if (detailType === 'Daily Sync') {
      console.log(`Performing daily sync for year ${activeYear}`);
      // Daily sync also uses full year
      result = await syncService.syncFullYearEvents(activeYear);
    } else {
      // Default to hourly sync (incremental)
      console.log('Performing hourly incremental sync');
      result = await syncService.performIncrementalSync();
    }

    console.log('Sync completed:', result);
  } catch (error) {
    console.error('Sync failed:', error);
    throw error;
  }
};

/**
 * Manual sync handler - triggered via API Gateway
 */
export const manualSyncHandler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  console.log('Starting manual sync operation');

  try {
    const requestBody = event.body ? JSON.parse(event.body) : {};
    const { syncType = 'incremental', year } = requestBody;

    let result;

    if (syncType === 'full' && year) {
      console.log(`Performing full sync for year ${year}`);
      result = await syncService.syncAllSeasonEvents(year);
    } else {
      console.log('Performing incremental sync');
      result = await syncService.performIncrementalSync();
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('Manual sync failed:', error);

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
 * Health check handler
 */
export const healthCheckHandler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  try {
    const health = await syncService.getHealthStatus();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(health),
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
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

/**
 * Sync status handler - get status of specific sync
 */
export const syncStatusHandler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  try {
    const syncId = event.pathParameters?.id;

    if (!syncId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Sync ID is required',
        }),
      };
    }

    const status = await statusService.getSyncStatus(syncId);

    if (!status) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
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
      body: JSON.stringify(status),
    };
  } catch (error) {
    console.error('Get sync status failed:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

/**
 * Sync list handler - get list of recent syncs
 */
export const syncListHandler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  try {
    const queryParams = event.queryStringParameters || {};
    const { type, limit = '10' } = queryParams;

    const syncs = await statusService.getRecentSyncStatuses(type, parseInt(limit));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        syncs,
        count: syncs.length,
      }),
    };
  } catch (error) {
    console.error('Get sync list failed:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
