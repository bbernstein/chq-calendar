#!/bin/bash

# Start local development environment
# This script starts the Docker development environment and runs basic health checks

set -e

echo "🏠 Starting Local Development Environment"
echo "========================================"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}$1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Start Docker Compose
print_status "Starting Docker containers..."
docker-compose up -d

# Wait for services to be ready
print_status "Waiting for services to start..."
sleep 10

# Check backend health
print_status "Checking backend health..."
if curl -s http://localhost:3001/health > /dev/null; then
    print_success "Backend is running at http://localhost:3001"
else
    echo "❌ Backend health check failed"
    docker-compose logs backend
    exit 1
fi

# Check frontend
print_status "Checking frontend..."
if curl -s http://localhost:3000 > /dev/null; then
    print_success "Frontend is running at http://localhost:3000"
else
    echo "❌ Frontend check failed"
    docker-compose logs frontend
    exit 1
fi

# Check DynamoDB
print_status "Checking DynamoDB..."
if curl -s http://localhost:8000 > /dev/null; then
    print_success "DynamoDB is running at http://localhost:8000"
else
    echo "❌ DynamoDB check failed"
    docker-compose logs dynamodb
    exit 1
fi

# Check DynamoDB Admin
print_status "Checking DynamoDB Admin..."
if curl -s http://localhost:8001 > /dev/null; then
    print_success "DynamoDB Admin is running at http://localhost:8001"
else
    print_warning "DynamoDB Admin may not be ready yet"
fi

print_success "Local development environment is ready!"
echo ""
echo "🌐 Frontend: http://localhost:3000"
echo "🔗 Backend API: http://localhost:3001"
echo "🗄️  DynamoDB: http://localhost:8000"
echo "🛠️  DynamoDB Admin: http://localhost:8001"
echo ""
echo "📋 Useful commands:"
echo "   View logs: docker-compose logs -f [service]"
echo "   Stop environment: docker-compose down"
echo "   Restart service: docker-compose restart [service]"
echo ""
print_warning "Next steps:"
echo "1. Test the frontend at http://localhost:3000"
echo "2. Make your code changes"
echo "3. Test thoroughly"
echo "4. Use './scripts/deploy-with-validation.sh' to deploy to production"