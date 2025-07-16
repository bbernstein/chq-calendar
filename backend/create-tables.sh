#!/bin/bash

echo "🚀 Creating DynamoDB tables for local development..."

# Set local DynamoDB endpoint
ENDPOINT="--endpoint-url http://localhost:8000"
REGION="--region us-east-1"

# Create events table
echo "📋 Creating events table..."
aws dynamodb create-table $ENDPOINT $REGION \
  --table-name chq-calendar-events \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=startDate,AttributeType=S \
    AttributeName=category,AttributeType=S \
  --key-schema \
    AttributeName=id,KeyType=HASH \
  --global-secondary-indexes \
    IndexName=DateIndex,KeySchema='[{AttributeName=startDate,KeyType=HASH}]',Projection='{ProjectionType=ALL}',ProvisionedThroughput='{ReadCapacityUnits=5,WriteCapacityUnits=5}' \
    IndexName=CategoryIndex,KeySchema='[{AttributeName=category,KeyType=HASH},{AttributeName=startDate,KeyType=RANGE}]',Projection='{ProjectionType=ALL}',ProvisionedThroughput='{ReadCapacityUnits=5,WriteCapacityUnits=5}' \
  --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
  || echo "Events table might already exist"

# Create data sources table  
echo "📋 Creating data sources table..."
aws dynamodb create-table $ENDPOINT $REGION \
  --table-name chq-calendar-data-sources \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
  --key-schema \
    AttributeName=id,KeyType=HASH \
  --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
  || echo "Data sources table might already exist"

echo "✅ Table creation completed!"

# List tables to verify
echo "📋 Current tables:"
aws dynamodb list-tables $ENDPOINT $REGION