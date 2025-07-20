#!/usr/bin/env node

const readline = require('readline');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { EventsCalendarDataSyncService } = require('../dist/services/eventsCalendarDataSyncService');
const { EventsCalendarApiClient } = require('../dist/services/eventsCalendarApiClient');

// Configuration for different environments
const ENVIRONMENTS = {
  localhost: {
    dynamodb: {
      endpoint: 'http://localhost:8000',
      region: 'us-east-1',
      tableName: 'chq-calendar-events'
    },
    api: {
      // Still uses production API by default for localhost
      // You can change this to a local mock API if you have one
      url: 'https://www.chq.org/wp-json/tribe/events/v1'
    }
  },
  production: {
    dynamodb: {
      region: 'us-east-1',
      tableName: 'chautauqua-calendar-events'  // Updated to match Terraform
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

function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function selectEnvironment() {
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

async function selectSyncType() {
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

async function getCustomDateRange() {
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

async function confirmAction(environment, syncType, dateRange = null) {
  const envName = environment.toUpperCase();
  const config = ENVIRONMENTS[environment];
  
  console.log(`\n⚠️  Sync Configuration:`);
  console.log(`   Environment: ${envName}`);
  console.log(`   DynamoDB Table: ${config.dynamodb.tableName}`);
  console.log(`   DynamoDB Endpoint: ${config.dynamodb.endpoint || 'AWS'}`);
  console.log(`   API Source: ${config.api.url}`);
  console.log(`   Sync Type: ${syncType}`);
  
  if (dateRange) {
    console.log(`   Date Range: ${dateRange.startDate} to ${dateRange.endDate}`);
  }
  
  if (environment === 'production') {
    console.log('\n   ⚠️  WARNING: This will affect PRODUCTION DynamoDB!');
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

async function createDynamoDBClient(environment) {
  const config = ENVIRONMENTS[environment].dynamodb;
  
  const clientConfig = {
    region: config.region
  };
  
  if (environment === 'localhost') {
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

async function performSync(environment, syncType, dateRange = null) {
  const config = ENVIRONMENTS[environment];
  
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
    
  } catch (error) {
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

async function checkPrerequisites() {
  const fs = require('fs');
  const path = require('path');
  
  // Check if dist directory exists
  const distPath = path.join(__dirname, '../dist');
  if (!fs.existsSync(distPath)) {
    console.log('❌ Compiled JavaScript files not found.');
    console.log('   Please build the project first:');
    console.log('   npm run build');
    process.exit(1);
  }
  
  // Check if required service files exist
  const requiredFiles = [
    '../dist/services/eventsCalendarDataSyncService.js',
    '../dist/services/eventsCalendarApiClient.js'
  ];
  
  for (const file of requiredFiles) {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) {
      console.log(`❌ Required file not found: ${file}`);
      console.log('   Please build the project first:');
      console.log('   npm run build');
      process.exit(1);
    }
  }
}

async function main() {
  try {
    await checkPrerequisites();
    
    const environment = await selectEnvironment();
    const syncType = await selectSyncType();
    
    let dateRange = null;
    if (syncType === 'custom-range') {
      dateRange = await getCustomDateRange();
    }
    
    const confirmed = await confirmAction(environment, syncType, dateRange);
    
    if (!confirmed) {
      process.exit(0);
    }
    
    await performSync(environment, syncType, dateRange);
    
    console.log('\n🎉 Sync operation completed successfully!');
    
  } catch (error) {
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