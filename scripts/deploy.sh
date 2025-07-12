#!/bin/bash
set -e

echo "🚀 Deploying Chautauqua Calendar Application"

# Deploy infrastructure
echo "📦 Deploying infrastructure..."
cd infrastructure
terraform init
terraform apply -auto-approve

# Get API URL
export API_URL=$(terraform output -raw api_url)
echo "API URL: $API_URL"

# Deploy backend
echo "⚙️ Deploying backend..."
cd ../backend
npm install
npm run build

# Create Lambda deployment package
zip -r lambda-function.zip dist/ node_modules/ package.json

# Update Lambda function
aws lambda update-function-code \
  --function-name chautauqua-calendar-generator \
  --zip-file fileb://lambda-function.zip

# Deploy frontend
echo "🎨 Deploying frontend..."
cd ../frontend
npm install

# Set API URL
export NEXT_PUBLIC_API_URL=$API_URL

# Build and deploy
npm run build

# Get S3 bucket name
S3_BUCKET=$(cd ../infrastructure && terraform output -raw s3_bucket_name)

# Upload to S3
aws s3 sync out/ s3://$S3_BUCKET --delete

# Get CloudFront distribution
FRONTEND_URL=$(cd ../infrastructure && terraform output -raw frontend_url)

echo "✅ Deployment complete!"
echo "Frontend URL: $FRONTEND_URL"
echo "API URL: $API_URL"
