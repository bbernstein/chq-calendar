#!/bin/bash

# Chautauqua Calendar - Complete Deployment Script
# Orchestrates infrastructure, backend, and frontend deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}$1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Function to check if command exists
check_command() {
    if ! command -v $1 &> /dev/null; then
        print_error "$1 is not installed. Please install it first."
        exit 1
    fi
}

# Function to check if we're in the right directory
check_directory() {
    if [ ! -f "package.json" ] || [ ! -d "infrastructure" ] || [ ! -d "backend" ] || [ ! -d "frontend" ]; then
        print_error "This script must be run from the project root directory."
        exit 1
    fi
}

echo "🎪 Deploying Chautauqua Calendar Application"
echo "============================================="

# Pre-flight checks
print_status "🔍 Running pre-flight checks..."
check_directory
check_command "terraform"
check_command "aws"
check_command "npm"
check_command "node"

# Check AWS credentials
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    print_error "AWS credentials not configured. Please run 'aws configure' first."
    exit 1
fi

print_success "Pre-flight checks passed"

# Deploy infrastructure
print_status "📦 Deploying infrastructure..."
cd infrastructure

# Initialize Terraform
terraform init

# Plan and apply
terraform plan -out=tfplan
if ! terraform apply tfplan; then
    print_error "Infrastructure deployment failed"
    exit 1
fi

# Get outputs
API_URL=$(terraform output -raw api_url)
S3_BUCKET=$(terraform output -raw s3_bucket_name)
FRONTEND_URL=$(terraform output -raw frontend_url)
CLOUDFRONT_DISTRIBUTION_ID=$(terraform output -raw cloudfront_distribution_id)

cd ..

print_success "Infrastructure deployed"
print_status "API URL: $API_URL"
print_status "S3 Bucket: $S3_BUCKET"

# Deploy backend
print_status "⚙️ Deploying backend..."
cd backend

# Install dependencies
npm install

# Build Lambda function
npm run build

# Create deployment package (if not exists)
if [ ! -f "lambda-function.zip" ] || [ "dist/calendarHandler.js" -nt "lambda-function.zip" ]; then
    print_status "📦 Creating Lambda deployment package..."
    zip -r lambda-function.zip dist/ package.json
fi

# Deploy using npm script if it exists, otherwise use AWS CLI
if npm run deploy > /dev/null 2>&1; then
    print_status "Using npm deploy script..."
    npm run deploy
else
    print_status "Using AWS CLI to update Lambda..."
    aws lambda update-function-code \
        --function-name chautauqua-calendar-generator \
        --zip-file fileb://lambda-function.zip
fi

cd ..

print_success "Backend deployed"

# Deploy frontend using our specialized script
print_status "🎨 Deploying frontend..."
if [ -f "scripts/deploy-frontend.sh" ]; then
    ./scripts/deploy-frontend.sh
else
    print_warning "Frontend deployment script not found, using basic deployment..."

    cd frontend
    npm install

    # Set environment variables
    export NEXT_PUBLIC_API_URL=$API_URL

    # Build
    npm run build

    # Upload to S3
    if [ -d "out" ]; then
        aws s3 sync out/ s3://$S3_BUCKET --delete
    else
        print_error "Frontend build output not found"
        exit 1
    fi

    # Invalidate CloudFront cache
    if [ ! -z "$CLOUDFRONT_DISTRIBUTION_ID" ]; then
        aws cloudfront create-invalidation --distribution-id $CLOUDFRONT_DISTRIBUTION_ID --paths "/*" > /dev/null
        print_success "CloudFront cache invalidated"
    fi

    cd ..
fi

print_success "Frontend deployed"

# Final checks
print_status "🔍 Running post-deployment checks..."

# Check API health
if curl -s "$API_URL/health" > /dev/null; then
    print_success "API health check passed"
else
    print_warning "API health check failed - API may still be starting up"
fi

# Check frontend
if curl -s "$FRONTEND_URL" > /dev/null; then
    print_success "Frontend health check passed"
else
    print_warning "Frontend health check failed - CDN may still be propagating"
fi

echo ""
echo "🎉 Deployment Complete!"
echo "======================="
echo ""
echo "📋 Deployment Summary:"
echo "   • Infrastructure: ✅ Deployed"
echo "   • Backend API:    ✅ Deployed"
echo "   • Frontend:       ✅ Deployed"
echo ""
echo "🌐 URLs:"
echo "   • Website:  $FRONTEND_URL"
echo "   • API:      $API_URL"
echo ""
echo "🔧 Useful endpoints:"
echo "   • Health:      $API_URL/health"
echo "   • Sample data: $API_URL/calendar/sample-data (POST)"
echo "   • Calendar:    $API_URL/calendar (POST)"
echo ""
echo "⏱️  Note: Changes may take a few minutes to propagate globally."
echo ""
print_success "Happy coding! 🚀"
