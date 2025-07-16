# Development Workflow

## Overview
This document outlines the development workflow to ensure all changes are properly tested locally before being deployed to production.

## Workflow Steps

### 1. Local Development & Testing
- Make all code changes in your local environment
- Test changes using the local Docker development environment
- Ensure all functionality works as expected locally

### 2. Local Deployment & Validation
- Deploy changes to localhost using Docker
- Run comprehensive tests to verify:
  - Frontend functionality
  - API endpoints
  - Database operations
  - Week filtering
  - Event sync process

### 3. Production Deployment
- Only deploy to production after local validation
- Use the production deployment script
- Verify production functionality after deployment

## Commands

### Local Development
```bash
# Start local development environment
docker-compose up -d

# Check logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Stop environment
docker-compose down
```

### Local Testing
```bash
# Test API endpoints
curl -s -X POST 'http://localhost:3001/calendar' -H "Content-Type: application/json" -d '{"filters": {}}' | jq '.events | length'

# Test specific week filtering
curl -s -X POST 'http://localhost:3001/calendar' -H "Content-Type: application/json" -d '{"filters": {"dateRange": {"start": "2025-07-06T00:00:00.000Z", "end": "2025-07-12T23:59:59.999Z"}}}' | jq '.events | length'

# Test sync process
curl -X POST http://localhost:3001/sync

# Open frontend
open http://localhost:3000
```

### Production Deployment
```bash
# Deploy to production (only after local validation)
./scripts/deploy.sh
```

## Rules

1. **Never deploy directly to production** without local testing
2. **Always test the complete user flow** locally before production deployment
3. **Document any issues** found during local testing
4. **Verify production deployment** after each release

## Checklist Before Production Deployment

- [ ] Local environment is working correctly
- [ ] All API endpoints return expected data
- [ ] Frontend displays events correctly
- [ ] Week filtering works for all weeks 1-9
- [ ] Event sync process completes successfully
- [ ] No console errors in browser
- [ ] Mobile functionality works (tap-to-toggle weeks)