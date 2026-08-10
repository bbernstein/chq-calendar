import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { ProgramLinksFile, ProgramMatchState } from '../types/programs';

function isNoSuchKey(err: unknown): boolean {
  return (err as { name?: string })?.name === 'NoSuchKey';
}

/**
 * Writes the public program-links sidecar (CloudFront-served, 5-min cache)
 * and round-trips the private match state. Scores/reasons live only in the
 * state object, which goes to the private cache bucket — never the public
 * frontend bucket. Mirrors ArticleLinksPublisher.
 */
export class ProgramLinksPublisher {
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
    return `${this.publicPrefix}/program-links-${year}.json`;
  }

  private stateKey(year: number): string {
    return `${this.statePrefix}/program-links-state-${year}.json`;
  }

  async loadState(year: number): Promise<ProgramMatchState | undefined> {
    try {
      const out = await this.s3.send(
        new GetObjectCommand({ Bucket: this.stateBucket, Key: this.stateKey(year) }),
      );
      return JSON.parse(await out.Body!.transformToString()) as ProgramMatchState;
    } catch (err) {
      if (isNoSuchKey(err)) return undefined;
      throw err;
    }
  }

  async saveState(year: number, state: ProgramMatchState): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.stateBucket,
        Key: this.stateKey(year),
        Body: JSON.stringify(state),
        ContentType: 'application/json',
      }),
    );
  }

  async publishLinks(year: number, file: ProgramLinksFile): Promise<void> {
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
