import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EventsCalendarDataSyncService } from '../services/eventsCalendarDataSyncService';
import { SyncStatusService, SyncType, VALID_SYNC_TYPES } from '../services/syncStatusService';

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
 * Compute the default year using the Oct 1 turnover rule:
 * If current month is October or later, default to next year; otherwise current year.
 */
function getDefaultYear(): number {
  const now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

/**
 * Scheduled sync handler - triggered by EventBridge rules
 */
export const scheduledSyncHandler = async (event: any, _context: Context): Promise<void> => {
  console.log('Starting scheduled sync operation:', JSON.stringify(event));

  try {
    const defaultYear = getDefaultYear();
    const detailType = event['detail-type'];

    if (detailType === 'Hourly Sync') {
      // Hourly: only runs June-August, syncs near-term events
      const currentMonth = new Date().getMonth(); // 0-indexed
      if (currentMonth < 5 || currentMonth > 7) {
        console.log(`Skipping hourly sync — current month ${currentMonth + 1} is outside June–August`);
        return;
      }
      console.log(`Performing hourly near-term sync for ${defaultYear}`);
      const result = await syncService.syncNearTerm(defaultYear);
      console.log('Hourly sync completed:', result);

    } else if (detailType === 'Daily Sync') {
      console.log(`Performing daily sync: current year ${defaultYear}, next year ${defaultYear + 1}`);
      const result = await syncService.syncDistantFuture(defaultYear, defaultYear + 1);
      console.log('Daily sync completed:', result);

    } else if (detailType === 'Weekly Full Sync') {
      // Full refresh: all years that may have data
      console.log('Performing weekly full sync');
      for (const year of [defaultYear - 1, defaultYear, defaultYear + 1]) {
        console.log(`Full sync for year ${year}`);
        await syncService.syncFullYearEvents(year);
      }

    } else {
      // Default: incremental sync
      console.log('Performing incremental sync');
      const result = await syncService.performIncrementalSync();
      console.log('Incremental sync completed:', result);
    }
  } catch (error) {
    console.error('Sync failed:', error);
    throw error;
  }
};

/**
 * Manual sync handler - triggered via API Gateway
 */
export const manualSyncHandler = async (event: APIGatewayProxyEvent, _context: Context): Promise<APIGatewayProxyResult> => {
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
export const healthCheckHandler = async (_event: APIGatewayProxyEvent, _context: Context): Promise<APIGatewayProxyResult> => {
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
export const syncStatusHandler = async (event: APIGatewayProxyEvent, _context: Context): Promise<APIGatewayProxyResult> => {
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
const MAX_SYNC_LIST_LIMIT = 100;

export const syncListHandler = async (event: APIGatewayProxyEvent, _context: Context): Promise<APIGatewayProxyResult> => {
  try {
    const queryParams = event.queryStringParameters || {};
    const { type, limit = '10' } = queryParams;

    const errorHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    };

    if (type !== undefined && !VALID_SYNC_TYPES.includes(type as SyncType)) {
      return {
        statusCode: 400,
        headers: errorHeaders,
        body: JSON.stringify({
          error: 'Invalid sync type',
          allowed: VALID_SYNC_TYPES,
        }),
      };
    }

    const parsedLimit = Number.parseInt(limit, 10);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_SYNC_LIST_LIMIT) {
      return {
        statusCode: 400,
        headers: errorHeaders,
        body: JSON.stringify({
          error: 'Invalid limit',
          message: `limit must be an integer between 1 and ${MAX_SYNC_LIST_LIMIT}`,
        }),
      };
    }

    const syncs = await statusService.getRecentSyncStatuses(type as SyncType | undefined, parsedLimit);

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
