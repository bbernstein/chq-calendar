#!/bin/bash

# Chautauqua Calendar - Frontend Deployment Script

set -e

echo "🎪 Deploying Chautauqua Calendar Frontend..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Make sure you're in the project root directory."
    exit 1
fi

# Check if frontend directory exists
if [ ! -d "frontend" ]; then
    echo "❌ Error: frontend directory not found."
    exit 1
fi

# Check if infrastructure has been deployed
if [ ! -f "infrastructure/.terraform/terraform.tfstate" ] && [ ! -f "infrastructure/terraform.tfstate" ]; then
    echo "❌ Error: Terraform state not found. Please run 'terraform apply' in the infrastructure directory first."
    exit 1
fi

# Get S3 bucket name and API URL from Terraform output
cd infrastructure
S3_BUCKET=$(terraform output -raw s3_bucket_name 2>/dev/null)
CLOUDFRONT_DISTRIBUTION_ID=$(terraform output -raw cloudfront_distribution_id 2>/dev/null)
API_URL=$(terraform output -raw api_url 2>/dev/null)
cd ..

if [ -z "$S3_BUCKET" ]; then
    echo "❌ Error: Could not get S3 bucket name from Terraform output."
    echo "   Make sure Terraform has been applied successfully."
    exit 1
fi

echo "📦 S3 Bucket: $S3_BUCKET"

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd frontend
npm install

# Build the frontend (VITE_API_URL left empty — CloudFront handles routing)
echo "🔨 Building frontend..."
export VITE_API_URL=""
npm run build

# Check if build was successful
if [ ! -d "out" ]; then
    echo "❌ Error: Build failed. No output directory found."
    exit 1
fi

BUILD_DIR="out"

echo "📁 Using build directory: $BUILD_DIR"

# Create error.html for S3 error handling
if [ ! -f "$BUILD_DIR/error.html" ]; then
    echo "📄 Creating error.html..."
    cat > "$BUILD_DIR/error.html" << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>Error - Chautauqua Calendar</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        h1 { color: #d32f2f; }
        .container { max-width: 600px; margin: 0 auto; }
        .home-link { color: #1976d2; text-decoration: none; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Oops! Something went wrong</h1>
        <p>We're sorry, but the page you're looking for could not be found.</p>
        <p><a href="/" class="home-link">← Return to Home</a></p>
    </div>
</body>
</html>
EOF
fi

# Sync files to S3
# Pass 1 — content-hashed, immutable assets. Exclude always-revalidate files.
echo "☁️  Uploading immutable assets to S3..."
aws s3 sync "$BUILD_DIR/" "s3://$S3_BUCKET/" \
    --delete \
    --exclude "*.map" \
    --exclude "cache/*" \
    --exclude "*.html" \
    --exclude "manifest.json" \
    --exclude "version.json" \
    --cache-control "public, max-age=31536000, immutable"

# Pass 2 — always-revalidate files. `cp` applies the header unconditionally
# (`sync` skips unchanged files, leaving stale headers behind).
echo "📄 Uploading HTML with no-cache..."
aws s3 cp "$BUILD_DIR/" "s3://$S3_BUCKET/" \
    --recursive \
    --exclude "*" \
    --include "*.html" \
    --content-type "text/html" \
    --cache-control "no-cache"

if [ -f "$BUILD_DIR/manifest.json" ]; then
    aws s3 cp "$BUILD_DIR/manifest.json" "s3://$S3_BUCKET/manifest.json" \
        --content-type "application/json" \
        --cache-control "no-cache"
fi

if [ -f "$BUILD_DIR/version.json" ]; then
    aws s3 cp "$BUILD_DIR/version.json" "s3://$S3_BUCKET/version.json" \
        --content-type "application/json" \
        --cache-control "no-cache"
fi

# Invalidate CloudFront cache
if [ ! -z "$CLOUDFRONT_DISTRIBUTION_ID" ] && [ "$CLOUDFRONT_DISTRIBUTION_ID" != "null" ]; then
    echo "🔄 Invalidating CloudFront cache..."
    aws cloudfront create-invalidation \
        --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
        --paths "/*" > /dev/null
    echo "✅ CloudFront cache invalidated"
else
    echo "⚠️  Warning: Could not determine CloudFront distribution ID. Cache not invalidated."
fi

cd ..

echo ""
echo "🎉 Frontend deployment completed successfully!"
echo ""
echo "📋 Deployment Summary:"
echo "   • S3 Bucket: $S3_BUCKET"
echo "   • Files uploaded from: frontend/$BUILD_DIR/"
echo "   • CloudFront cache: Invalidated"
echo ""
echo "🌐 Your site should be available at:"
echo "   • https://www.chqcal.org"
echo "   • https://chqcal.org"
echo ""
echo "⏱️  Note: It may take a few minutes for changes to propagate globally."
echo ""
echo "🔧 Useful commands:"
echo "   • Check S3 contents: aws s3 ls s3://$S3_BUCKET/"
echo "   • Manual invalidation: aws cloudfront create-invalidation --distribution-id $CLOUDFRONT_DISTRIBUTION_ID --paths '/*'"
echo ""
echo "Happy browsing! 🚀"
