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

# Check where node_modules is located
if [ -d "node_modules" ]; then
  NODE_MODULES_PATH="node_modules"
  echo "📂 Found node_modules in current directory"
elif [ -d "../node_modules" ]; then
  NODE_MODULES_PATH="../node_modules"
  echo "📂 Found node_modules in parent directory"
else
  echo "❌ Error: node_modules not found!"
  ls -la
  exit 1
fi

# Copy all AWS SDK and Smithy dependencies
echo "📂 Copying AWS SDK and Smithy dependencies from $NODE_MODULES_PATH..."
find "$NODE_MODULES_PATH" -maxdepth 1 -name "@aws-sdk*" -type d -exec cp -r {} package_temp/node_modules/ \; 2>/dev/null || echo "No @aws-sdk packages found"
find "$NODE_MODULES_PATH" -maxdepth 1 -name "@smithy*" -type d -exec cp -r {} package_temp/node_modules/ \; 2>/dev/null || echo "No @smithy packages found"

# Copy other externalized dependencies
echo "📂 Copying other dependencies..."
OTHER_DEPS="ical-generator date-fns cheerio axios uuid node-fetch"
for dep in $OTHER_DEPS; do
  if [ -d "$NODE_MODULES_PATH/$dep" ]; then
    echo "  - Copying $dep"
    cp -r "$NODE_MODULES_PATH/$dep" package_temp/node_modules/
  else
    echo "  ⚠️  Warning: $dep not found"
  fi
done

# Show what we copied
echo "📦 Copied dependencies:"
ls package_temp/node_modules/ | head -10

# Copy package.json and handler
cp package.json package_temp/
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