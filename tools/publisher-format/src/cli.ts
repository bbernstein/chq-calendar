#!/usr/bin/env node
import * as fs from 'fs';
import { extractFromHtml } from './extractFromHtml';
import { validateFeed } from './validateFeed';
import type { ValidationReport } from './types';

async function loadInput(arg: string): Promise<{ body: string; isHtml: boolean }> {
  if (/^https?:\/\//.test(arg)) {
    const res = await fetch(arg);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${arg}`);
    const ct = res.headers.get('content-type') ?? '';
    const body = await res.text();
    return { body, isHtml: ct.includes('html') || /^\s*</.test(body) };
  }
  const body = fs.readFileSync(arg, 'utf8');
  return { body, isHtml: arg.endsWith('.html') || /^\s*</.test(body) };
}

function printReport(r: ValidationReport): void {
  if (r.ok) {
    console.log(`OK  — feed validated successfully (${r.feed?.events.length ?? 0} events)`);
  } else {
    console.error(`FAIL — ${r.errors.length} error(s)`);
  }
  for (const e of r.errors) console.error(`  ERROR  ${e.path}  [${e.code ?? '-'}]  ${e.message}`);
  for (const w of r.warnings) console.warn(`  WARN   ${w.path}  [${w.code ?? '-'}]  ${w.message}`);
}

export async function runCli(argv: string[]): Promise<number> {
  const arg = argv[0];
  if (!arg) {
    console.error('Usage: chq-validate-feed <path-or-url>');
    return 2;
  }
  let body: string;
  let isHtml: boolean;
  try {
    ({ body, isHtml } = await loadInput(arg));
  } catch (e) {
    console.error(`Could not read "${arg}": ${(e as Error).message}`);
    return 1;
  }
  let report: ValidationReport;
  if (isHtml) {
    const ex = extractFromHtml(body);
    if (ex.errors.length > 0 || !ex.feed) {
      report = { ok: false, errors: ex.errors, warnings: [] };
    } else {
      report = validateFeed(ex.feed);
    }
  } else {
    let parsed: unknown;
    try { parsed = JSON.parse(body); }
    catch (e) {
      console.error(`Could not parse JSON: ${(e as Error).message}`);
      return 1;
    }
    try {
      report = validateFeed(parsed);
    } catch (e) {
      console.error(`Validation failed: ${(e as Error).message}`);
      return 1;
    }
  }
  printReport(report);
  return report.ok ? 0 : 1;
}

if (require.main === module) {
  runCli(process.argv.slice(2)).then(code => process.exit(code));
}
