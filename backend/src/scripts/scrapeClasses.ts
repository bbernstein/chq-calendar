#!/usr/bin/env ts-node
/**
 * Crawl the Special Studies catalog from tickets.chq.org and write
 * frontend/public/data/classes-<year>.json, which is where the dev server
 * looks for it.
 *
 * The catalog file doubles as the pipeline's state, so re-running against an
 * existing file exercises the same change detection the Lambda does: the
 * second run of an unchanged catalog should report published=false.
 *
 * Usage:
 *   ts-node src/scripts/scrapeClasses.ts
 *   ts-node src/scripts/scrapeClasses.ts --year=2026
 *   ts-node src/scripts/scrapeClasses.ts --mode=spots
 *   ts-node src/scripts/scrapeClasses.ts --out=/abs/path/classes.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { ClassesSearchClient } from '../services/classesSearchClient';
import { catalogForSeason } from '../services/seasonCatalog';
import {
  institutionSeasonYear,
  runClassesIngest,
  type ClassesIngestMode,
  type ClassesSink,
  type LoadedCatalog,
} from '../services/classesIngestRunner';
import type { ClassesFile } from '../types/classes';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (const raw of argv.slice(2)) {
    const m = raw.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] ?? true;
  }
  return args;
}

/** The same sink the Lambda uses, backed by a file instead of S3. */
function fileSink(out: string): ClassesSink {
  return {
    async loadCatalog(): Promise<LoadedCatalog | undefined> {
      try {
        // No version: one process writing one file has nothing to race.
        return { file: JSON.parse(readFileSync(out, 'utf8')) as ClassesFile };
      } catch {
        return undefined;
      }
    },
    async publishCatalog(_year, file): Promise<void> {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const year = Number(args.year ?? institutionSeasonYear(new Date()));
  const mode = (args.mode ?? 'full') as ClassesIngestMode;
  const out = typeof args.out === 'string'
    ? resolve(args.out)
    : resolve(__dirname, `../../../frontend/public/data/classes-${year}.json`);

  console.log(`[classes] ${mode} crawl for ${year} -> ${out}`);
  const started = Date.now();

  const summary = await runClassesIngest({
    client: new ClassesSearchClient(),
    sink: fileSink(out),
    now: new Date(),
    year,
    mode,
    catalog: catalogForSeason(year),
  });

  console.log(`[classes] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (!summary.published) {
    console.log('[classes] nothing to publish — no classes listed for this season yet');
  } else if (!summary.changed) {
    console.log('[classes] catalog unchanged; rewritten so the timestamp reflects this check');
  }
}

main().catch((err) => {
  console.error('[classes] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
