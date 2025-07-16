#!/bin/bash

# Chautauqua Calendar - Local Development Setup Script

set -e

echo "🎪 Setting up Chautauqua Calendar for local development..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Function to check if port is available
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "❌ Port $port is already in use. Please stop the service using this port."
        exit 1
    fi
}

# Check required ports
echo "🔍 Checking if required ports are available..."
check_port 3000
check_port 3001
check_port 8000
check_port 8001

# Create Docker network if it doesn't exist
echo "🌐 Creating Docker network..."
docker network create chq-calendar-network 2>/dev/null || echo "Network already exists"

# Install backend dependencies
echo "📦 Installing backend dependencies..."
cd backend
npm install
cd ..

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd frontend
npm install
cd ..

# Build and start services
echo "🚀 Building and starting services..."
docker-compose up -d --build

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Check if services are running
echo "🔍 Checking service health..."

# Check DynamoDB
if curl -s http://localhost:8000 > /dev/null; then
    echo "✅ DynamoDB Local is running on port 8000"
else
    echo "❌ DynamoDB Local failed to start"
fi

# Check Backend API
if curl -s http://localhost:3001/health > /dev/null; then
    echo "✅ Backend API is running on port 3001"
else
    echo "❌ Backend API failed to start"
fi

# Check Frontend
if curl -s http://localhost:3000 > /dev/null; then
    echo "✅ Frontend is running on port 3000"
else
    echo "❌ Frontend failed to start"
fi

# Check DynamoDB Admin
if curl -s http://localhost:8001 > /dev/null; then
    echo "✅ DynamoDB Admin is running on port 8001"
else
    echo "❌ DynamoDB Admin failed to start"
fi

echo ""
echo "🎉 Local development environment is ready!"
echo ""
echo "📋 Services:"
echo "   • Frontend:        http://localhost:3000"
echo "   • Backend API:     http://localhost:3001"
echo "   • DynamoDB Local:  http://localhost:8000"
echo "   • DynamoDB Admin:  http://localhost:8001"
echo ""
echo "🔧 Useful commands:"
echo "   • View logs:       docker-compose logs -f"
echo "   • Stop services:   docker-compose down"
echo "   • Restart:         docker-compose restart"
echo "   • Rebuild:         docker-compose up -d --build"
echo ""
echo "🗄️  Database:"
echo "   • DynamoDB tables will be created automatically"
echo "   • Data persists in Docker volume 'dynamodb_data'"
echo "   • Use DynamoDB Admin UI to view/edit data"
echo ""
echo "Happy coding! 🚀"
