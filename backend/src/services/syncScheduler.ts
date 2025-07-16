import { EventsCalendarDataSyncService } from './eventsCalendarDataSyncService';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export class SyncScheduler {
  private syncService: EventsCalendarDataSyncService;
  private dailySyncInterval: NodeJS.Timeout | null = null;
  private hourlySyncInterval: NodeJS.Timeout | null = null;

  constructor(dbClient: DynamoDBDocumentClient) {
    this.syncService = new EventsCalendarDataSyncService(undefined, dbClient);
  }

  /**
   * Start the sync scheduler
   */
  start(): void {
    console.log('🕐 Starting sync scheduler...');
    
    // Schedule daily full sync at 2 AM
    this.scheduleDailySync();
    
    // Schedule hourly sync for next 7 days
    this.scheduleHourlySync();
    
    console.log('✅ Sync scheduler started');
    console.log('📅 Daily full sync: Every day at 2:00 AM');
    console.log('⏰ Hourly sync (next 7 days): Every hour');
  }

  /**
   * Stop the sync scheduler
   */
  stop(): void {
    console.log('🛑 Stopping sync scheduler...');
    
    if (this.dailySyncInterval) {
      clearInterval(this.dailySyncInterval);
      this.dailySyncInterval = null;
    }
    
    if (this.hourlySyncInterval) {
      clearInterval(this.hourlySyncInterval);
      this.hourlySyncInterval = null;
    }
    
    console.log('✅ Sync scheduler stopped');
  }

  /**
   * Schedule daily full sync
   */
  private scheduleDailySync(): void {
    // Calculate milliseconds until next 2 AM
    const now = new Date();
    const next2AM = new Date();
    next2AM.setHours(2, 0, 0, 0);
    
    // If it's already past 2 AM today, schedule for tomorrow
    if (now.getHours() >= 2) {
      next2AM.setDate(next2AM.getDate() + 1);
    }
    
    const msUntilNext2AM = next2AM.getTime() - now.getTime();
    
    console.log(`📅 Daily sync scheduled for: ${next2AM.toLocaleString()}`);
    
    // Schedule first daily sync
    setTimeout(() => {
      this.performDailySync();
      
      // Then schedule recurring daily syncs
      this.dailySyncInterval = setInterval(() => {
        this.performDailySync();
      }, 24 * 60 * 60 * 1000); // 24 hours
    }, msUntilNext2AM);
  }

  /**
   * Schedule hourly sync
   */
  private scheduleHourlySync(): void {
    console.log('⏰ Hourly sync starting in 5 minutes, then every hour');
    
    // Start hourly sync in 5 minutes (to avoid immediate startup load)
    setTimeout(() => {
      this.performHourlySync();
      
      // Then schedule recurring hourly syncs
      this.hourlySyncInterval = setInterval(() => {
        this.performHourlySync();
      }, 60 * 60 * 1000); // 1 hour
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Perform daily sync
   */
  private async performDailySync(): Promise<void> {
    try {
      console.log('🔄 Starting scheduled daily sync...');
      const result = await this.syncService.performDailySync();
      console.log('✅ Daily sync completed:', {
        success: result.success,
        eventsProcessed: result.eventsProcessed,
        eventsCreated: result.eventsCreated,
        eventsUpdated: result.eventsUpdated,
        duration: result.duration
      });
    } catch (error) {
      console.error('❌ Daily sync failed:', error);
    }
  }

  /**
   * Perform hourly sync
   */
  private async performHourlySync(): Promise<void> {
    try {
      console.log('🔄 Starting scheduled hourly sync...');
      const result = await this.syncService.performHourlySync();
      console.log('✅ Hourly sync completed:', {
        success: result.success,
        eventsProcessed: result.eventsProcessed,
        eventsCreated: result.eventsCreated,
        eventsUpdated: result.eventsUpdated,
        duration: result.duration
      });
    } catch (error) {
      console.error('❌ Hourly sync failed:', error);
    }
  }

  /**
   * Perform immediate full sync
   */
  async performImmediateFullSync(): Promise<void> {
    try {
      console.log('🔄 Starting immediate full sync...');
      const result = await this.syncService.syncAllSeasonEvents();
      console.log('✅ Immediate full sync completed:', {
        success: result.success,
        eventsProcessed: result.eventsProcessed,
        eventsCreated: result.eventsCreated,
        eventsUpdated: result.eventsUpdated,
        duration: result.duration
      });
    } catch (error) {
      console.error('❌ Immediate full sync failed:', error);
    }
  }

  /**
   * Get scheduler status
   */
  getStatus(): { 
    dailySyncActive: boolean; 
    hourlySyncActive: boolean; 
    nextDailySync: string;
    nextHourlySync: string;
  } {
    const now = new Date();
    
    // Calculate next 2 AM
    const next2AM = new Date();
    next2AM.setHours(2, 0, 0, 0);
    if (now.getHours() >= 2) {
      next2AM.setDate(next2AM.getDate() + 1);
    }
    
    // Calculate next hour
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    
    return {
      dailySyncActive: this.dailySyncInterval !== null,
      hourlySyncActive: this.hourlySyncInterval !== null,
      nextDailySync: next2AM.toLocaleString(),
      nextHourlySync: nextHour.toLocaleString()
    };
  }
}

export default SyncScheduler;