/**
 * One tally, shared by every browser-check suite.
 *
 * The three suites each held their own copy of `check()` and the closing
 * `N/M checks passed` block. They agreed by accident rather than by
 * construction, and the skip rule below is exactly the kind of thing three
 * copies eventually disagree about.
 */
const results = [];

/**
 * Record a check. `detail` is the measured value, and is worth printing.
 *
 * Tested for `!= null` rather than for truthiness: a measurement of `0` is
 * meaningful — often the most meaningful thing a check can report — and a
 * truthy test drops it silently. No current call site passes one, but this is
 * the utility every suite depends on to explain itself, and a diagnostic that
 * quietly omits its own evidence is the failure mode this whole PR is about.
 */
export function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail != null ? ` — ${detail}` : ''}`);
}

/**
 * Record a check that has no subject in this regime.
 *
 * `reason` is required and always printed. A silent skip reports success for
 * work that did not happen, which is the failure mode #269 is about: three
 * weeks a year of a gate that looks green while testing nothing.
 */
export function skip(name, reason) {
  if (!reason) throw new Error(`skip("${name}") needs a reason`);
  results.push({ name, skipped: true, detail: reason });
  console.log(`SKIP  ${name} — ${reason}`);
}

/**
 * Print the summary and exit.
 *
 * Exits non-zero when any check failed, and ALSO when no check passed — a
 * suite that skipped everything, or ran nothing at all, has proved nothing
 * and must not report success.
 *
 * Stated as "no check passed" rather than as a skip-to-pass ratio on purpose:
 * a ratio would false-fail the smaller suites (`verify-timezone` has around a
 * dozen checks) on a legitimate two-skip off-season run.
 */
export function finish() {
  const failed = results.filter(r => !r.skipped && !r.ok);
  const passed = results.filter(r => !r.skipped && r.ok);
  const skipped = results.filter(r => r.skipped);

  console.log(
    `\n${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`
  );
  if (skipped.length) {
    console.log('SKIPPED:\n' + skipped.map(s => `  - ${s.name}: ${s.detail}`).join('\n'));
  }
  if (failed.length) {
    console.log('FAILED:\n' + failed.map(f => `  - ${f.name}: ${f.detail ?? ''}`).join('\n'));
  }

  if (failed.length || passed.length === 0) {
    if (passed.length === 0) console.log('No check passed — nothing was proved.');
    process.exit(1);
  }
}
