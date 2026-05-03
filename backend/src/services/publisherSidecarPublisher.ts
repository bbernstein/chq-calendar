import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { VenueReference } from '@chq-calendar/publisher-format';
import type { StoredPublisherEvent } from '../types/publisher';

const SIDECAR_KEY_PATTERN = /\/publisher-events-(\d{4})\.json$/;

export class PublisherSidecarPublisher {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly keyPrefix: string,
    /**
     * Optional venue lookup. When provided, payloads with a `venueId` get a
     * resolved `location` (and `venue.name`/`venue.address`) added so the
     * frontend's location filter and EventCard rendering work without
     * publisher-aware code paths. Publisher-supplied `location` and `venue`
     * fields are merged with the lookup, never overwritten.
     */
    private readonly venuesById: Map<string, VenueReference> = new Map(),
  ) {}

  async publish(events: StoredPublisherEvent[]): Promise<void> {
    const published = events.filter(e => e.state === 'published');
    const byYear = new Map<number, StoredPublisherEvent[]>();
    for (const e of published) {
      const y = Number(e.startDate.slice(0, 4));
      if (!Number.isFinite(y)) continue;
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y)!.push(e);
    }

    const existingYears = await this.listExistingSidecarYears();

    for (const [year, group] of byYear) {
      const body = JSON.stringify({ data: group.map(g => this.enrichPayload(g.payload)) });
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

  private enrichPayload(
    payload: StoredPublisherEvent['payload'],
  ): StoredPublisherEvent['payload'] & { location?: string; categories?: Array<{ name: string }> } {
    const enriched: StoredPublisherEvent['payload'] & {
      location?: string;
      categories?: Array<{ name: string }>;
    } = { ...payload };

    // Resolve venueId → location + venue when a lookup entry exists.
    const venueId = payload.venueId;
    if (venueId) {
      const venue = this.venuesById.get(venueId);
      if (venue) {
        if (typeof enriched.location !== 'string' || enriched.location.length === 0) {
          enriched.location = venue.name;
        }
        // Merge venue rather than replace — preserves publisher-supplied url
        // and any future fields on VenueRef.
        enriched.venue = {
          ...(enriched.venue ?? {}),
          name: enriched.venue?.name ?? venue.name,
          ...(venue.address && !enriched.venue?.address ? { address: venue.address } : {}),
        };
      }
    }

    // Promote singular `category` (string) to a `categories` array. The
    // frontend's tag-filter pre-computation, clickable category badges
    // in EventCard, and search-tag set all read `event.categories`.
    // Without this, publisher events were absent from category filters
    // and rendered without category badges in the expanded card.
    const existingCategories = (enriched as { categories?: unknown }).categories;
    if (
      typeof payload.category === 'string' &&
      payload.category.length > 0 &&
      (!Array.isArray(existingCategories) || existingCategories.length === 0)
    ) {
      enriched.categories = [{ name: payload.category }];
    }

    return enriched;
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
