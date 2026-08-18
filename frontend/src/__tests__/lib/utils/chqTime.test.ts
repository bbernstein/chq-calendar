import { describe, it, expect } from 'vitest';
import {
  CHQ_ZONE, chqParts, chqDayKey, chqDateAt, parseEventDate,
  formatChqTime, formatChqDayLabel,
} from '@/lib/utils/chqTime';
import { startOfDay, dayAfter, windowContains } from '@/lib/utils/dayWindow';

describe('CHQ_ZONE', () => {
  it('is the Institution zone, never a fixed offset', () => {
    expect(CHQ_ZONE).toBe('America/New_York');
  });
});

describe('chqParts', () => {
  it('reads calendar fields in Institution time, not the device zone', () => {
    // 2026-07-27T03:45:00Z is 23:45 on 2026-07-26 at Chautauqua (EDT, -4).
    const p = chqParts(new Date('2026-07-27T03:45:00Z'));
    expect(p).toMatchObject({ year: 2026, month: 7, day: 26, hour: 23, minute: 45 });
  });

  it('reads winter instants in EST', () => {
    // 2026-01-15T18:30:00Z is 13:30 EST (-5).
    const p = chqParts(new Date('2026-01-15T18:30:00Z'));
    expect(p).toMatchObject({ year: 2026, month: 1, day: 15, hour: 13, minute: 30 });
  });

  it('reports midnight as hour 0, never 24', () => {
    // 2026-07-27T04:00:00Z is exactly midnight EDT.
    expect(chqParts(new Date('2026-07-27T04:00:00Z')).hour).toBe(0);
  });
});

describe('chqDayKey', () => {
  it('gives the Institution calendar day of an instant', () => {
    expect(chqDayKey(new Date('2026-07-27T03:45:00Z'))).toBe('2026-07-26');
    expect(chqDayKey(new Date('2026-07-27T16:45:00Z'))).toBe('2026-07-27');
  });

  it('zero-pads to yyyy-mm-dd', () => {
    expect(chqDayKey(new Date('2026-01-05T17:00:00Z'))).toBe('2026-01-05');
  });
});

describe('chqDateAt', () => {
  it('builds an instant from Institution wall time in summer', () => {
    // Noon EDT on 2026-07-27 is 16:00Z.
    expect(chqDateAt(2026, 7, 27, 12).toISOString()).toBe('2026-07-27T16:00:00.000Z');
  });

  it('builds an instant from Institution wall time in winter', () => {
    // Noon EST on 2026-01-15 is 17:00Z.
    expect(chqDateAt(2026, 1, 15, 12).toISOString()).toBe('2026-01-15T17:00:00.000Z');
  });

  it('round-trips through chqParts across the spring DST transition', () => {
    // 2026-03-08: 02:00 does not exist; 03:00 EDT is 07:00Z.
    const d = chqDateAt(2026, 3, 8, 3);
    expect(chqParts(d)).toMatchObject({ year: 2026, month: 3, day: 8, hour: 3 });
  });

  it('round-trips through chqParts across the autumn DST transition', () => {
    // 2026-11-01: 01:00 occurs twice. Either instant must read back as 01:00.
    const d = chqDateAt(2026, 11, 1, 1);
    expect(chqParts(d)).toMatchObject({ year: 2026, month: 11, day: 1, hour: 1 });
  });

  it('round-trips every hour of both DST transition days', () => {
    for (const [mo, day] of [[3, 8], [11, 1]] as const) {
      for (let h = 0; h < 24; h++) {
        const p = chqParts(chqDateAt(2026, mo, day, h));
        // The spring-forward hour 02:00 does not exist; it normalises to 03:00.
        const expected = mo === 3 && h === 2 ? 3 : h;
        expect({ h, got: p.hour }).toEqual({ h, got: expected });
      }
    }
  });
});

describe('parseEventDate', () => {
  it('reads the feed\'s space-separated form as Institution wall time', () => {
    expect(parseEventDate('2026-07-27 12:45:00').toISOString()).toBe('2026-07-27T16:45:00.000Z');
  });

  it('reads the T-separated form the publisher feeds use', () => {
    expect(parseEventDate('2026-07-27T12:45:00').toISOString()).toBe('2026-07-27T16:45:00.000Z');
  });

  it('reads a winter date in EST', () => {
    expect(parseEventDate('2026-01-15 12:00:00').toISOString()).toBe('2026-01-15T17:00:00.000Z');
  });

  it('tolerates a missing seconds field', () => {
    expect(parseEventDate('2026-07-27 12:45').toISOString()).toBe('2026-07-27T16:45:00.000Z');
  });

  it('returns an Invalid Date for an unparseable string', () => {
    // groupEventsByDay relies on this to emit its NaN-NaN-NaN key.
    expect(Number.isNaN(parseEventDate('not a date').getTime())).toBe(true);
  });

  it('honours an explicit Z rather than re-reading it as Institution time', () => {
    expect(parseEventDate('2026-07-27T12:45:00Z').toISOString()).toBe('2026-07-27T12:45:00.000Z');
  });

  it('honours an explicit offset', () => {
    expect(parseEventDate('2026-07-27T12:45:00+09:00').toISOString()).toBe('2026-07-27T03:45:00.000Z');
  });

  it('still reads the feed\'s naive form as Institution wall time', () => {
    expect(parseEventDate('2026-07-27 12:45:00').toISOString()).toBe('2026-07-27T16:45:00.000Z');
  });

  it('reads a date-only string as Institution midnight of that day', () => {
    expect(parseEventDate('2026-07-27').toISOString()).toBe('2026-07-27T04:00:00.000Z');
  });

  it('keeps a date-only event visible in a window covering that day', () => {
    const d = parseEventDate('2026-07-27');
    const window = {
      startDay: '2026-07-27', endDay: '2026-07-27',
      start: startOfDay('2026-07-27'), endExclusive: dayAfter('2026-07-27'),
    };
    expect(windowContains(window, d)).toBe(true);
  });

  it('falls through to the naive path on a malformed offset rather than throwing', () => {
    // `+25:99` passes the trailing-offset shape check but is not a value
    // `Date` can parse, so the offset parse silently fails and the string is
    // re-read as naive Institution wall time, ignoring the bad suffix. This
    // is documented behaviour, not a validated design — pinned here so a
    // future change to the fallthrough is a deliberate decision.
    expect(parseEventDate('2026-07-27T12:45:00+25:99').toISOString())
      .toBe('2026-07-27T16:45:00.000Z');
  });
});

describe('formatChqTime', () => {
  it('renders Institution wall time, unlabelled', () => {
    expect(formatChqTime(new Date('2026-07-27T23:00:00Z'))).toBe('7:00 PM');
  });

  it('carries no timezone suffix', () => {
    expect(formatChqTime(new Date('2026-07-27T23:00:00Z'))).not.toMatch(/ET|EDT|EST|GMT|UTC/);
  });
});

describe('formatChqDayLabel', () => {
  it('names the Institution day, not the device day', () => {
    // 03:45Z is still the 26th at Chautauqua.
    expect(formatChqDayLabel(new Date('2026-07-27T03:45:00Z')))
      .toBe('Sunday, July 26, 2026');
  });
});

describe('unparseable dates degrade rather than throw', () => {
  const bad = parseEventDate('not a date');

  it('yields NaN parts instead of throwing', () => {
    expect(() => chqParts(bad)).not.toThrow();
    expect(Number.isNaN(chqParts(bad).year)).toBe(true);
  });

  it('produces the documented NaN-NaN-NaN day key', () => {
    expect(chqDayKey(bad)).toBe('NaN-NaN-NaN');
  });

  it('formats as Invalid Date rather than throwing', () => {
    expect(formatChqTime(bad)).toBe('Invalid Date');
    expect(formatChqDayLabel(bad)).toBe('Invalid Date');
  });
});
