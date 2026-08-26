import { estimatedDaySectionHeight, DAY_HEADER_ESTIMATE_PX, EVENT_CARD_ESTIMATE_PX } from '@/lib/utils/daySectionSize';

test('a day with no events is just its header', () => {
  expect(estimatedDaySectionHeight(0)).toBe(DAY_HEADER_ESTIMATE_PX);
});

test('each event adds one card', () => {
  expect(estimatedDaySectionHeight(3)).toBe(DAY_HEADER_ESTIMATE_PX + 3 * EVENT_CARD_ESTIMATE_PX);
});

test('a negative or non-finite count cannot produce a negative size', () => {
  // `contain-intrinsic-size` with a negative length is invalid and the
  // declaration is dropped whole — which silently takes `content-visibility`
  // with it, so the failure would be a performance regression with no error.
  expect(estimatedDaySectionHeight(-1)).toBe(DAY_HEADER_ESTIMATE_PX);
  expect(estimatedDaySectionHeight(Number.NaN)).toBe(DAY_HEADER_ESTIMATE_PX);
});
