# Utility Scripts

## Full Season Sync Trigger

The `trigger-full-season-sync.js` script allows you to manually trigger a full season sync on either your local DynamoDB or production environment.

### Usage

```bash
# From the backend directory
npm run trigger-sync

# Or run directly
node utils/trigger-full-season-sync.js
```

### Features

The script provides an interactive prompt system that allows you to:

1. **Select Environment**:
   - `localhost` - Uses DynamoDB Local on `localhost:8000`
   - `production` - Uses AWS DynamoDB

2. **Select Sync Type**:
   - `Full Season Sync` - Syncs all events for the current season
   - `Incremental Sync` - Syncs only recent changes (last 7 days to next 30 days)
   - `Custom Date Range Sync` - Syncs events for a custom date range

3. **Safety Confirmations**:
   - Shows configuration before proceeding
   - Requires explicit "yes" confirmation
   - Warns when targeting production

### Prerequisites

#### For Localhost
- DynamoDB Local running on `localhost:8000`
- Table created (use `npm run init-tables`)

```bash
# Start DynamoDB Local
java -Djava.library.path=./DynamoDBLocal_lib -jar DynamoDBLocal.jar -sharedDb

# Create tables
npm run init-tables
```

#### For Production
- AWS credentials configured
- Proper IAM permissions for DynamoDB access

### Example Usage

```bash
$ npm run trigger-sync

🔧 Chautauqua Calendar - Full Season Sync Trigger

Available environments:
1. localhost (DynamoDB Local)
2. production (AWS DynamoDB)

Select environment (1 or 2): 1

Sync types available:
1. Full Season Sync (all events for the season)
2. Incremental Sync (recent changes only)
3. Custom Date Range Sync

Select sync type (1, 2, or 3): 1

⚠️  Sync Configuration:
   Environment: LOCALHOST
   Table: chq-calendar-events
   Sync Type: full-season

Are you sure you want to proceed? (yes/no): yes

🔄 Initializing sync service...
🚀 Starting sync operation...

✅ Sync completed!
📊 Results:
   Success: true
   Events Processed: 1250
   Events Created: 1250
   Events Updated: 0
   Events Deleted: 0
   Duration: 15247ms
   Sync Duration: 14892ms

🎉 Sync operation completed successfully!
```

### Configuration

The script uses these environment configurations:

```javascript
const ENVIRONMENTS = {
  localhost: {
    endpoint: 'http://localhost:8000',
    region: 'us-east-1',
    tableName: 'chq-calendar-events'
  },
  production: {
    region: 'us-east-1',
    tableName: 'chq-calendar-events'
  }
};
```

### Error Handling

The script includes comprehensive error handling:

- **Network errors**: Provides troubleshooting tips for DynamoDB Local
- **Validation errors**: Validates date formats for custom ranges
- **Service errors**: Shows detailed error messages from the sync service
- **Graceful interruption**: Handles Ctrl+C to exit cleanly

### Security

- Production operations require explicit confirmation
- Localhost uses dummy credentials for DynamoDB Local
- No sensitive data is logged or stored

### Troubleshooting

**DynamoDB Local not running**:
```bash
java -Djava.library.path=./DynamoDBLocal_lib -jar DynamoDBLocal.jar -sharedDb
```

**Table doesn't exist**:
```bash
npm run init-tables
```

**Permission errors (production)**:
- Ensure AWS credentials are configured
- Verify IAM permissions for DynamoDB access

**Module not found errors**:
```bash
npm install
```