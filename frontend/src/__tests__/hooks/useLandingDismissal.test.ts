import { renderHook, act } from '@testing-library/preact';
import { useLandingDismissal } from '@/hooks/useLandingDismissal';

test('dismissForDay sets both the target and browsingArchive; clearDismissedTarget consumes only the target', () => {
  const { result } = renderHook(() => useLandingDismissal(2026));
  expect(result.current.browsingArchive).toBe(false);
  expect(result.current.dismissedLandingTarget).toBeNull();

  act(() => { result.current.dismissForDay('2026-07-06'); });
  expect(result.current.browsingArchive).toBe(true);
  expect(result.current.dismissedLandingTarget).toBe('2026-07-06');

  act(() => { result.current.clearDismissedTarget(); });
  expect(result.current.dismissedLandingTarget).toBeNull();
  // Consuming the target does not also un-dismiss the landing — a resolved
  // rail tap must not bring the landing back over the list it just scrolled.
  expect(result.current.browsingArchive).toBe(true);
});

// The direct, minimal counterpart to `landingDismissalYearReset.test.tsx`'s
// full composition test: this one exercises `useLandingDismissal` on its
// own, with no `useInitialLanding`/Harness involved, so a failure here
// points straight at the reset and nothing else.
//
// "Both" is two mechanisms now, not one effect: the target is reset by the
// `[year]` effect, while `browsingArchive` is derived from the year the
// dismissal was recorded for (#186). The observable rule is unchanged and
// this test is unchanged with it.
test('a year change clears both browsingArchive and a pending, unresolved target', () => {
  const { result, rerender } = renderHook(
    ({ year }) => useLandingDismissal(year),
    { initialProps: { year: 2026 } }
  );

  act(() => { result.current.dismissForDay('2026-07-06'); });
  expect(result.current.browsingArchive).toBe(true);
  expect(result.current.dismissedLandingTarget).toBe('2026-07-06');

  // The target was never cleared (as it would be by `page.tsx`'s
  // `clearDismissedTarget` once a real scroll resolves) — modelling the
  // "target's section never mounts" case (`⟳ Now` on a dark day).
  rerender({ year: 2025 });

  expect(result.current.browsingArchive).toBe(false);
  expect(result.current.dismissedLandingTarget).toBeNull();
});

// #186's web half, at the unit level. The pre-season archive button dismisses
// the landing FOR A YEAR THE READER IS NOT ON: `page.tsx` calls
// `setSelectedYear(2025)` and `browseArchiveSeason(2025)` together, so the
// hook sees the dismissal and the year change in either order and must end up
// dismissed either way.
//
// Sequenced as dismissal-then-year-change here, which is the order the old
// boolean-plus-reset-effect implementation got wrong: it recorded the
// dismissal, then watched `year` move and immediately undid it, dropping the
// reader on the archive year's own landing instead of its list.
test('a dismissal made FOR another year survives the switch to that year', () => {
  const { result, rerender } = renderHook(
    ({ year }) => useLandingDismissal(year),
    { initialProps: { year: 2026 } }
  );

  // Pre-season on 2026, offering 2025 — the year on the button's label.
  act(() => { result.current.browseArchiveSeason(2025); });
  // Not yet: the reader is still looking at 2026, whose landing was never
  // dismissed. This half matters as much as the next one — a dismissal that
  // applied to the year on screen would flash 2026's list before switching.
  expect(result.current.browsingArchive).toBe(false);

  rerender({ year: 2025 });
  expect(result.current.browsingArchive).toBe(true);

  // And it is still scoped: a third year is a different question again.
  rerender({ year: 2024 });
  expect(result.current.browsingArchive).toBe(false);

  // Coming back is the accepted behaviour change this branch ships: the
  // dismissal is held AS the year it was made for, so leaving 2025 does not
  // consume it. Returning lands on 2025's list, not on 2025's landing again.
  rerender({ year: 2025 });
  expect(result.current.browsingArchive).toBe(true);
});
