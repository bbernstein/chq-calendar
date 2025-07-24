# Local Data Sync Setup Guide

This guide helps you run the `chq-calendar-data-sync` Lambda function locally to fetch calendar events and generate the `all-events.json` file.

## Prerequisites

1. Copy `.env.local` to `.env` and configure your AWS credentials:
   ```bash
   cp .env.local .env
   ```

2. Edit `.env` and add the following (minimum required for sync):
   ```
   # AWS Configuration
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=your-access-key-id
   AWS_SECRET_ACCESS_KEY=your-secret-access-key

   # DynamoDB Tables
   EVENTS_TABLE_NAME=chautauqua-calendar-events
   DATA_SOURCES_TABLE_NAME=chautauqua-calendar-data-sources

   # S3 Cache Configuration (optional - only if fetching from S3)
   CACHE_S3_BUCKET=chautauqua-calendar-cache
   CACHE_S3_KEY_PREFIX=calendar-cache
   ```

## Running the Sync

### 1. Basic Sync (Updates DynamoDB only)
```bash
npm run sync
```

### 2. Full Season Sync (Fetches all events for the year)
```bash
npm run sync -- --force
```

### 3. Sync and Save Locally (Recommended for development)
This syncs data and saves the `all-events.json` file to `frontend/public/data/`:
```bash
npm run sync:local
```

For a full sync with local save:
```bash
npm run sync:local -- --force
```

### 4. Fetch Cached Data Only (Without sync)
If data is already synced and you just want to fetch the cached `all-events.json`:
```bash
npm run sync:fetch
```

## What Each Script Does

- **`npm run sync`**: Runs incremental sync (only updates changed events)
- **`npm run sync:local`**: Runs sync AND saves all-events.json locally
- **`npm run sync:fetch`**: Only fetches the cached all-events.json (no sync)

## Local Development Flow

1. Run `npm run sync:local` to sync data and generate the local file
2. The file will be saved to `frontend/public/data/all-events.json`
3. The frontend will automatically use this local file in development mode

## Troubleshooting

### DynamoDB Access Issues
- Ensure your AWS credentials have read/write access to the DynamoDB tables
- Check that the table names in `.env` match your actual AWS resources

### S3 Access Issues  
- Ensure your AWS credentials have read access to the S3 bucket
- The cache bucket should contain files in the format: `calendar-cache/all-events.json`

### Local File Not Created
- Check that the `frontend/public/data/` directory exists
- Ensure the sync completed successfully (check console output)
- Try running with `--fetch-s3-direct` flag if cache service fails

## Production Deployment

In production, the Lambda function:
1. Runs on a schedule (hourly incremental, daily full sync)
2. Updates DynamoDB with latest events
3. Automatically warms S3 cache with common queries
4. The frontend loads from CloudFront/S3 cache for optimal performance