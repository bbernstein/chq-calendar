import type { FetchStatus } from './publisher';

export type IngestRunTrigger = 'schedule' | 'admin' | 'publisher-fetch-now';

export interface IngestRunCounts {
  added: number;
  updated: number;
  retracted: number;
  unchanged: number;
}

export interface IngestRunRow {
  publisherId: string;
  // ISO 8601. Sort key.
  runAt: string;
  status: FetchStatus;
  // Capped at 500 chars by the writer. Optional so OK runs omit it.
  message?: string;
  // Only populated when status === 'ok'.
  counts?: IngestRunCounts;
  triggeredBy: IngestRunTrigger;
  // Unix seconds. ~90 days from runAt. Auto-expires the row.
  ttl?: number;
}
