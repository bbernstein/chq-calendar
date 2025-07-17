# Chautauqua Calendar - Deployment Guide

This guide covers all deployment options for the Chautauqua Calendar application.

## 📋 Overview

The application consists of three main components:
- **Infrastructure**: AWS resources (Terraform)
- **Backend**: Lambda functions (Node.js/TypeScript)
- **Frontend**: Next.js static site (React/TypeScript)

## 🚀 Quick Deployment

### Complete Deployment (Recommended)
```bash
# Deploy everything at once
./scripts/deploy.sh
```

This script will:
1. Deploy infrastructure with Terraform
2. Build and deploy the backend Lambda
3. Build and deploy the frontend to S3/CloudFront
4. Run health checks

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
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **DynamoDB**: http://localhost:8000
- **DynamoDB Admin**: http://localhost:8001

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
- **API**: https://2jjx0zum0c.execute-api.us-east-1.amazonaws.com/prod

### Local Development
- **Website**: http://localhost:3000
- **API**: http://localhost:3001

## 📋 Prerequisites

### For AWS Deployment
- [AWS CLI](https://aws.amazon.com/cli/) configured
- [Terraform](https://terraform.io) >= 1.0
- [Node.js](https://nodejs.org) >= 18
- AWS credentials with appropriate permissions

### For Local Development
- [Docker](https://docker.com) and Docker Compose
- [Node.js](https://nodejs.org) >= 18 (optional)

## 🔍 Health Checks

### API Health Check
```bash
curl https://2jjx0zum0c.execute-api.us-east-1.amazonaws.com/prod/health
```

### Create Sample Data
```bash
curl -X POST https://2jjx0zum0c.execute-api.us-east-1.amazonaws.com/prod/calendar/sample-data
```

### Generate Calendar
```bash
curl -X POST https://2jjx0zum0c.execute-api.us-east-1.amazonaws.com/prod/calendar \
  -H "Content-Type: application/json" \
  -d '{"format":"json"}'
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

### GitHub Actions Example
```yaml
name: Deploy Chautauqua Calendar
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
          
      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v2
        
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Deploy
        run: ./scripts/deploy.sh
```

## 📊 Monitoring & Logs

### CloudWatch Logs
- Lambda logs: `/aws/lambda/chautauqua-calendar-generator`
- API Gateway logs: (if enabled in stage settings)

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
The deployment requires permissions for:
- Lambda (create, update, invoke)
- DynamoDB (create, read, write)
- S3 (create, read, write, delete)
- CloudFront (create, invalidate)
- Route 53 (create, update records)
- ACM (create, validate certificates)

## 📈 Performance

### Optimization Tips
- CloudFront caching reduces load times globally
- DynamoDB on-demand scaling handles traffic spikes
- Lambda cold starts optimized with smaller bundle sizes

### Cost Optimization
- S3 uses lifecycle policies for old assets
- CloudFront reduces origin requests
- DynamoDB on-demand billing only for actual usage

## 📞 Support

For issues or questions:
1. Check this documentation
2. Review CloudWatch logs
3. Check AWS service status
4. Create an issue in the repository

---

Last updated: July 2025