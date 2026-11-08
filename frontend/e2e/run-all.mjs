/**
 * Run every browser-check suite, one after another, and report ALL of them.
 *
 * `test:browser` used to be the six suites joined with `&&`. That stops at the
 * first suite to exit non-zero, and twice now it hid most of a failure:
 *
 *  - #299 (2026-08-31, the season's sparse tail): CI showed 2 red checks in
 *    `verify-rail`; there were 18, the other 16 in three suites that never ran.
 *  - 2026-11-07 (the 2027 rollover): `verify-rail` failed check 12 and then
 *    crashed in check 18, and the five suites after it — including
 *    `verify-header-reveal` and `verify-full-list`, both also red — never ran.
 *
 * A chain answers "did everything pass", which is the one question nobody
 * debugging a red build needs answered. This answers "what failed".
 *
 * Sequential, never parallel: the suites share one preview server and measure
 * timing and scroll geometry, and two Playwright suites at once contend for
 * CPU and produce failures that belong to neither.
 *
 * Each suite inherits this process's environment (`URL`, `E2E_NOW`,
 * `E2E_ENGINE`) and its stdio, so its own output is exactly what it was under
 * the chain. Exits non-zero if any suite exited non-zero or was killed.
 *
 * Usage: `node e2e/run-all.mjs [suite ...]` — with no arguments, all six, in
 * the order the chain ran them.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  'verify-rail',
  'verify-filter-reveal',
  'verify-timezone',
  'verify-offseason',
  'verify-header-reveal',
  'verify-full-list',
];

const requested = process.argv.slice(2).map(s => s.replace(/\.mjs$/, ''));
const unknown = requested.filter(s => !SUITES.includes(s));
if (unknown.length) {
  console.error(`run-all: unknown suite(s) ${unknown.join(', ')}; known: ${SUITES.join(', ')}`);
  process.exit(2);
}
const suites = requested.length ? requested : SUITES;

const results = [];
for (const suite of suites) {
  console.log(`\n=== ${suite} ${'='.repeat(Math.max(0, 66 - suite.length))}`);
  const started = Date.now();
  const run = spawnSync(process.execPath, [join(here, `${suite}.mjs`)], {
    stdio: 'inherit',
    env: process.env,
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  // `status` is null when the child was killed by a signal; that is a
  // failure, and it must not be reported as exit 0.
  const ok = run.status === 0;
  const how = run.error ? `could not start: ${run.error.message}`
    : run.status === null ? `killed by ${run.signal}`
    : `exit ${run.status}`;
  results.push({ suite, ok, how, seconds });
}

console.log('\n=== browser checks summary ' + '='.repeat(42));
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.suite.padEnd(22)} ${r.how.padEnd(10)} ${r.seconds}s`);
}
const failed = results.filter(r => !r.ok);
console.log(failed.length
  ? `\n${failed.length} of ${results.length} suites failed: ${failed.map(f => f.suite).join(', ')}`
  : `\nall ${results.length} suites passed`);
// `exitCode`, not `exit()`: an immediate exit straight after `console.log`
// can truncate the summary when stdout is a pipe (macOS), and the summary is
// the whole point. Nothing is left running, so Node exits on its own.
process.exitCode = failed.length ? 1 : 0;
