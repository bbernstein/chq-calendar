#!/usr/bin/env ts-node
/**
 * Scrape the chq.org weekly themes page for a given year and write
 * frontend/public/data/weekly-themes/<year>.json.
 *
 * Usage:
 *   ts-node src/scripts/scrapeWeeklyThemes.ts --year=2026
 *   ts-node src/scripts/scrapeWeeklyThemes.ts --year=2026 --dry-run
 *   ts-node src/scripts/scrapeWeeklyThemes.ts --year=2026 --out=/abs/path/2026.json
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import axios from 'axios';
import { parseWeeklyThemes, validateWeeklyThemes } from '../services/weeklyThemesScraper';

const SOURCE_URL = 'https://www.chq.org/things-to-do/events/weekly-themes/';

interface CliArgs {
  year: number;
  out: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string | boolean> = {};
  for (const raw of argv.slice(2)) {
    const m = raw.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    args[m[1]] = m[2] ?? true;
  }
  const yearStr = (args.year as string) || String(new Date().getUTCFullYear());
  const year = parseInt(yearStr, 10);
  if (!year || year < 2000 || year > 2100) {
    throw new Error(`--year=<YYYY> is required (got "${yearStr}")`);
  }
  const dryRun = args['dry-run'] === true || args.dryRun === true;
  // Default output is relative to the repo root: backend/.. → frontend/public/...
  const defaultOut = resolve(__dirname, `../../../frontend/public/data/weekly-themes/${year}.json`);
  const out = (args.out as string) || defaultOut;
  return { year, out, dryRun };
}

async function fetchHtml(url: string): Promise<string> {
  const res = await axios.get<string>(url, {
    responseType: 'text',
    headers: { 'User-Agent': 'chq-calendar-weekly-themes-scraper/1.0' },
    timeout: 30000,
    transformResponse: [(d) => d],
  });
  return res.data;
}

async function main() {
  const { year, out, dryRun } = parseArgs(process.argv);

  const html = await fetchHtml(SOURCE_URL);
  const weeks = parseWeeklyThemes(html, year);
  validateWeeklyThemes(weeks, year);

  const payload = {
    year,
    scrapedAt: new Date().toISOString(),
    source: SOURCE_URL,
    weeks,
  };
  const json = JSON.stringify(payload, null, 2) + '\n';

  if (dryRun) {
    process.stdout.write(json);
    return;
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, json);
  process.stderr.write(`Wrote ${weeks.length} weeks for ${year} to ${out}\n`);
}

main().catch((err) => {
  process.stderr.write(`scrape-weekly-themes failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
