import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { ClassesFile } from '../types/classes';
import type { LoadedCatalog } from './classesIngestRunner';

function isNoSuchKey(err: unknown): boolean {
  return (err as { name?: string })?.name === 'NoSuchKey';
}

/**
 * A conditional write refused because the object moved under us.
 *
 * S3 answers 412 to a failed `IfMatch`/`IfNoneMatch`. The SDK surfaces that
 * as `PreconditionFailed`, and a plain 412 status is checked too because the
 * error shape has varied across SDK versions.
 */
function isPreconditionFailed(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'PreconditionFailed' || e?.$metadata?.httpStatusCode === 412;
}

/**
 * Round-trips the public class catalog on the CDN bucket.
 *
 * There is no private state alongside it, unlike the program and article
 * pipelines: everything the crawl learns is published, so the catalog is
 * also the record of what the last run saw. Reading it back is needed by the
 * spots refresh anyway, which patches availability into it.
 *
 * Writes are conditional on the copy that was read. Two schedules drive this
 * one function — a daily full crawl of 258s and an hourly spots pass — and
 * both do a read, then work, then write the whole file. An hourly pass that
 * began mid-crawl would otherwise write its four-minute-old copy over the
 * crawl's finished work, silently: each run compares only against what it
 * loaded, so both believe they published a change. The precondition turns
 * that into a failed run instead of a lost one.
 *
 * The cache header is shorter than the events feed's hour. Spot counts are
 * the one number people act on immediately, and a stale one is worse than a
 * slightly chattier CDN.
 */
export class ClassesPublisher {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly prefix: string,
  ) {}

  private key(year: number): string {
    return `${this.prefix}/classes-${year}.json`;
  }

  async loadCatalog(year: number): Promise<LoadedCatalog | undefined> {
    try {
      const out = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(year) }),
      );
      return {
        file: JSON.parse(await out.Body!.transformToString()) as ClassesFile,
        version: out.ETag,
      };
    } catch (err) {
      if (isNoSuchKey(err)) return undefined;
      throw err;
    }
  }

  /**
   * Writes the catalog, but only over the copy that was read.
   *
   * `expected` is the ETag from `loadCatalog`; undefined means the object was
   * absent and must still be, so two runs racing to create a season's first
   * catalog cannot both think they won.
   */
  async publishCatalog(year: number, file: ClassesFile, expected?: string): Promise<void> {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.key(year),
          Body: JSON.stringify(file),
          ContentType: 'application/json',
          CacheControl: 'public, max-age=300',
          ...(expected ? { IfMatch: expected } : { IfNoneMatch: '*' }),
        }),
      );
    } catch (err) {
      if (!isPreconditionFailed(err)) throw err;
      // Deliberately not retried here. Redoing the write means redoing the
      // merge against the newer copy, which is the whole pass — and both
      // schedules come round again soon enough. Failing loudly is what turns
      // a silent overwrite into something a log will show.
      throw new Error(
        `[classes] ${this.key(year)} changed while this run was working — another ` +
        'ingest published first, so this result is stale and was not written',
      );
    }
  }
}
