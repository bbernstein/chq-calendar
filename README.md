# Chautauqua Calendar

A dynamic calendar for Chautauqua Institution 2025 season with real-time event updates.

## Features
- 🔄 Live data sync from official Chautauqua sources
- 🎯 Smart multi-dimensional filtering
- 📅 Export to Google Calendar, Outlook, or .ics files
- 📱 Mobile-responsive interface
- 🔔 Real-time update notifications

## Documentation

📚 Detailed documentation is available in the `docs/` directory:
- [Development Workflow](docs/DEVELOPMENT_WORKFLOW.md) - Complete development and deployment process
- [API Integration Design](docs/API_INTEGRATION_DESIGN.md) - Technical architecture and API details
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment instructions
- [System Design](docs/DESIGN.md) - Overall system architecture and design decisions

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

📋 **For detailed deployment instructions, see [DEPLOYMENT.md](DEPLOYMENT.md)**

## Architecture
- **Frontend**: Next.js with TypeScript and Tailwind CSS (static export to S3)
- **Backend**: Serverless AWS Lambda functions with TypeScript
  - `calendar_generator`: Public calendar and feedback endpoints
  - `admin_handler`: OAuth authentication and admin management
- **Infrastructure**: AWS (S3, CloudFront, API Gateway, Lambda, DynamoDB)
- **Data Sources**: Chautauqua API, RSS feeds, iCal feeds, web scraping

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
- **Frontend**: http://localhost:3000 (Next.js)
- **DynamoDB Local**: http://localhost:8000
- **DynamoDB Admin**: http://localhost:8001

**Note**: Backend now runs as serverless Lambda functions in AWS. For local development, admin features require deploying Lambda functions to AWS or using production endpoints.

### Local Development Features
- Hot reloading for frontend
- Local DynamoDB with persistent data
- DynamoDB Admin UI for database management
- Frontend connects to production Lambda functions for admin features
- Environment variables configured for local development

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
