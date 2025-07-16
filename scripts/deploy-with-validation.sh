#!/bin/bash

# Deployment script with local validation
# This script ensures we test locally before deploying to production

set -e

echo "🚀 Chautauqua Calendar Deployment with Validation"
echo "================================================"

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

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker and try again."
    exit 1
fi

# Step 1: Start local environment
print_status "Step 1: Starting local development environment..."
docker-compose up -d

# Wait for services to be ready
print_status "Waiting for services to start..."
sleep 10

# Step 2: Test local environment
print_status "Step 2: Testing local environment..."

# Test backend health
print_status "Testing backend health..."
if curl -s http://localhost:3001/health > /dev/null; then
    print_success "Backend is healthy"
else
    print_error "Backend health check failed"
    docker-compose logs backend
    exit 1
fi

# Test frontend
print_status "Testing frontend..."
if curl -s http://localhost:3000 > /dev/null; then
    print_success "Frontend is accessible"
else
    print_error "Frontend is not accessible"
    docker-compose logs frontend
    exit 1
fi

# Test API endpoints
print_status "Testing API endpoints..."
EVENT_COUNT=$(curl -s -X POST 'http://localhost:3001/calendar' -H "Content-Type: application/json" -d '{"filters": {}}' | jq '.events | length' 2>/dev/null || echo "0")
if [ "$EVENT_COUNT" -gt "0" ]; then
    print_success "API returning $EVENT_COUNT events"
else
    print_error "API not returning events or returning 0 events"
    exit 1
fi

# Test Week 3 filtering (known issue we fixed)
print_status "Testing Week 3 filtering..."
WEEK3_COUNT=$(curl -s -X POST 'http://localhost:3001/calendar' -H "Content-Type: application/json" -d '{"filters": {"dateRange": {"start": "2025-07-06T00:00:00.000Z", "end": "2025-07-12T23:59:59.999Z"}}}' | jq '.events | length' 2>/dev/null || echo "0")
if [ "$WEEK3_COUNT" -gt "0" ]; then
    print_success "Week 3 filtering working ($WEEK3_COUNT events)"
else
    print_error "Week 3 filtering not working (0 events)"
    exit 1
fi

# Test sync process
print_status "Testing sync process..."
SYNC_RESULT=$(curl -s -X POST http://localhost:3001/sync | jq '.success' 2>/dev/null || echo "false")
if [ "$SYNC_RESULT" = "true" ]; then
    print_success "Sync process working"
else
    print_error "Sync process failed"
    exit 1
fi

# Step 3: Manual validation prompt
print_status "Step 3: Manual validation required..."
print_warning "Please manually test the following:"
echo "1. Open http://localhost:3000 in your browser"
echo "2. Verify events are displayed correctly"
echo "3. Test week filtering by clicking different weeks"
echo "4. Test mobile functionality (tap-to-toggle)"
echo "5. Check that search functionality works"
echo "6. Verify no console errors in browser"

echo ""
read -p "Has manual testing passed? (y/n): " manual_test_passed

if [ "$manual_test_passed" != "y" ]; then
    print_error "Manual testing failed. Please fix issues and try again."
    exit 1
fi

print_success "Local testing completed successfully!"

# Step 4: Deployment confirmation
print_status "Step 4: Ready for production deployment..."
print_warning "You are about to deploy to production at chqcal.org"
echo ""
read -p "Deploy to production? (y/n): " deploy_to_prod

if [ "$deploy_to_prod" != "y" ]; then
    print_warning "Production deployment cancelled."
    exit 0
fi

# Step 5: Deploy to production
print_status "Step 5: Deploying to production..."
./scripts/deploy.sh

print_success "Production deployment completed!"

# Step 6: Production verification
print_status "Step 6: Verifying production deployment..."
sleep 5

# Test production API
print_status "Testing production API..."
PROD_EVENT_COUNT=$(curl -s "https://www.chqcal.org/api/calendar" -H "Content-Type: application/json" -d '{"filters": {}}' | jq '.events | length' 2>/dev/null || echo "0")
if [ "$PROD_EVENT_COUNT" -gt "0" ]; then
    print_success "Production API returning $PROD_EVENT_COUNT events"
else
    print_error "Production API not returning events"
    exit 1
fi

# Test production Week 3 filtering
print_status "Testing production Week 3 filtering..."
PROD_WEEK3_COUNT=$(curl -s "https://www.chqcal.org/api/calendar" -H "Content-Type: application/json" -d '{"filters": {"dateRange": {"start": "2025-07-06T04:00:00.000Z", "end": "2025-07-12T04:00:00.000Z"}}}' | jq '.events | length' 2>/dev/null || echo "0")
if [ "$PROD_WEEK3_COUNT" -gt "0" ]; then
    print_success "Production Week 3 filtering working ($PROD_WEEK3_COUNT events)"
else
    print_error "Production Week 3 filtering not working"
    exit 1
fi

print_success "Production verification completed!"

# Step 7: Final summary
print_status "Deployment Summary:"
echo "✅ Local testing: PASSED"
echo "✅ Production deployment: COMPLETED"
echo "✅ Production verification: PASSED"
echo ""
echo "🎉 Deployment successful!"
echo "🌐 Frontend: https://www.chqcal.org"
echo "🔗 API: https://www.chqcal.org/api/calendar"
echo ""
print_warning "Don't forget to:"
echo "1. Test the live website manually"
echo "2. Monitor logs for any issues"
echo "3. Update any documentation if needed"