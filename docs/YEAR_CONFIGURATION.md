# Year Configuration Guide

This guide explains how to configure the Chautauqua Calendar for a specific year (e.g., switching from 2026 to 2027).

## Overview

The calendar system is now year-aware and can be configured to:
- Fetch and store events for a full calendar year (including pre-season and post-season)
- Generate year-specific cache files (e.g., `all-events-2026.json`)
- Display only events for the configured year
- Allow easy switching between years

## Configuration Steps

### 1. Update Environment Variables

#### For Local Development
Update `.env.local`:
```bash
ACTIVE_YEAR=2027
VITE_ACTIVE_YEAR=2027
```

#### For Production (AWS)
Update the Terraform configuration in `infrastructure/sync.tf`:

```hcl
environment {
  variables = {
    # ... other variables ...
    ACTIVE_YEAR = "2027"  # Change from 2026 to 2027
  }
}
```

### 2. Deploy Infrastructure Changes

```bash
cd infrastructure
terraform plan
terraform apply
```

### 3. Update Frontend Environment

Set the environment variable for the frontend build:
```bash
export VITE_ACTIVE_YEAR=2027
```

Or update in your GitHub Actions workflow or deployment script.

### 4. Deploy Backend and Frontend

```bash
# Deploy backend with new year configuration
cd backend
npm run build
npm run deploy

# Deploy frontend with new year
cd ../frontend
npm run build
npm run deploy
```

### 5. Trigger Full Year Sync

After deployment, trigger a full sync for the new year:

```bash
# Using the utility script
cd utils
node trigger-full-season-sync.js

# Or using AWS CLI
aws lambda invoke \
    --function-name chq-calendar-data-sync \
    --invocation-type RequestResponse \
    --payload '{"detail-type":"Weekly Full Sync","source":"manual.trigger"}' \
    /tmp/sync-response.json
```

### 6. Verify the Update

Check that the new year's data is being fetched and displayed:

```bash
# Check if the year-specific cache file was created
aws s3 ls s3://chautauqua-calendar-cache-wjdeawqc/calendar-cache/ | grep 2027

# Verify the cache file contents
aws s3 cp s3://chautauqua-calendar-cache-wjdeawqc/calendar-cache/all-events-2027.json - | \
  jq '{eventCount: .data | length, year: .data[0].startDate | split("-")[0]}' 2>/dev/null
```

Visit the website and verify:
- The header shows "2027 Season"
- Events displayed are from 2027
- No events from other years appear

## Architecture

### Backend Changes
- `ACTIVE_YEAR` environment variable controls which year to sync
- `syncFullYearEvents()` fetches entire calendar year (Jan 1 - Dec 31)
- Cache files are named with year suffix: `all-events-{year}.json`

### Frontend Changes
- `VITE_ACTIVE_YEAR` controls which year's file to load
- Fetches year-specific cache file: `/cache/calendar-cache/all-events-{year}.json`
- Season calculation uses the configured year

### Data Flow
1. Lambda functions read `ACTIVE_YEAR` from environment
2. Sync fetches all events for that year from the API
3. Events are stored in DynamoDB with year context
4. Cache file is generated with year in filename
5. Frontend loads year-specific cache file
6. Only events for the configured year are displayed

## Benefits

- **Clean Data Separation**: Each year's events are clearly separated
- **Historical Preservation**: Old years' data remains in the database
- **Easy Switching**: Change one environment variable to update the year
- **Performance**: Frontend only loads data for the active year
- **Flexibility**: Can show pre-season and post-season events

## Rollback

To rollback to a previous year:
1. Update `ACTIVE_YEAR` and `VITE_ACTIVE_YEAR` back to the previous value
2. Redeploy infrastructure and application
3. The previous year's cache files should still exist

## Troubleshooting

### Events Not Showing
- Check Lambda logs: `aws logs tail /aws/lambda/chq-calendar-data-sync --follow`
- Verify environment variable is set: Check Lambda configuration in AWS Console
- Ensure sync completed successfully

### Wrong Year Displayed
- Check frontend environment: `VITE_ACTIVE_YEAR` must match backend
- Clear browser cache and reload
- Verify the correct cache file exists in S3

### Mixed Year Data
- This indicates the sync is not filtering by year properly
- Check that you deployed the updated Lambda code
- Verify `syncFullYearEvents()` is being called instead of `syncAllSeasonEvents()`

## Future Enhancements

Potential improvements for multi-year support:
- Year selector dropdown in the UI
- Ability to view multiple years simultaneously
- Automatic year rollover based on current date
- Archive mode for viewing past seasons