import { DataSyncService } from '../services/dataSyncService';

async function main() {
  const syncService = new DataSyncService();
  
  console.log('Starting data sync...');
  
  try {
    const result = await syncService.syncEventData({
      monthsToSync: 3,
      forceUpdate: process.argv.includes('--force'),
    });
    
    console.log('Sync completed:');
    console.log(`  Success: ${result.success}`);
    console.log(`  Events added: ${result.eventsAdded}`);
    console.log(`  Events updated: ${result.eventsUpdated}`);
    console.log(`  Events skipped: ${result.eventsSkipped}`);
    console.log(`  Errors: ${result.errors.length}`);
    
    if (result.errors.length > 0) {
      console.log('Errors encountered:');
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
    }
    
    console.log(`  Last sync time: ${result.lastSyncTime}`);
    
  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  }
}

main();