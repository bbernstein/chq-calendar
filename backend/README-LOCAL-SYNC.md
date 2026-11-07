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
to switch the dev server from the CDN to `frontend/public/data/` — where to
set it is below; see also `frontend/src/lib/dataSource.ts`. This is
deliberately explicit rather than "use the local file if one exists" — the
implicit version was issue #286, where a gitignored directory silently decided
whether the calendar had any events in it.

## Turning local data on

`VITE_LOCAL_DATA` is a **dev-server-only switch**. The Vite dev server honours
it — `npm run dev` on the host, or the Docker frontend container, which runs
the same thing. A production build and `vite preview` always read the CDN,
whatever it is set to. Vite reads it once at startup, so restart after
changing it.

**Host dev server** (`cd frontend && npm run dev`) — either:

- put `VITE_LOCAL_DATA=true` in `frontend/.env.local` (gitignored; there is a
  commented-out line for it in `frontend/.env.example`), or
- prefix the command: `VITE_LOCAL_DATA=true npm run dev`.

The repository-root `.env` is **not** read here — Vite looks for env files in
`frontend/` only.

**Docker** (`docker compose up`) — any one of these, consulted in this order,
the first that sets it winning:

1. the shell you run Compose from: `VITE_LOCAL_DATA=true docker compose up -d`
2. the repository-root `.env`, which Compose reads
3. `frontend/.env.local`, which is bind-mounted into the container

After changing 1 or 2, run `docker compose up -d frontend` so Compose
recreates the container with the new environment; after changing 3,
`docker compose restart frontend` is enough.

**Set it in one place.** An empty `VITE_LOCAL_DATA=` in the shell or the root
`.env` still counts as set: it turns local data *off* and overrides a `true`
in `frontend/.env.local`, because Vite lets the process environment beat its
env files, empty values included. `docker-compose.yml` passes the variable
through by bare name for exactly this reason — it used to interpolate it with
a `:-` default, which defined it as an empty string in every container and
so silently disabled `frontend/.env.local` under Docker.

`./scripts/setup-local.sh` asks the running frontend which source it is
reading rather than trusting your shell, so it reports the mode you actually
got.

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

`--force` runs the service's full-year sync (`syncFullYearEvents`) — the same
one production's daily and weekly syncs run — so it also records a `full` row
in the sync-status table and rewarms that year's published feed. Without
`--force` it is an incremental, now-relative sync.

Both `sync:local` and `sync:fetch` **exit non-zero when they write no file**
(an empty cache, a missing S3 object), rather than printing a success line over
nothing.

For a different season — this is how you get 2027 (or 2025) on disk:
```bash
npm run sync:local -- --year=2027 --force
```

**`--year=` requires `--force` here, and the script refuses without it.** An
incremental sync takes no year — it syncs a now-relative window — so
`sync:local -- --year=2027` on its own would sync *this* season and then write
whatever the cache held for 2027 under a 2027 filename. Rather than warn about
a silently wrong file, the script stops and names both alternatives.

If you only want the published feed on disk, **don't use this script at
all** — the feed is public, so this does it with no AWS access:

```bash
cd frontend/public/data

# The manifest first. The app opens on its defaultYear, so that is the feed
# you need; a feed for any other season sits unread. Written through node so
# a failed fetch leaves the tracked file alone and the indentation matches.
node -e 'fetch("https://www.chqcal.org/cache/calendar-cache/years.json").then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}).then(m=>require("fs").writeFileSync("years.json",JSON.stringify(m,null,2)+"\n"))'

YEAR=$(node -p 'require("./years.json").defaultYear')
curl -fo "all-events-${YEAR}.json" \
  "https://www.chqcal.org/cache/calendar-cache/all-events-${YEAR}.json"
```

`years.json` is tracked, so this shows up in `git status` whenever production
has moved on — that diff is the refresh, and worth committing. To have
another season on disk as well, fetch its `all-events-<year>.json` the same
way; it is reachable from the year switcher as long as `years.json` lists it.

`npm run sync:fetch -- --year=2027` reads the *private* S3 cache instead, and
that object carries a 60-minute TTL while 2027's is regenerated once a day —
so outside a one-hour window each day it reports `Cache EXPIRED` and writes
nothing. It is the wrong tool for this; the curl above always works.

The year defaults to the current season using the same October 1 turnover as
the frontend's fallback, so from October onwards it syncs *next* year. The app
itself asks for `years.json`'s `defaultYear`, which `sync:local` refreshes
alongside; the two normally agree, and when they do not, `years.json` is the
one the app follows.

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
3. Set `VITE_LOCAL_DATA=true` for the dev server (see "Turning local data
   on" above) — without it the app reads the CDN and your synced files are
   ignored

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
- `VITE_LOCAL_DATA=true` must reach the dev server for it to read
  `frontend/public/data/` at all; otherwise it loads from the CDN. Under
  Docker, an empty `VITE_LOCAL_DATA=` in your shell or the root `.env`
  overrides `frontend/.env.local` — see "Turning local data on". A production
  build and `vite preview` never read it
- Check the filename has the year suffix. The frontend requests
  `all-events-<year>.json`; a bare `all-events.json` is the legacy every-year
  blob (~10MB) that nothing reads. Older versions of this script wrote that
  name, which is what made issue #286 so hard to diagnose
- Check the year is the one `frontend/public/data/years.json` names as
  `defaultYear` — that is the file the app requests, not one worked out from
  today's date. A stale `years.json` makes the app ask for a season you did
  not download; the curl recipe above fetches the two together, and
  `sync:local` refreshes it for you

## Production Deployment

In production, the Lambda function:
1. Runs on a schedule (hourly incremental, daily full sync)
2. Updates DynamoDB with latest events
3. Automatically warms S3 cache with common queries
4. The frontend loads from CloudFront/S3 cache for optimal performance