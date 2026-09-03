# Local Data Sync Setup Guide

This guide helps you run the `chq-calendar-data-sync` Lambda function locally
to fetch calendar events and generate the `all-events-<year>.json` file that
the frontend reads.

## You probably do not need this

**The frontend loads real events on a fresh clone with no setup.**
`frontend/vite.config.ts` proxies `/cache` to https://www.chqcal.org for the
dev server and `vite preview` alike, so `docker compose up` shows the live
calendar. Nothing here is required for ordinary frontend work.

Reach for this guide when you want to:

- **work offline**, or
- **run the sync pipeline itself** against DynamoDB, or
- **have a second season on disk** — production publishes one manifest, so
  syncing 2025 or 2027 with `--year=` is how you exercise year switching, the
  off-season landing and `previewNextSeason` against a realistic dataset.

It needs AWS credentials with access to this project's DynamoDB tables and
cache bucket. If you do not have those, you want the default CDN path, not
this guide.

**Whatever you sync is only read if you ask for it.** Set `VITE_LOCAL_DATA=true`
in the frontend's environment to switch from the CDN to
`frontend/public/data/`; see `frontend/src/lib/dataSource.ts`. This is
deliberately explicit rather than "use the local file if one exists" — the
implicit version was issue #286, where a gitignored directory silently decided
whether the calendar had any events in it.

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

### 3. Sync and Save Locally (the one you want for offline work)
This syncs data and saves `all-events-<year>.json` to `frontend/public/data/`,
and refreshes the tracked `years.json` from the published manifest:
```bash
npm run sync:local
```

For a full sync with local save:
```bash
npm run sync:local -- --force
```

For a different season — this is how you get 2027 (or 2025) on disk:
```bash
npm run sync:local -- --year=2027 --force
```

**`--year=` requires `--force` here, and the script refuses without it.** An
incremental sync takes no year — it syncs a now-relative window — so
`sync:local -- --year=2027` on its own would sync *this* season and then write
whatever the cache held for 2027 under a 2027 filename. Rather than warn about
a silently wrong file, the script stops and names both alternatives.

If you only want a season's published feed on disk, **don't use this script
at all** — the feed is public, so one line does it with no AWS access:

```bash
curl -o frontend/public/data/all-events-2027.json \
  https://www.chqcal.org/cache/calendar-cache/all-events-2027.json
```

`npm run sync:fetch -- --year=2027` reads the *private* S3 cache instead, and
that object carries a 60-minute TTL while 2027's is regenerated once a day —
so outside a one-hour window each day it reports `Cache EXPIRED` and writes
nothing. It is the wrong tool for this; the curl above always works.

The year defaults to the current season using the same October 1 turnover as
the frontend, so from October onwards it syncs *next* year — matching the file
the app will ask for.

### 4. Fetch Cached Data Only
If data is already synced and you just want to pull down the cached
`all-events-<year>.json` (an incremental sync of the current window still runs
first — it just isn't what produces the file):
```bash
npm run sync:fetch
```

## What Each Script Does

- **`npm run sync`**: Runs incremental sync (only updates changed events)
- **`npm run sync:local`**: Runs sync AND saves `all-events-<year>.json` locally, plus a refreshed `years.json`
- **`npm run sync:fetch`**: Pulls down the cached `all-events-<year>.json` and
  writes it, without a full-season sync first
- **`--year=<n>`**: defaults to the current season (October turnover). Requires
  `--force` with `sync:local`; stands alone with `sync:fetch`

## Local Development Flow

1. Run `npm run sync:local` to sync data and generate the local files
2. They are saved to `frontend/public/data/` as `all-events-<year>.json`,
   alongside a refreshed `years.json`
3. Set `VITE_LOCAL_DATA=true` for the frontend — without it the app reads the
   CDN and your synced files are ignored

## Troubleshooting

### DynamoDB Access Issues
- Ensure your AWS credentials have read/write access to the DynamoDB tables
- Check that the table names in `.env` match your actual AWS resources

### S3 Access Issues  
- Ensure your AWS credentials have read access to the S3 bucket
- The cache bucket should contain files in the format: `calendar-cache/all-events-<year>.json`

### Local File Not Created
- Check that the `frontend/public/data/` directory exists
- Ensure the sync completed successfully (check console output)
- Try running with `--fetch-s3-direct` flag if cache service fails

### The file exists but the calendar is still empty
- `VITE_LOCAL_DATA=true` must be set for the frontend to read
  `frontend/public/data/` at all; otherwise it loads from the CDN
- Check the filename has the year suffix. The frontend requests
  `all-events-<year>.json`; a bare `all-events.json` is the legacy every-year
  blob (~10MB) that nothing reads. Older versions of this script wrote that
  name, which is what made issue #286 so hard to diagnose
- From October the frontend asks for *next* year — sync it with `--year=`

## Production Deployment

In production, the Lambda function:
1. Runs on a schedule (hourly incremental, daily full sync)
2. Updates DynamoDB with latest events
3. Automatically warms S3 cache with common queries
4. The frontend loads from CloudFront/S3 cache for optimal performance