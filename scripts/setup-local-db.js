#!/usr/bin/env node

const { DynamoDBClient, CreateTableCommand, ListTablesCommand, DeleteTableCommand } = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:8000',
  credentials: {
    accessKeyId: 'dummy',
    secretAccessKey: 'dummy',
  },
});

const tables = [
  {
    TableName: 'chautauqua-calendar-events',
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'category', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'CategoryIndex',
        KeySchema: [
          { AttributeName: 'category', KeyType: 'HASH' }
        ],
        Projection: { ProjectionType: 'ALL' },
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
  },
  {
    TableName: 'chautauqua-calendar-data-sources',
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  },
  {
    TableName: 'chautauqua-calendar-feedback',
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  }
];

async function setupTables() {
  try {
    // Check existing tables
    const listTablesResult = await client.send(new ListTablesCommand({}));
    const existingTables = listTablesResult.TableNames || [];
    console.log('Existing tables:', existingTables);

    // Delete old chq-* tables if they exist
    const oldTables = existingTables.filter(name => name.startsWith('chq-calendar-'));
    for (const tableName of oldTables) {
      console.log(`Deleting old table: ${tableName}`);
      await client.send(new DeleteTableCommand({ TableName: tableName }));
      console.log(`🗑️  Deleted table: ${tableName}`);
    }

    // Wait a bit for deletions to complete
    if (oldTables.length > 0) {
      console.log('Waiting for table deletions to complete...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    for (const tableSpec of tables) {
      if (existingTables.includes(tableSpec.TableName) && !tableSpec.TableName.startsWith('chq-calendar-')) {
        console.log(`Table ${tableSpec.TableName} already exists, skipping...`);
        continue;
      }

      console.log(`Creating table: ${tableSpec.TableName}`);
      const command = new CreateTableCommand(tableSpec);
      await client.send(command);
      console.log(`✅ Created table: ${tableSpec.TableName}`);
    }

    console.log('\n🎉 All tables are ready!');
  } catch (error) {
    console.error('Error setting up tables:', error);
    process.exit(1);
  }
}

setupTables();