import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function main() {
  const frontendBucket = process.env.FRONTEND_S3_BUCKET || 'chautauqua-calendar-frontend-prod';
  const cachePrefix = 'cache/calendar-cache';
  
  console.log(`Uploading to frontend bucket: ${frontendBucket}`);
  
  try {
    // Initialize DynamoDB client
    const dynamoClient = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });

    const docClient = DynamoDBDocumentClient.from(dynamoClient, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });

    // Initialize S3 client
    const s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
    });

    // Fetch all events from DynamoDB
    console.log('Fetching all events from DynamoDB...');
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
      
      const response = await docClient.send(scanCommand);
      
      if (response.Items) {
        events.push(...response.Items);
      }
      
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    console.log(`Retrieved ${events.length} events from DynamoDB`);

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
    
    console.log(`Uploading to S3: s3://${frontendBucket}/${s3Key}`);
    
    const putCommand = new PutObjectCommand({
      Bucket: frontendBucket,
      Key: s3Key,
      Body: JSON.stringify(cacheData, null, 2),
      ContentType: 'application/json',
      CacheControl: 'public, max-age=3600', // 1 hour cache
    });

    await s3Client.send(putCommand);
    
    console.log('Successfully uploaded all-events.json to S3!');
    console.log(`File location: https://${frontendBucket}.s3.amazonaws.com/${s3Key}`);
    console.log(`CDN URL: https://your-cloudfront-domain.com/${s3Key}`);

    // Also save locally if requested
    if (process.argv.includes('--save-local')) {
      const outputDir = path.join(__dirname, '../../../../frontend/public/data');
      const outputPath = path.join(outputDir, 'all-events.json');
      
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(outputPath, JSON.stringify(cacheData, null, 2));
      
      console.log(`\nAlso saved locally to: ${outputPath}`);
    }

  } catch (error) {
    console.error('Upload failed:', error);
    process.exit(1);
  }
}

main();