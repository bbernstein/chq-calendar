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
function resolveFixedNow() {
  const override = process.env.E2E_NOW;
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) {
    return new Date(`${override}T14:00:00Z`);
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
  return new Date(`${today}T14:00:00Z`);
}

export const FIXED_NOW = resolveFixedNow();

/**
 * Pins `page`'s clock. Call before `goto`.
 *
 * `setFixedTime`, not `install`: it pins what `Date.now()`/`new Date()` report
 * while **leaving every timer running**. The app leans on real timers — the
 * search debounce, the rail's scroll settling, `useDayAnchor`'s
 * `ResizeObserver` hold — so faking those as well would break the very
 * interactions these suites drive. (The render window's own observers were on
 * that list until #274 phase 4 deleted them.)
 */
export async function pinClock(page) {
  await page.clock.setFixedTime(FIXED_NOW);
}
