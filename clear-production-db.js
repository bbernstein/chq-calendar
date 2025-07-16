#!/usr/bin/env node

/**
 * Clear all events from production database
 */

const AWS = require('aws-sdk');

// Configure AWS
AWS.config.update({ region: 'us-east-1' });
const dynamodb = new AWS.DynamoDB.DocumentClient();

const EVENTS_TABLE = 'chautauqua-calendar-events';

async function clearAllEvents() {
  console.log('🗑️  Clearing all events from production database...');
  
  try {
    // First, scan to get all items
    let lastEvaluatedKey = null;
    let totalDeleted = 0;
    
    do {
      const scanParams = {
        TableName: EVENTS_TABLE,
        ProjectionExpression: 'id',
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
      };
      
      const result = await dynamodb.scan(scanParams).promise();
      
      if (result.Items && result.Items.length > 0) {
        // Delete items in batches of 25 (DynamoDB limit)
        const batches = [];
        for (let i = 0; i < result.Items.length; i += 25) {
          batches.push(result.Items.slice(i, i + 25));
        }
        
        for (const batch of batches) {
          const deleteRequests = batch.map(item => ({
            DeleteRequest: {
              Key: { id: item.id }
            }
          }));
          
          const batchWriteParams = {
            RequestItems: {
              [EVENTS_TABLE]: deleteRequests
            }
          };
          
          await dynamodb.batchWrite(batchWriteParams).promise();
          totalDeleted += deleteRequests.length;
          console.log(`   Deleted ${totalDeleted} events so far...`);
        }
      }
      
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    
    console.log(`✅ Successfully deleted ${totalDeleted} events from production database`);
    
    // Verify the table is empty
    const countResult = await dynamodb.scan({
      TableName: EVENTS_TABLE,
      Select: 'COUNT'
    }).promise();
    
    console.log(`📊 Events remaining in database: ${countResult.Count}`);
    
    if (countResult.Count === 0) {
      console.log('🎉 Production database is now empty and ready for fresh sync');
    } else {
      console.log('⚠️  Some events may still remain in the database');
    }
    
  } catch (error) {
    console.error('❌ Error clearing events:', error);
    process.exit(1);
  }
}

// Run the clearing process
if (require.main === module) {
  clearAllEvents().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { clearAllEvents };