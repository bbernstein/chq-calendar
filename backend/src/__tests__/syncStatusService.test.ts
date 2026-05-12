import { SyncStatusService, VALID_SYNC_TYPES } from '../services/syncStatusService';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

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

});