import { SyncStatusService, VALID_SYNC_TYPES } from '../services/syncStatusService';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-123')
}));

// Mock DynamoDB client
const mockSend = jest.fn();
const mockDocClient = {
  send: mockSend
} as unknown as DynamoDBDocumentClient;

describe('SyncStatusService', () => {
  let service: SyncStatusService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SyncStatusService(mockDocClient, 'test-sync-status-table');
  });

  describe('constructor', () => {
    it('should create service with provided table name', () => {
      const customService = new SyncStatusService(mockDocClient, 'custom-table');
      expect(customService).toBeDefined();
    });

    it('should use default table name from environment', () => {
      process.env.SYNC_STATUS_TABLE_NAME = 'env-table';
      const defaultService = new SyncStatusService(mockDocClient);
      expect(defaultService).toBeDefined();
    });
  });

  describe('createSyncStatus', () => {
    it('should create a new sync status record', async () => {
      mockSend.mockResolvedValue({});

      const syncId = await service.createSyncStatus('manual', 'request-123', { custom: 'data' });

      expect(syncId).toBe('mock-uuid-123');
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0][0]).toBeInstanceOf(PutCommand);
    });

    it('should create sync status without optional parameters', async () => {
      mockSend.mockResolvedValue({});

      const syncId = await service.createSyncStatus('scheduled');

      expect(syncId).toBe('mock-uuid-123');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('startSync', () => {
    it('should update sync status to in_progress', async () => {
      mockSend.mockResolvedValue({});

      await service.startSync('sync-123');

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0][0]).toBeInstanceOf(UpdateCommand);
    });

    it('should update sync with initial progress', async () => {
      mockSend.mockResolvedValue({});

      const progress = {
        currentStep: 'Fetching data',
        totalSteps: 5,
        completedSteps: 1,
        percentage: 20
      };

      await service.startSync('sync-123', progress);

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateProgress', () => {
    it('should update sync progress', async () => {
      mockSend.mockResolvedValue({});

      const progress = {
        currentStep: 'Processing events',
        totalSteps: 5,
        completedSteps: 3,
        percentage: 60
      };

      await service.updateProgress('sync-123', progress);

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0][0]).toBeInstanceOf(UpdateCommand);
    });
  });

  describe('completeSyncSuccess', () => {
    it('should complete sync with success status', async () => {
      // Mock GetCommand for duration calculation
      mockSend
        .mockResolvedValueOnce({
          Item: {
            id: 'sync-123',
            startTime: new Date(Date.now() - 5000).toISOString()
          }
        })
        .mockResolvedValueOnce({}); // UpdateCommand

      const result = {
        eventsProcessed: 100,
        eventsCreated: 10,
        eventsUpdated: 85,
        eventsDeleted: 5,
        eventsSkipped: 0,
        errors: []
      };

      await service.completeSyncSuccess('sync-123', result);

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend.mock.calls[0][0]).toBeInstanceOf(GetCommand);
      expect(mockSend.mock.calls[1][0]).toBeInstanceOf(UpdateCommand);
    });

    it('should handle missing start time gracefully', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: null })
        .mockResolvedValueOnce({});

      const result = {
        eventsProcessed: 50,
        eventsCreated: 5,
        eventsUpdated: 45,
        eventsDeleted: 0,
        eventsSkipped: 0,
        errors: []
      };

      await service.completeSyncSuccess('sync-123', result);

      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('completeSyncFailure', () => {
    it('should complete sync with failure status', async () => {
      mockSend
        .mockResolvedValueOnce({
          Item: {
            id: 'sync-123',
            startTime: new Date(Date.now() - 3000).toISOString()
          }
        })
        .mockResolvedValueOnce({});

      await service.completeSyncFailure('sync-123', 'Connection timeout');

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend.mock.calls[0][0]).toBeInstanceOf(GetCommand);
      expect(mockSend.mock.calls[1][0]).toBeInstanceOf(UpdateCommand);
    });

    it('should complete sync failure with partial result', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: { startTime: new Date().toISOString() } })
        .mockResolvedValueOnce({});

      const partialResult = {
        eventsProcessed: 50,
        eventsCreated: 5,
        eventsUpdated: 40,
        eventsDeleted: 0,
        eventsSkipped: 5,
        errors: ['Error 1', 'Error 2']
      };

      await service.completeSyncFailure('sync-123', 'Partial failure', partialResult);

      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('getSyncStatus', () => {
    it('should return sync status by ID', async () => {
      const mockStatus = {
        id: 'sync-123',
        type: 'manual',
        status: 'completed',
        timestamp: Date.now()
      };
      mockSend.mockResolvedValue({ Item: mockStatus });

      const result = await service.getSyncStatus('sync-123');

      expect(result).toEqual(mockStatus);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    });

    it('should return null if sync not found', async () => {
      mockSend.mockResolvedValue({});

      const result = await service.getSyncStatus('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getRecentSyncStatuses', () => {
    it('should get recent sync statuses by type', async () => {
      const mockStatuses = [
        { id: 'sync-1', type: 'manual', status: 'completed' },
        { id: 'sync-2', type: 'manual', status: 'in_progress' }
      ];
      mockSend.mockResolvedValue({ Items: mockStatuses });

      const result = await service.getRecentSyncStatuses('manual', 5);

      expect(result).toEqual(mockStatuses);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
    });

    it('should get recent sync statuses without type filter by fanning out across all known types', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const result = await service.getRecentSyncStatuses();

      expect(result).toEqual([]);
      // No-type path runs one Query per VALID_SYNC_TYPES entry to
      // cover the table; the previous "manual"-only fallback masked
      // records of other types.
      expect(mockSend).toHaveBeenCalledTimes(VALID_SYNC_TYPES.length);
    });

    it('should merge per-type results and sort by timestamp desc when no type filter', async () => {
      // Per-type queries are issued in VALID_SYNC_TYPES order; queue
      // one result per type so the merge/sort can be exercised. The
      // arbitrary timestamps below are chosen so the top-3 by
      // timestamp (desc) is hourly → scheduled → incremental.
      const perTypeRecord: Record<string, unknown> = {
        manual: { id: 'm-1', type: 'manual', timestamp: 300 },
        scheduled: { id: 's-1', type: 'scheduled', timestamp: 500 },
        full: { id: 'f-1', type: 'full', timestamp: 100 },
        incremental: { id: 'i-1', type: 'incremental', timestamp: 400 },
        daily: { id: 'd-1', type: 'daily', timestamp: 200 },
        hourly: { id: 'h-1', type: 'hourly', timestamp: 600 },
      };
      for (const t of VALID_SYNC_TYPES) {
        mockSend.mockResolvedValueOnce({ Items: [perTypeRecord[t]] });
      }

      const result = await service.getRecentSyncStatuses(undefined, 3);

      expect(result.map(r => r.id)).toEqual(['h-1', 's-1', 'i-1']);
      expect(result.map(r => r.timestamp)).toEqual([600, 500, 400]);
      expect(mockSend).toHaveBeenCalledTimes(VALID_SYNC_TYPES.length);
    });

    it('should handle empty result', async () => {
      mockSend.mockResolvedValue({ Items: null });

      const result = await service.getRecentSyncStatuses('manual');

      expect(result).toEqual([]);
    });
  });

  describe('getActiveSyncs', () => {
    it('should return active syncs', async () => {
      const activeSyncs = [
        { id: 'sync-1', status: 'in_progress', type: 'manual' },
        { id: 'sync-2', status: 'pending', type: 'manual' }
      ];
      mockSend.mockResolvedValue({ Items: activeSyncs });

      const result = await service.getActiveSyncs();

      expect(result).toEqual(activeSyncs);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should handle empty active syncs', async () => {
      mockSend.mockResolvedValue({ Items: null });

      const result = await service.getActiveSyncs();

      expect(result).toEqual([]);
    });
  });

  describe('getSyncStatistics', () => {
    it('should calculate sync statistics correctly', async () => {
      const now = Date.now();
      const mockSyncs = [
        {
          id: 'sync-1',
          type: 'manual',
          status: 'completed',
          timestamp: now - 1000,
          duration: 5000
        },
        {
          id: 'sync-2',
          type: 'scheduled',
          status: 'completed',
          timestamp: now - 2000,
          duration: 3000
        },
        {
          id: 'sync-3',
          type: 'manual',
          status: 'failed',
          timestamp: now - 3000
        },
        {
          id: 'sync-4',
          type: 'manual',
          status: 'in_progress',
          timestamp: now - 1000
        }
      ];
      // Distribute the fixture across the per-type queries that
      // getSyncStatistics now fans out to. The mockSyncs use 'manual'
      // and 'scheduled' types, so the TypeIndex would return them
      // from their respective queries — the other four types return
      // empty.
      const recordsByType: Record<string, unknown[]> = {
        manual: mockSyncs.filter(s => s.type === 'manual'),
        scheduled: mockSyncs.filter(s => s.type === 'scheduled'),
      };
      for (const t of VALID_SYNC_TYPES) {
        mockSend.mockResolvedValueOnce({ Items: recordsByType[t] ?? [] });
      }

      const stats = await service.getSyncStatistics(1);

      expect(stats.totalSyncs).toBe(4);
      expect(stats.successfulSyncs).toBe(2);
      expect(stats.failedSyncs).toBe(1);
      expect(stats.averageDuration).toBe(4000);
      expect(stats.syncsByType).toEqual({
        manual: 3,
        scheduled: 1
      });
      expect(stats.recentSyncs).toHaveLength(4);
    });

    it('should handle empty sync history', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const stats = await service.getSyncStatistics();

      expect(stats).toMatchObject({
        totalSyncs: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        averageDuration: 0,
        syncsByType: {},
        recentSyncs: []
      });
    });

    it('should filter syncs by time range', async () => {
      const now = Date.now();
      const oldTimestamp = now - 10 * 24 * 60 * 60 * 1000; // 10 days ago
      const recentTimestamp = now - 1000; // 1 second ago

      const mockSyncs = [
        {
          id: 'sync-old',
          type: 'manual',
          status: 'completed',
          timestamp: oldTimestamp,
          duration: 1000
        },
        {
          id: 'sync-recent',
          type: 'manual',
          status: 'completed',
          timestamp: recentTimestamp,
          duration: 2000
        }
      ];
      // getSyncStatistics calls getRecentSyncStatuses(undefined, 100),
      // which now fans out one Query per type. Mock the manual-type
      // query to return the fixture; the rest return empty so the
      // assertion stays focused on the cutoff filter.
      for (const t of VALID_SYNC_TYPES) {
        mockSend.mockResolvedValueOnce({ Items: t === 'manual' ? mockSyncs : [] });
      }

      const stats = await service.getSyncStatistics(7); // Last 7 days

      expect(stats.totalSyncs).toBe(1);
      expect(stats.recentSyncs[0].id).toBe('sync-recent');
    });
  });

  describe('cleanupOldRecords', () => {
    // cleanupOldRecords runs getRecentSyncStatuses(undefined, 1000),
    // which now fans out one Query per VALID_SYNC_TYPES entry. Each
    // test below mocks Query results on the first call and lets the
    // remaining type-queries return empty, isolating the cleanup
    // semantics from the fan-out.
    const TYPE_QUERIES = VALID_SYNC_TYPES.length;

    // Queue Query responses in VALID_SYNC_TYPES order so the first
    // call (manual) returns the test fixture and the rest return
    // empty. mockResolvedValueOnce queues a single response, so
    // call order is the contract.
    const queueQueriesManualOnly = (manualItems: unknown[]) => {
      for (const t of VALID_SYNC_TYPES) {
        mockSend.mockResolvedValueOnce({ Items: t === 'manual' ? manualItems : [] });
      }
    };

    it('should delete old sync records using DeleteCommand', async () => {
      const now = Date.now();
      // old-newer has the more-recent timestamp; getRecentSyncStatuses
      // sorts by timestamp DESC, so it ends up first in the delete
      // loop.
      const oldRecords = [
        { id: 'old-newer', type: 'manual', timestamp: now - 35 * 24 * 60 * 60 * 1000 },
        { id: 'old-older', type: 'manual', timestamp: now - 40 * 24 * 60 * 60 * 1000 },
      ];
      queueQueriesManualOnly(oldRecords);
      mockSend.mockResolvedValue({}); // remaining deletes succeed

      const deletedCount = await service.cleanupOldRecords(30);

      expect(deletedCount).toBe(2);
      expect(mockSend).toHaveBeenCalledTimes(TYPE_QUERIES + 2);
      // setup.ts auto-mocks @aws-sdk/lib-dynamodb, so DeleteCommand
      // is a jest mock constructor — `.input` isn't preserved on the
      // instance, but the constructor's call args are captured in
      // `DeleteCommand.mock.calls` and that's what we assert against.
      const DeleteMock = DeleteCommand as unknown as jest.MockedClass<typeof DeleteCommand>;
      expect(DeleteMock.mock.calls).toHaveLength(2);
      expect(DeleteMock.mock.calls[0][0]).toEqual({
        TableName: 'test-sync-status-table',
        Key: { id: 'old-newer' },
      });
      expect(DeleteMock.mock.calls[1][0]).toEqual({
        TableName: 'test-sync-status-table',
        Key: { id: 'old-older' },
      });
    });

    it('should handle deletion errors gracefully', async () => {
      const oldRecord = { id: 'old-1', type: 'manual', timestamp: 1 };
      queueQueriesManualOnly([oldRecord]);
      mockSend.mockRejectedValue(new Error('Delete failed'));

      const deletedCount = await service.cleanupOldRecords(30);

      expect(deletedCount).toBe(0);
    });

    it('should skip recent records', async () => {
      const now = Date.now();
      const recentRecord = { id: 'recent-1', type: 'manual', timestamp: now - 1000 }; // 1 second ago
      queueQueriesManualOnly([recentRecord]);

      const deletedCount = await service.cleanupOldRecords(30);

      expect(deletedCount).toBe(0);
      expect(mockSend).toHaveBeenCalledTimes(TYPE_QUERIES); // only queries, no deletes
    });
  });
});