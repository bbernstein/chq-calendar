# Chautauqua Calendar

A dynamic, filterable calendar application for the Chautauqua Institution 2025 season. Features intelligent filtering by week, location, category, and search with responsive design optimized for all devices.

## Features
- 🔄 Automated data sync from official Chautauqua sources
- 🎯 Smart multi-dimensional filtering (week, location, category, search)
- 📝 Community feedback system with admin management
- 📱 Mobile-first responsive design with horizontal scrolling
- 🏷️ Recent items tracking with FIFO system (10 most recent)
- 🔍 Intelligent search with location/category shortcuts
- 📊 Visual scroll indicators and expandable filter sections
- 🌐 HTML entity decoding for proper text display

## Documentation

📚 Detailed documentation is available in the `docs/` directory:
- [Development Workflow](docs/DEVELOPMENT_WORKFLOW.md) - Complete development and deployment process
- [API Integration Design](docs/API_INTEGRATION_DESIGN.md) - Technical architecture and API details
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment instructions
- [System Design](docs/DESIGN.md) - Overall system architecture and design decisions
- [Development History](docs/DEVELOPMENT_HISTORY.md) - Architectural evolution and lessons learned
- [Caching Architecture](docs/CACHING_ARCHITECTURE.md) - Data caching and performance optimization
- [OAuth Setup](docs/OAuth-Setup.md) - Authentication configuration for admin features

## Development Workflow

**⚠️ IMPORTANT: Always test locally before deploying to production!**

### Utilities

The `utils/` directory contains helpful scripts for development and maintenance:

- `integration-test.js` - Comprehensive test suite comparing localhost vs production
- `clear-production-db.js` - Clear production database (use with caution)
- `recreate-tables.js` - Reset local DynamoDB tables
- `test-weeks.js` - Test week date calculations
- `trigger-full-season-sync.js` - Manual production sync trigger

See `utils/README.md` for detailed usage instructions.

### Step 1: Local Development & Testing
```bash
# Start local development environment
./scripts/start-local.sh

# Run comprehensive local tests
./scripts/test-local.sh
```

### Step 2: Production Deployment (After Local Validation)
```bash
# Deploy to production with validation
./scripts/deploy-with-validation.sh
```

### Alternative: Manual Commands

#### Local Development
```bash
# Start environment
docker compose up -d

# Test API (now uses production endpoints)
curl -s -X POST 'https://chqcal.org/api/calendar' -H "Content-Type: application/json" -d '{"filters": {}}' | jq '.events | length'

# Test frontend
open http://localhost:3000
```

#### Production Deployment (Legacy)
```bash
# Direct deployment (use with caution)
./scripts/deploy.sh
```

### Individual Components
```bash
# Infrastructure only
cd infrastructure && terraform apply

# Backend only
cd backend && npm run deploy

# Frontend only
./scripts/deploy-frontend.sh
```

📋 **For detailed deployment instructions, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**

## Architecture
- **Frontend**: Vite with Preact, TypeScript, and Tailwind CSS 4 (static build to S3)
- **Backend**: Serverless AWS Lambda functions with TypeScript
  - `calendarHandler`: Public calendar endpoints with intelligent filtering
  - `adminHandler`: OAuth authentication and feedback management
  - `syncHandler`: Automated data synchronization from Chautauqua sources
- **Infrastructure**: AWS (S3, CloudFront, API Gateway, Lambda, DynamoDB)
- **Data Sources**: Chautauqua Institution ICS calendar feeds
- **Database**: DynamoDB with optimized indexes for filtering and search

## Local Development

### Prerequisites
- Docker with the Compose plugin (Docker Compose v2)
- Node.js 24+ (see `.nvmrc`) — required by `./scripts/setup-local.sh`, which
  installs the workspace tree on the host as well as building the containers,
  and for any development outside Docker

### Running Locally
The application can run completely locally using Docker:

```bash
# Quick setup
./scripts/setup-local.sh

# Or manual setup
docker compose up -d --build --renew-anon-volumes
```

> **After changing `package.json` or `package-lock.json`, rebuild with
> `--renew-anon-volumes`.** Each container's `node_modules` lives in an
> anonymous volume so the host's copy doesn't shadow it, and those volumes
> survive a plain `docker compose up --build` — the new image is built
> correctly and then masked by the previous run's dependency tree. Symptoms are
> confusing: a package you just pinned stays at the old version, or a newly
> added dependency is missing entirely. `./scripts/setup-local.sh` passes the
> flag for you.

### Where the event data comes from

Nothing to do here — this section is what to read when something looks wrong.

The dev server fetches events from the same place production does: the
`/cache/calendar-cache/` prefix on the CDN. `frontend/vite.config.ts` proxies
`/cache` to https://www.chqcal.org for both the dev server and `vite preview`,
so a fresh clone renders the real calendar with no fixture, no sync step and no
AWS credentials. `./scripts/setup-local.sh` asserts this actually worked rather
than only that the ports answer.

To work offline, or against a feed you have synced yourself, set
`VITE_LOCAL_DATA=true` and the frontend reads `frontend/public/data/` instead.
That directory is gitignored; populate it with
`npm run sync:local --workspace=backend` — see
[`backend/README-LOCAL-SYNC.md`](backend/README-LOCAL-SYNC.md), which also
covers syncing a second season with `--year=` to exercise year switching and
the off-season landing.

### Local Services
- **Frontend**: http://localhost:3000 (Vite dev server with HMR)
- **DynamoDB Local**: http://localhost:8000
- **DynamoDB Admin**: http://localhost:8001
- **Backend**: Runs on AWS Lambda (production endpoints)
- **Admin Panel**: http://localhost:3000/admin/feedback (development mode)

**Note**: The application uses AWS Lambda functions for backend services. Local development connects to production endpoints for API calls while providing a local admin interface for development.

### Local Development Features
- Hot reloading for frontend with instant filter updates
- Local DynamoDB (runs `-inMemory`, so its data resets on container restart)
- DynamoDB Admin UI for database management
- Development mode authentication bypass for admin features
- State persistence in localStorage with cache versioning
- Real-time scroll indicators and responsive pill display
- FIFO recent items tracking for improved user experience

### Useful Commands
```bash
# View all service logs
docker compose logs -f

# View specific service logs
docker compose logs -f frontend

# Stop services
docker compose down

# Restart services
docker compose restart

# Rebuild and restart (--renew-anon-volumes: see the note under Running Locally)
docker compose up -d --build --renew-anon-volumes

# Stop and remove containers plus their volumes. This clears each container's
# cached node_modules; it does not "reset the database", since DynamoDB Local
# runs -inMemory and keeps nothing between restarts anyway.
docker compose down -v
```
