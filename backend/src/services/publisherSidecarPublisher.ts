import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { StoredPublisherEvent } from '../types/publisher';

const SIDECAR_KEY_PATTERN = /\/publisher-events-(\d{4})\.json$/;

export class PublisherSidecarPublisher {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly keyPrefix: string,
  ) {}

  async publish(events: StoredPublisherEvent[]): Promise<void> {
    const published = events.filter(e => e.state === 'published');
    const byYear = new Map<number, StoredPublisherEvent[]>();
    for (const e of published) {
      const y = Number(e.startDate.slice(0, 4));
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y)!.push(e);
    }

    const existingYears = await this.listExistingSidecarYears();

    for (const [year, group] of byYear) {
      const body = JSON.stringify({ data: group.map(g => g.payload) });
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.keyForYear(year),
        Body: body,
        ContentType: 'application/json',
        CacheControl: 'public, max-age=300',
      }));
    }

    for (const year of existingYears) {
      if (!byYear.has(year)) {
        await this.s3.send(new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: this.keyForYear(year),
        }));
      }
    }
  }

  private keyForYear(year: number): string {
    return `${this.keyPrefix}/publisher-events-${year}.json`;
  }

  private async listExistingSidecarYears(): Promise<Set<number>> {
    const years = new Set<number>();
    let token: string | undefined;
    do {
      const r = await this.s3.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `${this.keyPrefix}/publisher-events-`,
        ContinuationToken: token,
      }));
      for (const obj of r.Contents ?? []) {
        if (!obj.Key) continue;
        const m = obj.Key.match(SIDECAR_KEY_PATTERN);
        if (m) years.add(Number(m[1]));
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return years;
  }
}
