/** The Institution's timezone — the only clock the season turnover is defined in. */
export const CHQ_TIMEZONE = 'America/New_York';

/**
 * Which season the calendar is on at a given instant.
 *
 * Extracted from `syncDataWithLocalFile.ts` so it can be tested, because this
 * eight-line rule has now been wrong twice in one change:
 *
 * 1. It used `getFullYear()`, so it would have synced 2026 all through
 *    October while the frontend asked for `all-events-2027.json` — #286's
 *    empty calendar, three months after #286 was fixed.
 * 2. It then read the turnover on the *machine's* clock. The turnover is
 *    defined in Chautauqua time, so a contributor east of Eastern at 22:00 ET
 *    on Sep 30 is already on October 1 by their own clock and would have
 *    resolved next season while their browser asked for this one.
 *
 * The authority is `frontend/src/lib/constants.ts:getDefaultYear`, which
 * resolves through `chqParts` for the reason its own docstring gives: "so a
 * reader east of Eastern does not see next season a few hours early on
 * September 30". This is the backend port of that rule and must stay in step
 * with it.
 *
 * Deliberately *not* in step with
 * `EventsCalendarDataSyncService.getDefaultYear`, which reads the server's
 * local clock (UTC under Lambda) and so flips roughly four hours early. That
 * divergence is pre-existing and governs what the server warms, not what the
 * frontend requests; parity here is with the frontend, because this
 * function's only job is naming the file the app will ask for.
 */
export function seasonYearAt(instant: Date, timeZone: string = CHQ_TIMEZONE): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(instant);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  return month >= 10 ? year + 1 : year;
}
