# Chautauqua Calendar Generator

A dynamic calendar generator for Chautauqua Institution 2025 season with real-time event updates.

## Features
- 🔄 Live data sync from official Chautauqua sources
- 🎯 Smart multi-dimensional filtering
- 📅 Export to Google Calendar, Outlook, or .ics files
- 📱 Mobile-responsive interface
- 🔔 Real-time update notifications

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

# Test API
curl -s -X POST 'http://localhost:3001/calendar' -H "Content-Type: application/json" -d '{"filters": {}}' | jq '.events | length'

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
- **Frontend**: Next.js with TypeScript and Tailwind CSS
- **Backend**: AWS Lambda with TypeScript (Express.js for local development)
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
- **Backend API**: http://localhost:3001 (Express.js)
- **DynamoDB Local**: http://localhost:8000
- **DynamoDB Admin**: http://localhost:8001

### Local Development Features
- Hot reloading for both frontend and backend
- Local DynamoDB with persistent data
- DynamoDB Admin UI for database management
- Mock data for testing
- Environment variables configured for local development

### Useful Commands
```bash
# View all service logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f frontend
docker-compose logs -f backend

# Stop services
docker-compose down

# Restart services
docker-compose restart

# Rebuild and restart
docker-compose up -d --build

# Remove all data (reset database)
docker-compose down -v
```

