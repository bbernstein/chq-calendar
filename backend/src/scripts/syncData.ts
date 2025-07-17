import { EventsCalendarDataSyncService } from '../services/eventsCalendarDataSyncService';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

async function main() {
  // Initialize DynamoDB client
  const dynamoClient = new DynamoDBClient({
    region: process.env.DYNAMODB_REGION || 'us-east-1',
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
    }),
  });

  const docClient = DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });

  const syncService = new EventsCalendarDataSyncService(undefined, docClient);
  
  console.log('Starting data sync...');
  
  try {
    const forceUpdate = process.argv.includes('--force');
    const year = new Date().getFullYear();
    
    let result;
    if (forceUpdate) {
      console.log(`Performing full season sync for ${year}...`);
      result = await syncService.syncAllSeasonEvents(year);
    } else {
      console.log('Performing incremental sync...');
      result = await syncService.performIncrementalSync();
    }
    
    console.log('Sync completed:');
    console.log(`  Success: ${result.success}`);
    console.log(`  Events processed: ${result.eventsProcessed}`);
    console.log(`  Events created: ${result.eventsCreated}`);
    console.log(`  Events updated: ${result.eventsUpdated}`);
    console.log(`  Events deleted: ${result.eventsDeleted}`);
    console.log(`  Errors: ${result.errors.length}`);
    
    if (result.errors.length > 0) {
      console.log('Errors encountered:');
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
    }
    
    console.log(`  Duration: ${result.duration}ms`);
    
  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  }
}

main();