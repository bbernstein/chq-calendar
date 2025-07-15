import { APIGatewayProxyEvent, APIGatewayProxyResult, ScheduledEvent } from 'aws-lambda';
import { DataSyncService } from '../services/dataSyncService';

/**
 * Lambda handler for scheduled sync operations
 */
export const scheduledSyncHandler = async (event: ScheduledEvent): Promise<void> => {
  console.log('Starting scheduled sync operation:', JSON.stringify(event, null, 2));
  
  try {
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
    
    const result = await syncService.syncEventData({
      monthsToSync,
      forceUpdate,
    });
    
    console.log('Sync completed:', {
      success: result.success,
      eventsAdded: result.eventsAdded,
      eventsUpdated: result.eventsUpdated,
      eventsSkipped: result.eventsSkipped,
      errorCount: result.errors.length,
    });
    
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
    const { monthsToSync = 3, forceUpdate = false } = body;
    
    const syncService = new DataSyncService();
    
    const result = await syncService.syncEventData({
      monthsToSync,
      forceUpdate,
    });
    
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
 * Health check handler for monitoring
 */
export const healthCheckHandler = async (): Promise<APIGatewayProxyResult> => {
  try {
    const syncService = new DataSyncService();
    const eventsNeedingSync = await syncService.getEventsNeedingSync();
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        eventsNeedingSync: eventsNeedingSync.length,
        events: eventsNeedingSync.slice(0, 5).map(event => ({
          id: event.id,
          title: event.title,
          startDate: event.startDate,
          syncStatus: event.syncStatus,
        })),
      }),
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