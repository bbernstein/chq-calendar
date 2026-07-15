import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { CalendarEventLite } from '../types/articles';

function isNoSuchKey(err: unknown): boolean {
  return (err as { name?: string })?.name === 'NoSuchKey';
}

/**
 * Loads the full event snapshot the matcher runs against: the primary
 * all-events file plus the optional publisher sidecar, deduped by id
 * (primary wins). Missing primary is fatal — a run without events would
 * wrongly blank the published links.
 */
export class EventSnapshotLoader {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly keyPrefix: string,
  ) {}

  private async getJson(key: string): Promise<{ data?: CalendarEventLite[] }> {
    const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return JSON.parse(await out.Body!.transformToString()) as { data?: CalendarEventLite[] };
  }

  async load(year: number): Promise<CalendarEventLite[]> {
    const primary = await this.getJson(`${this.keyPrefix}/all-events-${year}.json`);
    let sidecar: { data?: CalendarEventLite[] } = {};
    try {
      sidecar = await this.getJson(`${this.keyPrefix}/publisher-events-${year}.json`);
    } catch (err) {
      if (!isNoSuchKey(err)) throw err;
    }
    const byId = new Map<string, CalendarEventLite>();
    for (const e of [...(primary.data ?? []), ...(sidecar.data ?? [])]) {
      if (e?.id && !byId.has(e.id)) byId.set(e.id, e);
    }
    return [...byId.values()];
  }
}
