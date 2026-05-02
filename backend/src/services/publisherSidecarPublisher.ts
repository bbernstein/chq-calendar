import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { StoredPublisherEvent } from '../types/publisher';

export class PublisherSidecarPublisher {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly keyPrefix: string,
  ) {}

  async publish(events: StoredPublisherEvent[]): Promise<void> {
    const published = events.filter(e => e.state === 'published');
    if (published.length === 0) return;
    const byYear = new Map<number, StoredPublisherEvent[]>();
    for (const e of published) {
      const y = Number(e.startDate.slice(0, 4));
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y)!.push(e);
    }
    for (const [year, group] of byYear) {
      const body = JSON.stringify({ data: group.map(g => g.payload) });
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: `${this.keyPrefix}/publisher-events-${year}.json`,
        Body: body,
        ContentType: 'application/json',
        CacheControl: 'public, max-age=300',
      }));
    }
  }
}
