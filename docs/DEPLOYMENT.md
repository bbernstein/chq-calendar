# Deployment Guide

## Prerequisites
- AWS CLI configured with appropriate permissions
- Terraform >= 1.0 installed
- Node.js >= 18 installed
- GitHub account

## Quick Deploy

1. **Clone the repository**
   ```bash
   git clone https://github.com/bbernstein/chq-calendar.git
   cd chq-calendar
   ```

2. **Deploy infrastructure**
   ```bash
   cd infrastructure
   terraform init
   terraform apply
   ```

3. **Deploy backend**
   ```bash
   cd ../backend
   npm install
   npm run build
   npm run deploy
   ```

4. **Deploy frontend**
   ```bash
   cd ../frontend
   npm install
   export NEXT_PUBLIC_API_URL=$(cd ../infrastructure && terraform output -raw api_url)
   npm run build
   npm run deploy
   ```

## Environment Variables
- `NEXT_PUBLIC_API_URL`: API Gateway URL from Terraform output
- `AWS_REGION`: AWS region (default: us-east-1)

## Monitoring
- CloudWatch logs for Lambda functions
- DynamoDB metrics for data storage
- CloudFront metrics for frontend performance
