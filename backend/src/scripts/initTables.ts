import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';

const dynamoClient = new DynamoDBClient({
  region: process.env.DYNAMODB_REGION || 'us-east-1',
  endpoint: process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'dummy',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'dummy'
  }
});

const EVENTS_TABLE_NAME = process.env.EVENTS_TABLE_NAME || 'chq-calendar-events';
const DATA_SOURCES_TABLE_NAME = process.env.DATA_SOURCES_TABLE_NAME || 'chq-calendar-data-sources';

async function tableExists(tableName: string): Promise<boolean> {
  try {
    const command = new DescribeTableCommand({ TableName: tableName });
    await dynamoClient.send(command);
    return true;
  } catch (error) {
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

async function main() {
  try {
    console.log('🚀 Initializing DynamoDB tables for local development...');
    
    await createEventsTable();
    await createDataSourcesTable();
    
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