# Development Workflow

## Overview
This document outlines the complete development workflow for the Chautauqua Calendar application, including local development, testing procedures, and deployment strategies. The application uses GitHub Actions for automated deployment with comprehensive testing and validation.

## Workflow Steps

### 1. Local Development Setup
```bash
# Clone repository and start local environment
git clone <repository-url>
cd chq-calendar
./scripts/start-local.sh
```

### 2. Feature Development
- Create feature branch from `main`
- Develop and test changes locally
- Ensure all features work with local frontend + production API
- Test responsive design and mobile functionality
- Validate state persistence and FIFO recent items

### 3. Testing & Validation
- Run local frontend tests with production API endpoints
- Test filtering, search, and user interface features
- Validate admin panel functionality (development mode)
- Ensure cross-browser compatibility

### 4. Pull Request & Review
- Create PR against `main` branch
- Automated GitHub Actions testing
- Code review by team members
- Address feedback and iterate

### 5. Production Deployment
- Merge to `main` triggers automatic deployment
- GitHub Actions handles build, test, and deploy
- Automated health checks and validation
- Manual verification of live functionality

## Commands

### Local Environment
```bash
# Start all services (frontend + local DynamoDB)
./scripts/start-local.sh

# Or manually with Docker Compose
docker-compose up -d --build

# Check service status
docker-compose ps

# View logs
docker-compose logs -f frontend
docker-compose logs dynamodb

# Stop all services
docker-compose down
```

### Local Testing
```bash
# Test production API endpoints (used by local frontend)
curl -s -X POST 'https://www.chqcal.org/api/calendar' -H "Content-Type: application/json" -d '{"filters": {}}' | jq '.events | length'

# Test specific week filtering
curl -s -X POST 'https://www.chqcal.org/api/calendar' -H "Content-Type: application/json" -d '{"filters": {"weeks": [1]}}' | jq '.events | length'

# Test search functionality
curl -s -X POST 'https://www.chqcal.org/api/calendar' -H "Content-Type: application/json" -d '{"filters": {"search": "amphitheater"}}' | jq '.events | length'

# Open local frontend
open http://localhost:3000

# Test admin panel (development mode)
open http://localhost:3000/admin/feedback
```

### Manual Deployment (if needed)
```bash
# Trigger manual deployment via GitHub Actions
# Go to Actions tab in GitHub repository
# Run "Deploy to Production" workflow manually

# Or for emergency local deployment (not recommended)
./scripts/deploy-with-validation.sh
```

## Development Rules

1. **Local Testing Required**: Always test changes locally before creating PR
2. **Production API Integration**: Local frontend connects to production API endpoints
3. **State Management**: Test localStorage persistence and FIFO recent items
4. **Responsive Design**: Verify mobile, tablet, and desktop layouts
5. **No Direct Production Deploy**: All deployments go through GitHub Actions
6. **Feature Branches**: Create feature branches for all changes
7. **Code Review**: All changes require PR review before merge
8. **Automated Testing**: Rely on GitHub Actions for deployment validation

## Pre-Merge Checklist

### Local Development
- [ ] Local frontend connects to production API successfully
- [ ] All filtering functionality works (week, location, category, search)
- [ ] Recent items FIFO system working (adds on selection, not deselection)
- [ ] Responsive pill display with horizontal scrolling
- [ ] State persistence in localStorage working
- [ ] Admin panel accessible in development mode
- [ ] No console errors in browser dev tools
- [ ] HTML entity decoding working properly

### UI/UX Testing
- [ ] Mobile responsive design works on small screens
- [ ] Horizontal scrolling for pills overflow
- [ ] Visual scroll indicators visible and functional
- [ ] Expandable filter sections with chevron animations
- [ ] Location/category shortcuts working in all contexts
- [ ] Search shortcuts (amp → amphitheater, etc.) functional

### Code Quality
- [ ] TypeScript compilation without errors
- [ ] ESLint passes without warnings
- [ ] Code follows existing patterns and conventions
- [ ] Comments added for complex logic
- [ ] No debugging code left in place

### GitHub Actions Verification
- [ ] All automated tests pass in PR
- [ ] Build completes successfully
- [ ] No merge conflicts with main branch

## Post-Deployment Verification

After merge and automatic deployment:

### Production Health Checks
- [ ] Website loads at https://www.chqcal.org
- [ ] API responds at https://www.chqcal.org/api/health
- [ ] Calendar data loads and displays correctly
- [ ] All filtering options work as expected
- [ ] Admin panel accessible at production URLs
- [ ] CloudFront cache invalidation completed

### User Experience Validation
- [ ] Event count matches expected numbers
- [ ] Recent items tracking working in production
- [ ] Mobile interface responsive and functional
- [ ] Search and shortcuts working correctly
- [ ] No JavaScript errors in production

## Environment Details

### Local Development
- **Frontend**: http://localhost:3000 (Next.js dev server)
- **Database**: http://localhost:8000 (DynamoDB Local)
- **Admin UI**: http://localhost:8001 (DynamoDB Admin)
- **API**: Uses production endpoints (https://www.chqcal.org/api)

### Production
- **Website**: https://www.chqcal.org
- **API**: https://www.chqcal.org/api (via CloudFront)
- **Admin**: https://admin-api.chqcal.org
- **Feedback**: https://www.chqcal.org/feedback

## Technology Stack

### Frontend
- Next.js 15.3.5 with React 19
- TypeScript with strict configuration
- Tailwind CSS 4 for styling
- Static export for S3/CloudFront deployment

### Backend
- AWS Lambda functions (Node.js 24)
- TypeScript compilation with ESBuild
- DynamoDB for data persistence
- S3 for caching layer

### Infrastructure
- GitHub Actions for CI/CD
- AWS CloudFront for global CDN
- Route 53 for DNS management
- ACM for SSL certificates

---

*Last Updated: July 26, 2025*
*Document Version: 2.0*