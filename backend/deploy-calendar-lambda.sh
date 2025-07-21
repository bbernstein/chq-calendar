#!/bin/bash

# Quick deployment script for calendar Lambda function
# This includes all AWS SDK dependencies to fix the @smithy dependency issue

set -e

echo "🚀 Deploying calendar Lambda function with complete dependencies..."

# Clean up previous builds
rm -rf package_temp lambda-calendar.zip

# Build the Lambda functions
echo "📦 Building Lambda functions..."
npm run build:prod

# Install production dependencies
echo "📥 Installing production dependencies..."
npm ci --omit=dev

# Create package directory
mkdir -p package_temp/node_modules

# Install all externalized dependencies with their transitive dependencies
echo "📦 Installing externalized dependencies with all transitive dependencies..."
cd package_temp

# Create a minimal package.json with only externalized dependencies
cat > package.json << 'EOF'
{
  "name": "lambda-calendar",
  "version": "1.0.0",
  "dependencies": {
    "@aws-sdk/client-dynamodb": "*",
    "@aws-sdk/lib-dynamodb": "*",
    "ical-generator": "*",
    "date-fns": "*",
    "cheerio": "*",
    "axios": "*",
    "uuid": "*",
    "node-fetch": "*"
  }
}
EOF

# Install all dependencies (this will get all transitive deps)
npm install --omit=dev --no-package-lock

cd ..

# Copy the original package.json back and handler
cp package.json package_temp/package.json
mkdir -p package_temp/dist
cp dist/calendarHandler.js package_temp/dist/

# Create zip package
echo "🗜️  Creating deployment package..."
cd package_temp
zip -r ../lambda-calendar.zip . -x "*.md" "*/test/*" "*/tests/*" "*/examples/*" "*/docs/*" > /dev/null
cd ..

# Check package size
PACKAGE_SIZE=$(du -h lambda-calendar.zip | cut -f1)
echo "📦 Package size: $PACKAGE_SIZE"

# Deploy to AWS
echo "☁️  Deploying to AWS Lambda..."
aws lambda update-function-code \
  --function-name chautauqua-calendar-generator \
  --zip-file fileb://lambda-calendar.zip \
  --region us-east-1

echo "⏳ Waiting for function update to complete..."
aws lambda wait function-updated \
  --function-name chautauqua-calendar-generator \
  --region us-east-1

# Clean up
rm -rf package_temp lambda-calendar.zip

echo "✅ Calendar Lambda function deployed successfully!"
echo "🧪 Test it with:"
echo "   curl -X POST 'https://chqcal.org/api/calendar' -H 'Content-Type: application/json' -d '{\"filters\":{}}'"