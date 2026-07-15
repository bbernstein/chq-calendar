/**
 * Local-only manual trigger for the Chautauquan Daily article-links pipeline.
 *
 * Runs the REAL matcher/runner (`runArticleIngest`) end-to-end against:
 *   - the REAL ChqDailyClient  → fetches chqdaily.com's WordPress REST API
 *     (read-only, public data — no writes, no auth, no production impact)
 *   - a FILE-BACKED article archive + watermark (no DynamoDB, no docker)
 *   - events read from `frontend/public/data/all-events-<year>.json` (the same
 *     file the frontend dev server serves) — NOT S3
 *   - the sidecar + private match-state written to `frontend/public/data/`
 *     (NOT S3), so `npm run dev` in the frontend immediately serves the result
 *
 * Nothing here touches AWS, S3, production DynamoDB, or the live site. After a
 * run, start the frontend dev server and expand an event card to see the links.
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/runArticleIngestLocal.ts          # current year
 *   npx ts-node src/scripts/runArticleIngestLocal.ts 2026     # explicit year
 *
 * Run it twice to watch incremental behaviour: the second run reports
 * upserted=0 and linksPublished=false when nothing changed upstream.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ChqDailyClient } from '../services/chqDailyClient';
import { runArticleIngest } from '../services/articleIngestRunner';
import type { ArticleStore } from '../services/articleStore';
import type { EventSnapshotLoader } from '../services/eventSnapshotLoader';
import type { ArticleLinksPublisher } from '../services/articleLinksPublisher';
import type {
  ArticleLinksFile,
  CalendarEventLite,
  MatchState,
  StoredArticle,
} from '../types/articles';

const DATA_DIR = path.resolve(__dirname, '../../../frontend/public/data');

function readJson<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

/**
 * File-backed stand-in for ArticleStore. Persists the article archive and
 * watermark to a gitignored dotfile so incremental behaviour works across
 * runs without DynamoDB. Same method surface the runner calls.
 */
class LocalArticleStore {
  private readonly file: string;
  private state: { watermark?: string; articles: StoredArticle[] };

  constructor(year: number) {
    this.file = path.join(DATA_DIR, `.article-archive-${year}.json`);
    this.state = readJson(this.file) ?? { articles: [] };
  }

  private flush(): void {
    writeJson(this.file, this.state);
  }

  async getWatermark(): Promise<string | undefined> {
    return this.state.watermark;
  }

  async setWatermark(iso: string): Promise<void> {
    this.state.watermark = iso;
    this.flush();
  }

  async listAllArticles(): Promise<StoredArticle[]> {
    return this.state.articles;
  }

  async upsertArticle(a: StoredArticle): Promise<void> {
    const i = this.state.articles.findIndex(x => x.wpPostId === a.wpPostId);
    if (i >= 0) this.state.articles[i] = a;
    else this.state.articles.push(a);
    this.flush();
  }
}

/** Reads the same events snapshot the frontend dev server serves, from disk. */
class LocalEventSnapshotLoader {
  constructor(private readonly year: number) {}

  async load(): Promise<CalendarEventLite[]> {
    const file = path.join(DATA_DIR, `all-events-${this.year}.json`);
    const primary = readJson<{ data?: CalendarEventLite[] }>(file);
    if (!primary) {
      throw new Error(
        `Missing ${file} — copy the season's all-events-${this.year}.json into frontend/public/data/ first.`,
      );
    }
    // Mirror the real EventSnapshotLoader: merge the optional publisher sidecar,
    // deduped by id (primary wins), so publisher-fed events also get links.
    const sidecar = readJson<{ data?: CalendarEventLite[] }>(
      path.join(DATA_DIR, `publisher-events-${this.year}.json`),
    );
    const byId = new Map<string, CalendarEventLite>();
    for (const e of [...(primary.data ?? []), ...(sidecar?.data ?? [])]) {
      if (e?.id && !byId.has(e.id)) byId.set(e.id, e);
    }
    return [...byId.values()];
  }
}

/**
 * Writes the public sidecar into the frontend dev data dir and the private
 * match-state into a gitignored dotfile (kept out of the article-links-*.json
 * glob so it never gets committed or served).
 */
class LocalArticleLinksPublisher {
  private publicKey(year: number): string {
    return path.join(DATA_DIR, `article-links-${year}.json`);
  }

  private stateKey(year: number): string {
    return path.join(DATA_DIR, `.article-links-state-${year}.json`);
  }

  async loadState(year: number): Promise<MatchState | undefined> {
    return readJson<MatchState>(this.stateKey(year));
  }

  async saveState(year: number, state: MatchState): Promise<void> {
    writeJson(this.stateKey(year), state);
  }

  async publishLinks(year: number, file: ArticleLinksFile): Promise<void> {
    writeJson(this.publicKey(year), file);
  }
}

async function main(): Promise<void> {
  const year = Number(process.argv[2]) || new Date().getFullYear();
  console.log(`\n📰 Local article-links ingest for ${year}`);
  console.log(`   data dir: ${DATA_DIR}\n`);

  const store = new LocalArticleStore(year);
  const summary = await runArticleIngest({
    client: new ChqDailyClient(),
    // Local file-backed stand-ins for the S3/DynamoDB-backed production
    // services. The runner only depends on their method surface; the casts
    // satisfy the concrete-class parameter types.
    store: store as unknown as ArticleStore,
    loader: new LocalEventSnapshotLoader(year) as unknown as EventSnapshotLoader,
    publisher: new LocalArticleLinksPublisher() as unknown as ArticleLinksPublisher,
    now: new Date(),
    year,
  });

  console.log('Summary:', JSON.stringify(summary, null, 2));

  // Print a sample of matched events with their linked article titles so you
  // can judge match quality, not just that the pipeline ran. (This is exactly
  // what the frontend renders under "In the Chautauquan Daily".)
  const sidecar = readJson<ArticleLinksFile>(
    path.join(DATA_DIR, `article-links-${year}.json`),
  );
  const links = sidecar?.links ?? {};
  const eventIds = Object.keys(links);
  console.log(`\n${eventIds.length} event(s) matched. Sample:`);
  for (const eventId of eventIds.slice(0, 8)) {
    console.log(`  event ${eventId}:`);
    for (const l of links[eventId]) {
      console.log(`    [${l.kind}] ${l.title}`);
      console.log(`            ${l.url}`);
    }
  }
  if (eventIds.length === 0) {
    console.log(
      '  (none — the Daily may have no articles dated within a few days of any event right now)',
    );
  }
  console.log(
    `\n✅ Wrote frontend/public/data/article-links-${year}.json — now run the frontend dev server to view it.\n`,
  );
}

main().catch(err => {
  console.error('\n❌ Local ingest failed:', err);
  process.exit(1);
});
