#!/usr/bin/env ts-node

import * as readline from 'readline';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { EventsCalendarDataSyncService } from '../services/eventsCalendarDataSyncService';
import { EventsCalendarApiClient } from '../services/eventsCalendarApiClient';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Configuration for different environments
const ENVIRONMENTS = {
  localhost: {
    dynamodb: {
      endpoint: 'http://localhost:8000',
      region: 'us-east-1',
      tableName: 'chautauqua-calendar-events'
    },
    api: {
      url: 'https://www.chq.org/wp-json/tribe/events/v1'
    }
  },
  production: {
    dynamodb: {
      region: process.env.AWS_REGION || 'us-east-1',
      tableName: process.env.EVENTS_TABLE_NAME || 'chautauqua-calendar-events'
    },
    api: {
      url: 'https://www.chq.org/wp-json/tribe/events/v1'
    }
  }
};

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function selectEnvironment(): Promise<string> {
  console.log('\n🔧 Chautauqua Calendar - Full Season Sync Trigger\n');
  console.log('Available environments:');
  console.log('1. localhost (DynamoDB Local) - Stores in local DB, fetches from production API');
  console.log('2. production (AWS DynamoDB) - Stores in AWS, fetches from production API');
  
  const choice = await prompt('\nSelect environment (1 or 2): ');
  
  switch (choice) {
    case '1':
      return 'localhost';
    case '2':
      return 'production';
    default:
      console.log('❌ Invalid choice. Please select 1 or 2.');
      return await selectEnvironment();
  }
}

async function selectSyncType(): Promise<string> {
  console.log('\nSync types available:');
  console.log('1. Full Season Sync (all events for the season)');
  console.log('2. Incremental Sync (recent changes only)');
  console.log('3. Custom Date Range Sync');
  
  const choice = await prompt('\nSelect sync type (1, 2, or 3): ');
  
  switch (choice) {
    case '1':
      return 'full-season';
    case '2':
      return 'incremental';
    case '3':
      return 'custom-range';
    default:
      console.log('❌ Invalid choice. Please select 1, 2, or 3.');
      return await selectSyncType();
  }
}

async function askAboutCacheUpload(): Promise<boolean> {
  console.log('\nCache Upload Options:');
  console.log('1. Yes - Upload generated cache file to S3 for production use');
  console.log('2. No - Only sync to DynamoDB');
  
  const choice = await prompt('\nUpload cache file to S3? (1 or 2): ');
  
  switch (choice) {
    case '1':
      return true;
    case '2':
      return false;
    default:
      console.log('❌ Invalid choice. Please select 1 or 2.');
      return await askAboutCacheUpload();
  }
}

async function getCustomDateRange(): Promise<{ startDate: string; endDate: string }> {
  console.log('\nEnter custom date range (YYYY-MM-DD format):');
  const startDate = await prompt('Start date: ');
  const endDate = await prompt('End date: ');
  
  // Basic validation
  if (!startDate.match(/^\d{4}-\d{2}-\d{2}$/) || !endDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    console.log('❌ Invalid date format. Please use YYYY-MM-DD format.');
    return await getCustomDateRange();
  }
  
  return { startDate, endDate };
}

async function confirmAction(
  environment: string, 
  syncType: string, 
  uploadCache: boolean,
  dateRange: { startDate: string; endDate: string } | null = null
): Promise<boolean> {
  const envName = environment.toUpperCase();
  const config = ENVIRONMENTS[environment as keyof typeof ENVIRONMENTS];
  
  console.log(`\n⚠️  Sync Configuration:`);
  console.log(`   Environment: ${envName}`);
  console.log(`   DynamoDB Table: ${config.dynamodb.tableName}`);
  console.log(`   DynamoDB Endpoint: ${'endpoint' in config.dynamodb ? config.dynamodb.endpoint : 'AWS'}`);
  console.log(`   API Source: ${config.api.url}`);
  console.log(`   Sync Type: ${syncType}`);
  console.log(`   Upload Cache: ${uploadCache ? 'Yes' : 'No'}`);
  
  if (dateRange) {
    console.log(`   Date Range: ${dateRange.startDate} to ${dateRange.endDate}`);
  }
  
  if (uploadCache) {
    console.log(`   S3 Bucket: ${process.env.FRONTEND_S3_BUCKET || 'chautauqua-calendar-frontend-prod'}`);
  }
  
  if (environment === 'production') {
    console.log('\n   ⚠️  WARNING: This will affect PRODUCTION DynamoDB!');
    if (uploadCache) {
      console.log('   ⚠️  WARNING: This will upload cache to PRODUCTION S3!');
    }
  } else {
    console.log('\n   ℹ️  Note: This will fetch events from the production API');
    console.log('   but store them in your local DynamoDB instance.');
  }
  
  const confirm = await prompt('\nAre you sure you want to proceed? (yes/no): ');
  
  if (confirm.toLowerCase() !== 'yes') {
    console.log('❌ Operation cancelled.');
    return false;
  }
  
  return true;
}

async function createDynamoDBClient(environment: string): Promise<DynamoDBDocumentClient> {
  const config = ENVIRONMENTS[environment as keyof typeof ENVIRONMENTS].dynamodb;
  
  const clientConfig: any = {
    region: config.region
  };
  
  if (environment === 'localhost' && 'endpoint' in config) {
    clientConfig.endpoint = config.endpoint;
    clientConfig.credentials = {
      accessKeyId: 'dummy',
      secretAccessKey: 'dummy'
    };
  }
  
  const client = new DynamoDBClient(clientConfig);
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true
    }
  });
}

async function uploadCacheToS3(dbClient: DynamoDBDocumentClient): Promise<void> {
  console.log('\n📤 Uploading cache file to S3...');
  
  const frontendBucket = process.env.FRONTEND_S3_BUCKET || 'chautauqua-calendar-frontend-prod';
  const cachePrefix = 'cache/calendar-cache';
  
  try {
    // Initialize S3 client
    const s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
    });

    // Fetch all events from DynamoDB
    console.log('   📊 Fetching all events from DynamoDB...');
    const scanParams = {
      TableName: process.env.EVENTS_TABLE_NAME || 'chautauqua-calendar-events',
    };

    const events: any[] = [];
    let lastEvaluatedKey;

    do {
      const scanCommand = new ScanCommand({
        ...scanParams,
        ExclusiveStartKey: lastEvaluatedKey,
      });
      
      const response = await dbClient.send(scanCommand);
      
      if (response.Items) {
        events.push(...response.Items);
      }
      
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    console.log(`   📊 Retrieved ${events.length} events from DynamoDB`);

    // Sort events by date
    events.sort((a, b) => {
      const dateA = new Date(a.startDate || a.dateTime);
      const dateB = new Date(b.startDate || b.dateTime);
      return dateA.getTime() - dateB.getTime();
    });

    // Create the cache data structure matching what the frontend expects
    const cacheData = {
      data: events,
      timestamp: Date.now(),
      expiry: Date.now() + (60 * 60 * 1000), // 1 hour expiry
      cacheKey: 'all-events'
    };

    // Upload to S3 frontend bucket
    const s3Key = `${cachePrefix}/all-events.json`;
    
    console.log(`   ☁️  Uploading to S3: s3://${frontendBucket}/${s3Key}`);
    
    const putCommand = new PutObjectCommand({
      Bucket: frontendBucket,
      Key: s3Key,
      Body: JSON.stringify(cacheData, null, 2),
      ContentType: 'application/json',
      CacheControl: 'public, max-age=3600', // 1 hour cache
    });

    await s3Client.send(putCommand);
    
    console.log('   ✅ Successfully uploaded all-events.json to S3!');
    console.log(`   🌐 File accessible at: https://www.chqcal.org/${s3Key}`);

  } catch (error) {
    console.error('❌ Cache upload failed:', error);
    throw error;
  }
}

async function performSync(
  environment: string, 
  syncType: string, 
  uploadCache: boolean,
  dateRange: { startDate: string; endDate: string } | null = null
): Promise<void> {
  const config = ENVIRONMENTS[environment as keyof typeof ENVIRONMENTS];
  
  try {
    console.log('\n🔄 Initializing sync service...');
    
    // Create DynamoDB client
    const dbClient = await createDynamoDBClient(environment);
    
    // Set table name environment variable
    process.env.EVENTS_TABLE_NAME = config.dynamodb.tableName;
    
    // Create API client with the appropriate endpoint
    const apiClient = new EventsCalendarApiClient(config.api.url);
    
    // Create sync service with both clients
    const syncService = new EventsCalendarDataSyncService(apiClient, dbClient);
    
    console.log('🚀 Starting sync operation...');
    console.log(`📡 Fetching events from: ${config.api.url}`);
    console.log(`💾 Storing events in: ${environment === 'localhost' ? 'Local DynamoDB' : 'AWS DynamoDB'}`);
    
    const startTime = Date.now();
    
    let result;
    
    switch (syncType) {
      case 'full-season':
        result = await syncService.syncAllSeasonEvents(new Date().getFullYear());
        break;
      case 'incremental':
        result = await syncService.performIncrementalSync();
        break;
      case 'custom-range':
        if (!dateRange) throw new Error('Date range required for custom-range sync');
        result = await syncService.syncDateRange(dateRange.startDate, dateRange.endDate);
        break;
      default:
        throw new Error('Invalid sync type');
    }
    
    const duration = Date.now() - startTime;
    
    console.log('\n✅ Sync completed!');
    console.log('📊 Results:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Events Processed: ${result.eventsProcessed}`);
    console.log(`   Events Created: ${result.eventsCreated}`);
    console.log(`   Events Updated: ${result.eventsUpdated}`);
    console.log(`   Events Deleted: ${result.eventsDeleted}`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Sync Duration: ${result.duration}ms`);
    
    if (result.errors && result.errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      result.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

    // Upload cache if requested
    if (uploadCache && result.success) {
      await uploadCacheToS3(dbClient);
    }
    
  } catch (error: any) {
    console.error('❌ Error during sync:', error.message);
    
    if (environment === 'localhost' && error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 Troubleshooting tips for DynamoDB Local:');
      console.log('   • Make sure DynamoDB Local is running on localhost:8000');
      console.log('   • Start DynamoDB Local with:');
      console.log('     java -Djava.library.path=./DynamoDBLocal_lib -jar DynamoDBLocal.jar -sharedDb');
      console.log('   • Verify it\'s running: curl http://localhost:8000');
    }
    
    if (error.message.includes('ResourceNotFoundException')) {
      console.log('\n💡 Table might not exist. Try running:');
      console.log('   npm run init-tables');
    }
    
    throw error;
  }
}

async function main(): Promise<void> {
  try {
    const environment = await selectEnvironment();
    const syncType = await selectSyncType();
    const uploadCache = await askAboutCacheUpload();
    
    let dateRange = null;
    if (syncType === 'custom-range') {
      dateRange = await getCustomDateRange();
    }
    
    const confirmed = await confirmAction(environment, syncType, uploadCache, dateRange);
    
    if (!confirmed) {
      process.exit(0);
    }
    
    await performSync(environment, syncType, uploadCache, dateRange);
    
    console.log('\n🎉 Sync operation completed successfully!');
    
  } catch (error: any) {
    console.error('\n❌ Unexpected error:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n👋 Goodbye!');
  rl.close();
  process.exit(0);
});

// Run the script
if (require.main === module) {
  main();
}