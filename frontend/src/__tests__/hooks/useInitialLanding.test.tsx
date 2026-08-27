import { renderHook } from '@testing-library/preact';
import { useInitialLanding } from '@/hooks/useInitialLanding';

function mountDay(key: string) {
  const el = document.createElement('div');
  el.setAttribute('data-day-key', key);
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.scrollY = 0;
});

test('scrolls to the target once the day has a section', () => {
  mountDay('2026-07-04');
  const scrollToDay = vi.fn();
  renderHook(() => useInitialLanding({ targetDay: '2026-07-04', year: 2026, listMounted: true, scrollToDay }));
  expect(scrollToDay).toHaveBeenCalledExactlyOnceWith('2026-07-04');
});

test('does not scroll again on a later render of the same year', () => {
  mountDay('2026-07-04');
  const scrollToDay = vi.fn();
  const { rerender } = renderHook(
    ({ target }) => useInitialLanding({ targetDay: target, year: 2026, listMounted: true, scrollToDay }),
    { initialProps: { target: '2026-07-04' } }
  );
  // A background feed refresh moves the landing day. The reader is already
  // looking at the list; nothing may move them.
  rerender({ target: '2026-07-05' });
  expect(scrollToDay).toHaveBeenCalledTimes(1);
});

// The test above happens to be masked: '2026-07-05' has no mounted section
// either, so `!daySectionElement(targetDay)` alone would already block the
// re-fire even with the once-per-year ref deleted entirely. This mounts BOTH
// days, so the only thing standing between the new target and a second
// `scrollToDay` call is the `landedFor` ref itself.
test('the once-per-year guard holds even when the new target has a mounted section', () => {
  mountDay('2026-07-04');
  mountDay('2026-07-05');
  const scrollToDay = vi.fn();
  const { rerender } = renderHook(
    ({ target }) => useInitialLanding({ targetDay: target, year: 2026, listMounted: true, scrollToDay }),
    { initialProps: { target: '2026-07-04' } }
  );
  rerender({ target: '2026-07-05' });
  expect(scrollToDay).toHaveBeenCalledTimes(1);
  expect(scrollToDay).toHaveBeenCalledWith('2026-07-04');
});

test('scrolls again when the year changes', () => {
  mountDay('2026-07-04');
  mountDay('2025-07-04');
  const scrollToDay = vi.fn();
  const { rerender } = renderHook(
    ({ target, year }) => useInitialLanding({ targetDay: target, year, listMounted: true, scrollToDay }),
    { initialProps: { target: '2026-07-04', year: 2026 } }
  );
  rerender({ target: '2025-07-04', year: 2025 });
  expect(scrollToDay).toHaveBeenCalledTimes(2);
  expect(scrollToDay).toHaveBeenLastCalledWith('2025-07-04');
});

// These two replace a single test that asserted "does not move a reader who
// has already scrolled" by setting `window.scrollY = 4200`. That test encoded
// a real defect: `history.scrollRestoration` defaults to `auto`, so Safari
// restores an offset from a previous visit, the hook read it as deliberate,
// and an iPhone reader was left on January 3 with today eight months down the
// page — on an app whose primary job is to show what is happening today.
//
// A scroll OFFSET is not intent. A gesture is.
test('a restored scroll offset does not suppress the landing', () => {
  mountDay('2026-07-04');
  window.scrollY = 4200;
  const scrollToDay = vi.fn();
  renderHook(() => useInitialLanding({ targetDay: '2026-07-04', year: 2026, listMounted: true, scrollToDay }));
  expect(scrollToDay).toHaveBeenCalledExactlyOnceWith('2026-07-04');
});

test('a reader gesture before the list arrives does suppress it', () => {
  mountDay('2026-07-04');
  const scrollToDay = vi.fn();
  // Mounted with no list yet, so the hook is listening but has not landed.
  const { rerender } = renderHook(
    ({ listMounted }) => useInitialLanding({ targetDay: '2026-07-04', year: 2026, listMounted, scrollToDay }),
    { initialProps: { listMounted: false } }
  );
  // The reader starts reading before the year finishes arriving. Teleporting
  // them to today at that point would yank the page out from under a
  // deliberate movement.
  window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }));
  rerender({ listMounted: true });
  expect(scrollToDay).not.toHaveBeenCalled();
});

test('sets scrollRestoration to manual, and puts it back on unmount', () => {
  // The browser cannot restore usefully here: the document is ~160,000px once
  // the year mounts and a fraction of that while it is still arriving, so a
  // restored offset is applied against the wrong height.
  history.scrollRestoration = 'auto';
  const { unmount } = renderHook(() =>
    useInitialLanding({ targetDay: null, year: 2026, listMounted: false, scrollToDay: () => {} }));
  expect(history.scrollRestoration).toBe('manual');
  unmount();
  expect(history.scrollRestoration).toBe('auto');
});

test('lands when the list appears later, not only on the first render', () => {
  const scrollToDay = vi.fn();
  const { rerender } = renderHook(
    ({ listMounted }) => useInitialLanding({ targetDay: '2026-07-04', year: 2026, listMounted, scrollToDay }),
    { initialProps: { listMounted: false } }
  );
  expect(scrollToDay).not.toHaveBeenCalled();

  // The off-season landing was on screen and the reader pressed "Browse this
  // season". The list mounts now, and the reader must arrive at the right day.
  mountDay('2026-07-04');
  rerender({ listMounted: true });
  expect(scrollToDay).toHaveBeenCalledExactlyOnceWith('2026-07-04');
});

test('a null target scrolls nowhere', () => {
  const scrollToDay = vi.fn();
  renderHook(() => useInitialLanding({ targetDay: null, year: 2026, listMounted: true, scrollToDay }));
  expect(scrollToDay).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Task 6 fix round 1. Two independently reachable bugs the review found: a
// rail tap's explicit target got silently swallowed by guards written for
// the automatic landing (`explicit` fixes this — named in fix round 2 for
// what it tells the two guards below, not for what it does to them: it was
// called `force` in round 1, and "bypasses two of the three guards" is a
// comment `force` needed and `explicit` does not), and a year switch
// inherited a stale, nonzero `window.scrollY` from the OLD year's document
// and never landed on the new one (the `landedFor.current === null` scoping
// fixes this). See the hook's own doc comment for the mechanism.
// ---------------------------------------------------------------------------

test('explicit bypasses the once-per-year latch', () => {
  mountDay('2026-07-04');
  mountDay('2026-07-05');
  const scrollToDay = vi.fn();
  const { rerender } = renderHook(
    ({ target, explicit }) => useInitialLanding({ targetDay: target, year: 2026, listMounted: true, scrollToDay, explicit }),
    { initialProps: { target: '2026-07-04', explicit: false } }
  );
  expect(scrollToDay).toHaveBeenCalledExactlyOnceWith('2026-07-04');

  // Filters toggled on, list mounted, the automatic landing consumed its
  // once-per-year latch on '2026-07-04' — then a rail tap on a DIFFERENT
  // day, an explicit request, must still land.
  rerender({ target: '2026-07-05', explicit: true });
  expect(scrollToDay).toHaveBeenCalledTimes(2);
  expect(scrollToDay).toHaveBeenLastCalledWith('2026-07-05');
});

test('explicit bypasses the "reader already scrolled" guard', () => {
  mountDay('2026-07-06');
  window.scrollY = 9001;
  const scrollToDay = vi.fn();
  renderHook(() => useInitialLanding({
    targetDay: '2026-07-06', year: 2026, listMounted: true, scrollToDay, explicit: true,
  }));
  expect(scrollToDay).toHaveBeenCalledExactlyOnceWith('2026-07-06');
});

// Task 6 fix round 2: this test's title and its trailing comment previously
// said "unforced" and asserted the opposite of what the body actually
// proves. The body was always correct — `explicit: true` below — it is the
// title and comment that were wrong.
test('an explicit request still waits for the section to exist — explicit is not a bypass of every guard', () => {
  const scrollToDay = vi.fn();
  renderHook(() => useInitialLanding({
    targetDay: '2026-07-09', year: 2026, listMounted: true, scrollToDay, explicit: true,
  }));
  // No section was ever mounted for this key — `explicit` bypasses the
  // once-per-year and already-scrolled guards, not the "does the target
  // exist at all" one.
  expect(scrollToDay).not.toHaveBeenCalled();
});

test('a year switch lands on the new year even from a scroll position left over from the previous one', () => {
  mountDay('2026-07-04');
  mountDay('2025-07-04');
  const scrollToDay = vi.fn();
  const { rerender } = renderHook(
    ({ target, year }) => useInitialLanding({ targetDay: target, year, listMounted: true, scrollToDay }),
    { initialProps: { target: '2026-07-04', year: 2026 } }
  );
  expect(scrollToDay).toHaveBeenCalledExactlyOnceWith('2026-07-04');

  // The reader scrolled deep into 2026's list, then picked 2025 from the
  // header. Nothing resets `window.scrollY` on a year switch, so this large,
  // stale offset is exactly what a real one leaves behind.
  window.scrollY = 30000;
  rerender({ target: '2025-07-04', year: 2025 });

  expect(scrollToDay).toHaveBeenCalledTimes(2);
  expect(scrollToDay).toHaveBeenLastCalledWith('2025-07-04');
});
