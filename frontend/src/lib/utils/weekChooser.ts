/**
 * The week chooser's shape and its keyboard walk.
 *
 * Pure on purpose, the same split the band uses: *which cells exist and where a
 * key goes* is decided here and unit-tested; *where they land in pixels* is
 * `WeekGrid`'s problem and the browser pass's.
 */

/**
 * Columns in the chooser grid.
 *
 * Nine 44px cells in a row is 396px, wider than a 390px phone; nine in a 3x3 is
 * a 132px square with real touch targets. That is the whole argument, and it is
 * a straight win over a 1x9 strip independent of what the trigger looks like.
 *
 * Derived from the count rather than fixed at 3, so a hypothetical non-nine
 * season degrades to an odd-shaped grid rather than dropping weeks. Nine is
 * structural on both platforms today (`getChautauquaSeasonWeeks` loops nine
 * times; `SeasonCalendar.weeks` "always returns nine"), which is exactly why
 * a literal 9 here would never be caught being wrong.
 */
export function weekGridColumns(count: number): number {
  if (count <= 0) return 1;
  return Math.ceil(Math.sqrt(count));
}

/** The weeks, wrapped into rows in order. A short final row stays short. */
export function weekGridRows(weekNumbers: number[], columns: number): number[][] {
  const width = Math.max(1, columns);
  const rows: number[][] = [];
  for (let i = 0; i < weekNumbers.length; i += width) {
    rows.push(weekNumbers.slice(i, i + width));
  }
  return rows;
}

/**
 * Where a key takes focus, as an index into the flat week list, or `null` when
 * it takes it nowhere.
 *
 * `null` covers three cases the caller treats identically — an unhandled key, a
 * move off the edge, and a move that lands where focus already is — because all
 * three mean "do not `preventDefault`, do not move". Swallowing Escape, Tab or
 * Enter here is how a popover traps focus, so keys this function does not know
 * must fall through untouched.
 *
 * Clamping, not wrapping: the rail's chip walk clamps, and wrapping from week 9
 * to week 1 on one keystroke is a jump across the whole season disguised as a
 * nudge.
 */
export function moveGridFocus(
  current: number, key: string, count: number, columns: number
): number | null {
  if (count <= 0 || current < 0 || current >= count) return null;
  const width = Math.max(1, columns);
  let next: number;
  switch (key) {
    case 'ArrowRight': next = current + 1; break;
    case 'ArrowLeft': next = current - 1; break;
    case 'ArrowDown': next = current + width; break;
    case 'ArrowUp': next = current - width; break;
    case 'Home': next = 0; break;
    case 'End': next = count - 1; break;
    default: return null;
  }
  if (next < 0 || next >= count || next === current) return null;
  return next;
}

/**
 * The trigger's accessible name, and its `title` for sighted mouse users.
 *
 * "Week 6 of 9" gives position in the season in words for a reader who cannot
 * see the lit cell give it spatially. On touch there is no tooltip, but the
 * first tap opens a grid of numbered weeks, which self-explains.
 */
export function weekChooserTriggerLabel(
  currentWeek: number | null, totalWeeks: number
): string {
  if (currentWeek === null) return 'Choose a week';
  return `Week ${currentWeek} of ${totalWeeks}, choose a week`;
}
