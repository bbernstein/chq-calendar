/**
 * The app shows Chautauqua's day and Chautauqua's clock regardless of where
 * the reader's device thinks it is.
 *
 * Asserted by rendering the same page under four device timezones and
 * requiring the results to be identical, rather than by hardcoding an
 * expected day — the fixture is live production data, so the only stable
 * property is agreement.
 */
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:3000/';
const ZONES = ['America/New_York', 'UTC', 'America/Los_Angeles', 'Asia/Tokyo'];

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();

async function readUnder(timezoneId) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, timezoneId });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-day-key]', { timeout: 30000 });
  const out = await page.evaluate(() => ({
    days: [...document.querySelectorAll('[data-day-key]')].map(e => e.dataset.dayKey).slice(0, 6),
    headers: [...document.querySelectorAll('[data-day-header]')].map(e => e.textContent.trim()).slice(0, 6),
    times: [...document.querySelectorAll('.event-card')].slice(0, 12)
      .map(e => (e.textContent.match(/\d{1,2}:\d{2}\s?[AP]M/) ?? [''])[0]),
    today: document.querySelector('[data-chip][aria-current="date"]')?.dataset.chip ?? null,
    nowVisible: document.querySelectorAll('.event-card').length,
  }));
  await ctx.close();
  return out;
}

const baseline = await readUnder(ZONES[0]);
check('0 baseline rendered something to compare', baseline.days.length > 0,
  `${baseline.days.length} days, first=${baseline.days[0]}`);

for (const zone of ZONES.slice(1)) {
  const got = await readUnder(zone);
  check(`1 same days under ${zone}`,
    JSON.stringify(got.days) === JSON.stringify(baseline.days),
    `${got.days[0]}..${got.days.at(-1)} vs ${baseline.days[0]}..${baseline.days.at(-1)}`);
  check(`2 same day headers under ${zone}`,
    JSON.stringify(got.headers) === JSON.stringify(baseline.headers),
    got.headers[0] ?? '(none)');
  check(`3 same event times under ${zone}`,
    JSON.stringify(got.times) === JSON.stringify(baseline.times),
    got.times.slice(0, 3).join(', '));
  check(`4 same day is today under ${zone}`,
    got.today === baseline.today, `${got.today} vs ${baseline.today}`);
  check(`5 same events are upcoming under ${zone}`,
    got.nowVisible === baseline.nowVisible, `${got.nowVisible} vs ${baseline.nowVisible}`);
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
