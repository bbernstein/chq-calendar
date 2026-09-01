/**
 * One pinned instant, shared by the browser checks that care what time it is.
 *
 * These suites run against live production data, so "today" has to stay the
 * real today — hardcode a date and every assertion about which days carry
 * events goes stale the moment the feed moves on. What is removed is only the
 * *hour*, which is the part that was making CI red at night and green in the
 * morning on the same commit.
 *
 * `14:00Z` is 10:00 EDT in season and 09:00 EST out of it. Both are
 * comfortably mid-morning — late enough that the day's programming is under
 * way, early enough that it has not run out — which is all these checks need,
 * and it buys that without offset arithmetic to get wrong twice a year.
 *
 * Lives in its own module so the suites cannot drift apart on what "now"
 * means; two copies of this rule would eventually disagree.
 */

/**
 * Mid-morning Institution time on the run's own calendar day — or on
 * `E2E_NOW`'s day, when it is set.
 *
 * `E2E_NOW` exists so the off-season regime can be exercised on any date, and
 * not only during the three weeks a year it happens by itself (#269). It
 * takes either a bare `yyyy-mm-dd`, pinned to the same mid-morning rule
 * above, or a full instant, used exactly as given. Unset — which is every CI
 * run of these three suites — behaviour is what it always was.
 */
/**
 * The mid-morning instant on a `yyyy-mm-dd` day key.
 *
 * The 14:00Z rule above, in one callable place. Exported because
 * `verify-rail`'s check 11 pins its own page to a day it derives from the
 * feed at run time, and a second copy of "mid-morning Institution time" is
 * exactly the drift this module exists to prevent.
 */
export function atMidMorning(dayKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    throw new Error(`atMidMorning: not a yyyy-mm-dd day key: ${dayKey}`);
  }
  return new Date(`${dayKey}T14:00:00Z`);
}

function resolveFixedNow() {
  const override = process.env.E2E_NOW;
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) {
    return atMidMorning(override);
  }
  if (override) {
    const parsed = new Date(override);
    // Loudly. A silently-ignored pin would run the in-season branch while the
    // log said otherwise, which is worse than not having the override.
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`E2E_NOW is not a date: ${override}`);
    }
    return parsed;
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
    .format(new Date());
  return atMidMorning(today);
}

export const FIXED_NOW = resolveFixedNow();

/**
 * Pins `page`'s clock. Call before `goto`.
 *
 * `instant` defaults to the run's shared `FIXED_NOW` and every caller but one
 * takes that default. The exception is `verify-rail`'s check 11, which needs a
 * `today` the reader can actually be parked on and derives one from the feed —
 * see the comment on that check.
 *
 * `setFixedTime`, not `install`: it pins what `Date.now()`/`new Date()` report
 * while **leaving every timer running**. The app leans on real timers — the
 * search debounce, the rail's scroll settling, `useDayAnchor`'s
 * `ResizeObserver` hold — so faking those as well would break the very
 * interactions these suites drive. (The render window's own observers were on
 * that list until #274 phase 4 deleted them.)
 */
export async function pinClock(page, instant = FIXED_NOW) {
  await page.clock.setFixedTime(instant);
}
