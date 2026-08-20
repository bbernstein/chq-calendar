import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CreateTableCommand, DescribeTableCommand, ListTablesCommand } from '@aws-sdk/client-dynamodb';

const dynamoClient = new DynamoDBClient({
  region: process.env.DYNAMODB_REGION || 'us-east-1',
  endpoint: process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'dummy',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'dummy'
  }
});

const EVENTS_TABLE_NAME = process.env.EVENTS_TABLE_NAME || 'chautauqua-calendar-events';
const DATA_SOURCES_TABLE_NAME = process.env.DATA_SOURCES_TABLE_NAME || 'chautauqua-calendar-data-sources';
const FEEDBACK_TABLE_NAME = process.env.FEEDBACK_TABLE_NAME || 'chautauqua-calendar-feedback';

// This script runs at backend container start (see backend/Dockerfile.dev),
// and docker-compose's depends_on only orders container start — it does not
// wait for DynamoDB Local to be accepting connections. Poll until it is,
// bounded so a missing/unreachable endpoint fails with a clear message
// instead of hanging forever.
async function waitForDynamoDB(timeoutSeconds = 60): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let logged = false;
  for (;;) {
    try {
      await dynamoClient.send(new ListTablesCommand({ Limit: 1 }));
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(
          `DynamoDB not reachable at ${process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000'} after ${timeoutSeconds}s: ${error}`
        );
      }
      if (!logged) {
        console.log('⏳ Waiting for DynamoDB to accept connections...');
        logged = true;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

async function tableExists(tableName: string): Promise<boolean> {
  try {
    const command = new DescribeTableCommand({ TableName: tableName });
    await dynamoClient.send(command);
    return true;
  } catch {
    return false;
  }
}

async function createEventsTable(): Promise<void> {
  const exists = await tableExists(EVENTS_TABLE_NAME);
  if (exists) {
    console.log(`✅ Table ${EVENTS_TABLE_NAME} already exists`);
    return;
  }

  console.log(`📋 Creating table ${EVENTS_TABLE_NAME}...`);
  
  const command = new CreateTableCommand({
    TableName: EVENTS_TABLE_NAME,
    AttributeDefinitions: [
      {
        AttributeName: 'id',
        AttributeType: 'S'
      },
      {
        AttributeName: 'startDate',
        AttributeType: 'S'
      },
      {
        AttributeName: 'category',
        AttributeType: 'S'
      },
      {
        AttributeName: 'week',
        AttributeType: 'N'
      }
    ],
    KeySchema: [
      {
        AttributeName: 'id',
        KeyType: 'HASH'
      }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'DateIndex',
        KeySchema: [
          {
            AttributeName: 'startDate',
            KeyType: 'HASH'
          }
        ],
        Projection: {
          ProjectionType: 'ALL'
        },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5
        }
      },
      {
        IndexName: 'CategoryIndex',
        KeySchema: [
          {
            AttributeName: 'category',
            KeyType: 'HASH'
          },
          {
            AttributeName: 'startDate',
            KeyType: 'RANGE'
          }
        ],
        Projection: {
          ProjectionType: 'ALL'
        },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5
        }
      },
      {
        IndexName: 'WeekIndex',
        KeySchema: [
          {
            AttributeName: 'week',
            KeyType: 'HASH'
          },
          {
            AttributeName: 'startDate',
            KeyType: 'RANGE'
          }
        ],
        Projection: {
          ProjectionType: 'ALL'
        },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5
        }
      }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  });

  await dynamoClient.send(command);
  console.log(`✅ Created table ${EVENTS_TABLE_NAME}`);
}

async function createDataSourcesTable(): Promise<void> {
  const exists = await tableExists(DATA_SOURCES_TABLE_NAME);
  if (exists) {
    console.log(`✅ Table ${DATA_SOURCES_TABLE_NAME} already exists`);
    return;
  }

  console.log(`📋 Creating table ${DATA_SOURCES_TABLE_NAME}...`);
  
  const command = new CreateTableCommand({
    TableName: DATA_SOURCES_TABLE_NAME,
    AttributeDefinitions: [
      {
        AttributeName: 'id',
        AttributeType: 'S'
      }
    ],
    KeySchema: [
      {
        AttributeName: 'id',
        KeyType: 'HASH'
      }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  });

  await dynamoClient.send(command);
  console.log(`✅ Created table ${DATA_SOURCES_TABLE_NAME}`);
}

// Mirrors the production schema in infrastructure/main.tf
// (aws_dynamodb_table.feedback): id hash key plus the TimestampIndex GSI.
// adminHandler.ts reads this table at four call sites, so local admin
// feedback endpoints fail without it.
async function createFeedbackTable(): Promise<void> {
  const exists = await tableExists(FEEDBACK_TABLE_NAME);
  if (exists) {
    console.log(`✅ Table ${FEEDBACK_TABLE_NAME} already exists`);
    return;
  }

  console.log(`📋 Creating table ${FEEDBACK_TABLE_NAME}...`);

  const command = new CreateTableCommand({
    TableName: FEEDBACK_TABLE_NAME,
    AttributeDefinitions: [
      {
        AttributeName: 'id',
        AttributeType: 'S'
      },
      {
        AttributeName: 'timestamp',
        AttributeType: 'N'
      }
    ],
    KeySchema: [
      {
        AttributeName: 'id',
        KeyType: 'HASH'
      }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'TimestampIndex',
        KeySchema: [
          {
            AttributeName: 'timestamp',
            KeyType: 'HASH'
          }
        ],
        Projection: {
          ProjectionType: 'ALL'
        },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5
        }
      }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  });

  await dynamoClient.send(command);
  console.log(`✅ Created table ${FEEDBACK_TABLE_NAME}`);
}

async function main() {
  try {
    console.log('🚀 Initializing DynamoDB tables for local development...');

    await waitForDynamoDB();
    await createEventsTable();
    await createDataSourcesTable();
    await createFeedbackTable();

    console.log('✅ All tables initialized successfully!');
    
    // Wait a moment for tables to be ready
    console.log('⏳ Waiting for tables to be ready...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('🎉 Database initialization complete!');
  } catch (error) {
    console.error('❌ Error initializing tables:', error);
    process.exit(1);
  }
}

main();