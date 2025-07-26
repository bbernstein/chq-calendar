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
docker-compose up -d

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
- **Frontend**: Next.js 15.3.5 with React 19, TypeScript, and Tailwind CSS 4 (static export to S3)
- **Backend**: Serverless AWS Lambda functions with TypeScript
  - `calendarHandler`: Public calendar endpoints with intelligent filtering
  - `adminHandler`: OAuth authentication and feedback management
  - `syncHandler`: Automated data synchronization from Chautauqua sources
- **Infrastructure**: AWS (S3, CloudFront, API Gateway, Lambda, DynamoDB)
- **Data Sources**: Chautauqua Institution ICS calendar feeds
- **Database**: DynamoDB with optimized indexes for filtering and search

## Local Development

### Prerequisites
- Docker and Docker Compose
- Node.js 24+ (for development outside Docker)

### Running Locally
The application can run completely locally using Docker:

```bash
# Quick setup
./scripts/setup-local.sh

# Or manual setup
docker-compose up -d --build
```

### Local Services
- **Frontend**: http://localhost:3000 (Next.js with hot reloading)
- **DynamoDB Local**: http://localhost:8000
- **DynamoDB Admin**: http://localhost:8001
- **Backend**: Runs on AWS Lambda (production endpoints)
- **Admin Panel**: http://localhost:3000/admin/feedback (development mode)

**Note**: The application uses AWS Lambda functions for backend services. Local development connects to production endpoints for API calls while providing a local admin interface for development.

### Local Development Features
- Hot reloading for frontend with instant filter updates
- Local DynamoDB with persistent data storage
- DynamoDB Admin UI for database management
- Development mode authentication bypass for admin features
- State persistence in localStorage with cache versioning
- Real-time scroll indicators and responsive pill display
- FIFO recent items tracking for improved user experience

### Useful Commands
```bash
# View all service logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f frontend

# Stop services
docker-compose down

# Restart services
docker-compose restart

# Rebuild and restart
docker-compose up -d --build

# Remove all data (reset database)
docker-compose down -v
```
