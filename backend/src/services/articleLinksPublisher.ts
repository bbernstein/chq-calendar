import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { ArticleLinksFile, MatchState } from '../types/articles';

function isNoSuchKey(err: unknown): boolean {
  return (err as { name?: string })?.name === 'NoSuchKey';
}

/**
 * Writes the public article-links sidecar (CloudFront-served, 5-min cache)
 * and round-trips the private incremental match state. Scores/reasons live
 * only in the state object, never in the public file. The state object is
 * written to a separate, non-public bucket (see `stateBucket`) — the public
 * sidecar bucket serves world-readable GetObject, so match state must not
 * live there.
 */
export class ArticleLinksPublisher {
  private readonly stateBucket: string;

  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly publicPrefix: string,
    private readonly statePrefix: string,
    stateBucket?: string,
  ) {
    this.stateBucket = stateBucket ?? bucket;
  }

  private publicKey(year: number): string {
    return `${this.publicPrefix}/article-links-${year}.json`;
  }

  private stateKey(year: number): string {
    return `${this.statePrefix}/article-links-state-${year}.json`;
  }

  async loadState(year: number): Promise<MatchState | undefined> {
    try {
      const out = await this.s3.send(
        new GetObjectCommand({ Bucket: this.stateBucket, Key: this.stateKey(year) }),
      );
      return JSON.parse(await out.Body!.transformToString()) as MatchState;
    } catch (err) {
      if (isNoSuchKey(err)) return undefined;
      throw err;
    }
  }

  async saveState(year: number, state: MatchState): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.stateBucket,
        Key: this.stateKey(year),
        Body: JSON.stringify(state),
        ContentType: 'application/json',
      }),
    );
  }

  async publishLinks(year: number, file: ArticleLinksFile): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.publicKey(year),
        Body: JSON.stringify(file),
        ContentType: 'application/json',
        CacheControl: 'public, max-age=300',
      }),
    );
  }
}
