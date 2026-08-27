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
// points straight at the reset effect and nothing else.
test('a year change resets both browsingArchive and a pending, unresolved target', () => {
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
