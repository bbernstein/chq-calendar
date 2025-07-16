import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CreateTableCommand, ListTablesCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';

const dynamoClient = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:8000',
  credentials: {
    accessKeyId: 'dummy',
    secretAccessKey: 'dummy'
  }
});

async function createTables() {
  try {
    // Check existing tables
    const listTablesCommand = new ListTablesCommand({});
    const existingTables = await dynamoClient.send(listTablesCommand);
    console.log('Existing tables:', existingTables.TableNames);

    // Create events table
    const eventsTableName = 'chq-calendar-events';
    if (existingTables.TableNames.includes(eventsTableName)) {
      console.log(`Deleting existing table: ${eventsTableName}`);
      await dynamoClient.send(new DeleteTableCommand({ TableName: eventsTableName }));
      // Wait a bit for table to be deleted
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log(`Creating table: ${eventsTableName}`);
    const createEventsTable = new CreateTableCommand({
        TableName: eventsTableName,
        KeySchema: [
          { AttributeName: 'id', KeyType: 'HASH' }
        ],
        AttributeDefinitions: [
          { AttributeName: 'id', AttributeType: 'S' },
          { AttributeName: 'category', AttributeType: 'S' },
          { AttributeName: 'startDate', AttributeType: 'S' }
        ],
        BillingMode: 'PAY_PER_REQUEST',
        GlobalSecondaryIndexes: [
          {
            IndexName: 'CategoryIndex',
            KeySchema: [
              { AttributeName: 'category', KeyType: 'HASH' }
            ],
            Projection: { ProjectionType: 'ALL' }
          },
          {
            IndexName: 'DateIndex',
            KeySchema: [
              { AttributeName: 'startDate', KeyType: 'HASH' }
            ],
            Projection: { ProjectionType: 'ALL' }
          }
        ]
      });
    await dynamoClient.send(createEventsTable);
    console.log(`✅ Created table: ${eventsTableName}`);

    // Create data sources table
    const dataSourcesTableName = 'chq-calendar-data-sources';
    if (!existingTables.TableNames.includes(dataSourcesTableName)) {
      console.log(`Creating table: ${dataSourcesTableName}`);
      const createDataSourcesTable = new CreateTableCommand({
        TableName: dataSourcesTableName,
        KeySchema: [
          { AttributeName: 'id', KeyType: 'HASH' }
        ],
        AttributeDefinitions: [
          { AttributeName: 'id', AttributeType: 'S' }
        ],
        BillingMode: 'PAY_PER_REQUEST'
      });
      await dynamoClient.send(createDataSourcesTable);
      console.log(`✅ Created table: ${dataSourcesTableName}`);
    } else {
      console.log(`Table ${dataSourcesTableName} already exists`);
    }

    console.log('🎉 All tables created successfully!');
  } catch (error) {
    console.error('Error creating tables:', error);
  }
}

createTables();