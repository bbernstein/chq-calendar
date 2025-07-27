# Chautauqua Calendar - Deployment Guide

This guide covers all deployment options for the Chautauqua Calendar application.

## 📋 Overview

The application consists of four main components:
- **Infrastructure**: AWS resources (S3, CloudFront, Lambda, DynamoDB)
- **Backend**: Lambda functions (data sync, feedback, admin, and health handlers)
- **Frontend**: Next.js 15.3.5 static site with React 19 and TypeScript
- **Static Data**: JSON file generation and CloudFront distribution

## 🚀 Quick Deployment

### Automated Deployment (GitHub Actions)

The application deploys automatically via GitHub Actions when code is pushed to the `main` branch:

1. **Automated Build**: Node.js 24, TypeScript compilation
2. **Backend Deploy**: Data sync, feedback, admin, and health Lambda functions
3. **Frontend Deploy**: Static Next.js build to S3 + CloudFront invalidation
4. **Health Checks**: Static file validation and API endpoint testing
5. **Data Sync**: Automatic event data sync and static file generation

Manual deployment can be triggered via GitHub Actions "workflow_dispatch".

## 🔧 Individual Component Deployment

### Infrastructure Only
```bash
cd infrastructure
terraform init
terraform plan
terraform apply
```

### Backend Only
```bash
cd backend
npm install
npm run build
npm run deploy
```

### Frontend Only
```bash
./scripts/deploy-frontend.sh
```

## 🏠 Local Development

### Quick Start
```bash
# Start all services with Docker
./scripts/setup-local.sh

# Or manually
docker-compose up -d --build
```

### Local Services
- **Frontend**: http://localhost:3000 (Next.js with hot reloading)
- **Admin Panel**: http://localhost:3000/admin/feedback (dev mode)
- **DynamoDB Local**: http://localhost:8000
- **DynamoDB Admin**: http://localhost:8001
- **Backend**: Uses production AWS Lambda endpoints

### Manual Local Setup
```bash
# Backend
cd backend
npm install
npm run dev

# Frontend (in another terminal)
cd frontend
npm install
npm run dev
```

## 📁 Script Reference

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/deploy.sh` | Complete deployment | `./scripts/deploy.sh` |
| `scripts/deploy-frontend.sh` | Frontend only | `./scripts/deploy-frontend.sh` |
| `scripts/setup-local.sh` | Local development | `./scripts/setup-local.sh` |

## 🌐 Environment URLs

### Production
- **Website**: https://www.chqcal.org
- **Event Data**: https://www.chqcal.org/cache/calendar-cache/all-events.json
- **Admin Panel**: https://www.chqcal.org/admin/feedback
- **Feedback**: https://www.chqcal.org/feedback

### Local Development
- **Website**: http://localhost:3000
- **Event Data**: Uses production static file endpoint
- **Feedback/Admin**: Uses production API endpoints

## 📋 Prerequisites

### For Production Deployment
- GitHub repository with Actions enabled
- AWS credentials configured as GitHub secrets
- Node.js 24+ (handled by GitHub Actions)
- Domain configured in AWS Route 53

### For Local Development
- [Docker](https://docker.com) and Docker Compose
- [Node.js](https://nodejs.org) >= 18 (optional for running outside Docker)
- Access to production AWS endpoints (no local backend server)

## 🔍 Health Checks

### Static Event Data Check
```bash
# Check if event data file exists and is fresh
curl -I https://www.chqcal.org/cache/calendar-cache/all-events.json

# Verify event data structure and count
curl -s https://www.chqcal.org/cache/calendar-cache/all-events.json | jq '{cacheKey, timestamp, eventCount: (.data | length)}'
```

### API Health Check
```bash
curl https://www.chqcal.org/api/health
```

### Test Admin API (requires authentication)
```bash
# Note: Admin API is accessed via CloudFront path routing
curl https://www.chqcal.org/admin/api/feedback \
  -H "X-Auth-Token: <your-token>"
```

## 🛠 Troubleshooting

### Common Issues

#### 1. Terraform Certificate Validation Timeout
**Problem**: Certificate validation takes too long
**Solution**: 
- Check domain name servers are properly configured
- DNS propagation can take up to 48 hours

#### 2. Lambda ZIP File Not Found
**Problem**: `lambda-function.zip: no such file or directory`
**Solution**:
```bash
cd backend
npm run build
npm run package
```

#### 3. Frontend 404 Errors
**Problem**: Website shows 404 errors
**Solution**:
```bash
./scripts/deploy-frontend.sh
```

#### 4. API Gateway Deployment Warning
**Problem**: `stage_name is deprecated`
**Solution**: Already fixed in current Terraform configuration

### Debugging Commands

```bash
# Check Terraform outputs
cd infrastructure && terraform output

# Check S3 bucket contents
aws s3 ls s3://chautauqua-calendar-frontend-prod/

# Check Lambda function
aws lambda get-function --function-name chautauqua-calendar-generator

# View CloudFront distributions
aws cloudfront list-distributions

# Check DynamoDB tables
aws dynamodb list-tables
```

## 🔄 CI/CD Integration

### Current GitHub Actions Workflow

The production deployment workflow (`.github/workflows/deploy-production.yml`) includes:

- **Node.js 24** with npm workspace support
- **Separate Lambda functions** for calendar and admin handlers
- **Frontend build** with environment variables
- **S3 deployment** with CloudFront invalidation
- **Health checks** and API testing
- **Automatic calendar sync** triggering
- **Error handling** and deployment notifications

The workflow is triggered on pushes to `main` branch or manual dispatch.

## 📊 Monitoring & Logs

### CloudWatch Logs
- Data Sync Lambda: `/aws/lambda/chq-calendar-data-sync`
- Feedback Lambda: `/aws/lambda/chq-calendar-feedback`
- Admin Lambda: `/aws/lambda/chq-calendar-admin`
- Health Lambda: `/aws/lambda/chq-calendar-health`
- CloudFront logs: Available in S3 if enabled

### Monitoring Commands
```bash
# Lambda logs
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/chautauqua"

# API Gateway metrics
aws logs describe-log-groups --log-group-name-prefix "API-Gateway"
```

## 🔐 Security

### Environment Variables
- Never commit API keys or secrets
- Use AWS Systems Manager Parameter Store for production secrets
- Local development uses dummy values

### IAM Permissions
The deployment requires GitHub Actions to have permissions for:
- **Lambda**: Function updates for sync, feedback, admin, and health handlers
- **S3**: Frontend deployment and static file operations
- **CloudFront**: Cache invalidation and distribution management
- **DynamoDB**: Table access for Events and Feedback tables (handled by Lambda execution roles)
- **EventBridge**: Data sync scheduling (handled by Lambda)

Lambda execution roles include permissions for DynamoDB, S3 cache bucket, and CloudWatch logs.

## 📈 Performance

### Optimization Tips
- Static JSON file delivery via CloudFront provides global edge caching
- No Lambda cold starts for event data requests (99% of traffic)
- DynamoDB on-demand scaling handles sync and feedback operations
- Client-side filtering eliminates API latency

### Cost Optimization
- Static file approach eliminates Lambda invocation costs for events
- CloudFront caching reduces S3 origin requests
- DynamoDB on-demand billing only for sync and feedback operations
- Predictable costs: storage + bandwidth for event delivery

## 📞 Support

For issues or questions:
1. Check this documentation
2. Review CloudWatch logs
3. Check AWS service status
4. Create an issue in the repository

---

Last updated: July 26, 2025