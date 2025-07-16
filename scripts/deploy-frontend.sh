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

# Get S3 bucket name from Terraform output
cd infrastructure
S3_BUCKET=$(terraform output -raw s3_bucket_name 2>/dev/null)
CLOUDFRONT_DISTRIBUTION_ID=$(terraform output -raw cloudfront_distribution_id 2>/dev/null)
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

# Build the frontend
echo "🔨 Building frontend..."
npm run build

# Check if build was successful
if [ ! -d "out" ] && [ ! -d ".next" ]; then
    echo "❌ Error: Build failed. No output directory found."
    exit 1
fi

# Configure Next.js for static export if not already configured
if [ ! -f "next.config.ts.backup" ]; then
    echo "⚙️  Configuring Next.js for static export..."
    cp next.config.ts next.config.ts.backup

    cat > next.config.ts << 'EOF'
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  assetPrefix: process.env.NODE_ENV === 'production' ? 'https://www.chqcal.org' : '',
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://2jjx0zum0c.execute-api.us-east-1.amazonaws.com/prod'
  }
};

export default nextConfig;
EOF

    echo "🔄 Rebuilding with static export configuration..."
    npm run build
fi

# Determine output directory
if [ -d "out" ]; then
    BUILD_DIR="out"
elif [ -d ".next" ]; then
    BUILD_DIR=".next"
else
    echo "❌ Error: No build output found."
    exit 1
fi

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
echo "☁️  Uploading files to S3..."
aws s3 sync "$BUILD_DIR/" "s3://$S3_BUCKET/" \
    --delete \
    --cache-control "public, max-age=31536000" \
    --exclude "*.html" \
    --exclude "*.xml" \
    --exclude "*.txt"

# Upload HTML files with different cache control
echo "📄 Uploading HTML files..."
aws s3 sync "$BUILD_DIR/" "s3://$S3_BUCKET/" \
    --delete \
    --cache-control "public, max-age=0, must-revalidate" \
    --content-type "text/html" \
    --include "*.html"

# Upload other text files
echo "📄 Uploading text files..."
find "$BUILD_DIR" -name "*.xml" -o -name "*.txt" -o -name "*.json" | while read file; do
    if [ -f "$file" ]; then
        relative_path=${file#$BUILD_DIR/}
        aws s3 cp "$file" "s3://$S3_BUCKET/$relative_path" \
            --cache-control "public, max-age=3600"
    fi
done

# Set proper content types for specific files
echo "🔧 Setting content types..."
aws s3 cp "s3://$S3_BUCKET/index.html" "s3://$S3_BUCKET/index.html" \
    --metadata-directive REPLACE \
    --content-type "text/html" \
    --cache-control "public, max-age=0, must-revalidate" || true

aws s3 cp "s3://$S3_BUCKET/error.html" "s3://$S3_BUCKET/error.html" \
    --metadata-directive REPLACE \
    --content-type "text/html" \
    --cache-control "public, max-age=0, must-revalidate" || true

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
