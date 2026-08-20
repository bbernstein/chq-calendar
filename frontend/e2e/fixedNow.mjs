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

/** Mid-morning Institution time on the run's own calendar day. */
export const FIXED_NOW = new Date(
  `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())}T14:00:00Z`
);

/**
 * Pins `page`'s clock. Call before `goto`.
 *
 * `setFixedTime`, not `install`: it pins what `Date.now()`/`new Date()` report
 * while **leaving every timer running**. The app leans on real timers — the
 * search debounce, the render window's observers, the rail's scroll settling —
 * so faking those as well would break the very interactions these suites
 * drive.
 */
export async function pinClock(page) {
  await page.clock.setFixedTime(FIXED_NOW);
}
