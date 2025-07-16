# Utilities

This directory contains utility scripts for managing the Chautauqua Calendar system.

## Scripts

### `integration-test.js`
Comprehensive integration test suite that compares localhost vs production calendar data.

**Usage:**
```bash
node utils/integration-test.js
```

**Features:**
- Tests all 9 weeks of the Chautauqua season
- Compares event counts and data consistency
- Generates detailed reports with pass/fail status
- Validates date filtering across different week combinations

### `clear-production-db.js`
Clears all events from the production DynamoDB table.

**Usage:**
```bash
node utils/clear-production-db.js
```

**⚠️ Warning:** This will delete all events from the production database. Use with caution.

### `recreate-tables.js`
Recreates local DynamoDB tables for development.

**Usage:**
```bash
node utils/recreate-tables.js
```

**Features:**
- Drops and recreates all local DynamoDB tables
- Useful for resetting local development environment
- Only affects local DynamoDB instance

### `test-weeks.js`
Tests specific week date ranges and event filtering.

**Usage:**
```bash
node utils/test-weeks.js
```

**Features:**
- Tests individual week date calculations
- Validates week boundaries
- Useful for debugging date-related issues

### `trigger-full-season-sync.js`
Manually triggers a full season sync on production.

**Usage:**
```bash
node utils/trigger-full-season-sync.js
```

**Features:**
- Invokes the production data sync Lambda function
- Forces a complete season sync (June 22 - August 23)
- Useful for manual data refresh

## Prerequisites

All scripts require:
- Node.js runtime
- AWS credentials configured (for production scripts)
- Access to the appropriate DynamoDB tables

## Development

These scripts are designed for development, testing, and maintenance purposes. They should not be used in automated production workflows.