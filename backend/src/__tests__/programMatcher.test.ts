import type { CalendarEventLite } from '../types/articles';
import type { Program, ProgramMatchState } from '../types/programs';
import {
  MATCHER_VERSION,
  computeProgramMatchState,
  scorePair,
  scoreTitles,
  showIdNum,
} from '../services/programMatcher';

const program = (over: Partial<Program>): Program => ({
  showId: 'CHQ-16530',
  url: 'https://audienceaccess.co/show/CHQ-16530',
  title: 'School of Music: Open Recital #6',
  dateText: 'August 04, 2026',
  startDate: '2026-08-04',
  endDate: '2026-08-04',
  source: 'upcoming',
  ...over,
});

const event = (over: Partial<CalendarEventLite>): CalendarEventLite => ({
  id: 'ev-1',
  title: 'School of Music: Open Recital',
  startDate: '2026-08-04 14:00:00',
  ...over,
});

describe('showIdNum', () => {
  it('extracts the numeric part', () => {
    expect(showIdNum('CHQ-16530')).toBe(16530);
  });
});

describe('scoreTitles', () => {
  it('scores near-identical titles high', () => {
    const { score } = scoreTitles(
      'School of Music: Open Recital #6',
      'School of Music: Open Recital',
    );
    expect(score).toBeGreaterThanOrEqual(0.8);
  });

  it('passes the Recital-vs-Concert real pair at the dated threshold', () => {
    const { score } = scoreTitles(
      'School of Music: Double Bass Recital',
      'School of Music: Double Bass Concert',
    );
    expect(score).toBeGreaterThanOrEqual(0.6);
    expect(score).toBeLessThan(0.8);
  });

  it('detects containment for short program titles inside long event titles', () => {
    const { score, reasons } = scoreTitles(
      'Best For Baby',
      'Chautauqua Theater Company Presents Best for Baby (Pick-Your-Price)',
    );
    expect(reasons).toContain('title-containment');
    expect(score).toBeGreaterThanOrEqual(0.8);
  });

  it('does not count containment for very short titles', () => {
    const { reasons } = scoreTitles('Gala', 'An Evening Gala With Friends');
    expect(reasons).not.toContain('title-containment');
  });

  it('scores unrelated titles low', () => {
    const { score } = scoreTitles(
      'Chautauqua Symphony Orchestra: Beethoven',
      'Morning Devotional Hour',
    );
    expect(score).toBeLessThan(0.2);
  });
});

describe('scorePair', () => {
  it('gates dated programs on the event day', () => {
    expect(scorePair(program({}), event({ startDate: '2026-08-05 14:00:00' }), null)).toBeNull();
    expect(scorePair(program({}), event({}), null)).not.toBeNull();
  });

  it('accepts events anywhere inside a date range', () => {
    const run = program({
      showId: 'CHQ-16571',
      title: 'Chautauqua Opera Conservatory: La Calisto',
      dateText: 'July 18 - 21, 2026',
      startDate: '2026-07-18',
      endDate: '2026-07-21',
    });
    const performance = event({
      title: 'Chautauqua Opera Conservatory: La Calisto',
      startDate: '2026-07-20 19:30:00',
    });
    expect(scorePair(run, performance, null)).not.toBeNull();
  });

  it('rejects undated programs below the show-ID fence', () => {
    const old = program({
      showId: 'CHQ-9999',
      title: 'Best For Baby',
      dateText: 'by Sharyn Rothstein',
      startDate: null,
      endDate: null,
    });
    const perf = event({ title: 'Chautauqua Theater Company Presents Best for Baby' });
    expect(scorePair(old, perf, 16000)).toBeNull();
    expect(scorePair({ ...old, showId: 'CHQ-16426' }, perf, 16000)).not.toBeNull();
  });

  it('rejects every undated program when no fence exists', () => {
    const undated = program({ startDate: null, endDate: null });
    expect(scorePair(undated, event({}), null)).toBeNull();
  });

  it('holds undated programs to the stricter title bar', () => {
    const undated = program({
      showId: 'CHQ-16800',
      title: 'School of Music: Double Bass Recital',
      dateText: 'tba',
      startDate: null,
      endDate: null,
    });
    // Jaccard ≈ 0.71: enough when dated, not enough when undated.
    expect(
      scorePair(undated, event({ title: 'School of Music: Double Bass Concert' }), 16000),
    ).toBeNull();
  });
});

describe('computeProgramMatchState', () => {
  const programs: Program[] = [
    program({}), // dated Aug 04, CHQ-16530
    program({
      // A second dated-in-2026 program with a LOWER id, so the undated fence
      // (min dated id = 16300) sits below CHQ-16426. Without it the fence
      // would wrongly exclude the Best For Baby program from this data set.
      showId: 'CHQ-16300',
      url: 'https://audienceaccess.co/show/CHQ-16300',
      title: 'Chautauqua Opera Conservatory: La Calisto',
      dateText: 'July 18 - 21, 2026',
      startDate: '2026-07-18',
      endDate: '2026-07-21',
      source: 'past',
    }),
    program({
      showId: 'CHQ-16426',
      url: 'https://audienceaccess.co/show/CHQ-16426',
      title: 'Best For Baby',
      dateText: 'by Sharyn Rothstein',
      startDate: null,
      endDate: null,
      source: 'past',
    }),
    program({
      showId: 'CHQ-9999',
      url: 'https://audienceaccess.co/show/CHQ-9999',
      title: 'Best For Baby',
      dateText: 'an old staging',
      startDate: null,
      endDate: null,
      source: 'past',
    }),
  ];
  const events: CalendarEventLite[] = [
    event({}), // matches the recital by date+title
    event({
      id: 'ev-2',
      title: 'Chautauqua Theater Company Presents Best for Baby',
      startDate: '2026-07-19 19:30:00',
    }),
    event({
      id: 'ev-3',
      title: 'Chautauqua Theater Company Presents Best for Baby (Pick-Your-Price)',
      startDate: '2026-07-18 17:00:00',
    }),
    event({ id: 'ev-4', title: 'Morning Devotional Hour', startDate: '2026-08-04 09:15:00' }),
  ];

  it('links a recurring undated program to every performance, one link per event', () => {
    const { links } = computeProgramMatchState({ programs, events, year: 2026 });
    expect(links['ev-2']).toEqual([
      { title: 'Best For Baby', url: 'https://audienceaccess.co/show/CHQ-16426' },
    ]);
    expect(links['ev-3']).toHaveLength(1);
    expect(links['ev-4']).toBeUndefined(); // no confident match → no link
    expect(links['ev-1']).toEqual([
      { title: 'School of Music: Open Recital #6', url: 'https://audienceaccess.co/show/CHQ-16530' },
    ]);
  });

  it('excludes the pre-season duplicate via the fence (CHQ-9999 never linked)', () => {
    const { state } = computeProgramMatchState({ programs, events, year: 2026 });
    expect(state.matches.every(m => m.showId !== 'CHQ-9999')).toBe(true);
  });

  it('reports linksChanged=false for an identical previous state', () => {
    const first = computeProgramMatchState({ programs, events, year: 2026 });
    const second = computeProgramMatchState({
      programs, events, year: 2026, prevState: first.state,
    });
    expect(second.linksChanged).toBe(false);
    expect(second.stateChanged).toBe(false);
  });

  it('forces republish on matcher version bump', () => {
    const first = computeProgramMatchState({ programs, events, year: 2026 });
    const stale: ProgramMatchState = { ...first.state, matcherVersion: MATCHER_VERSION - 1 };
    const second = computeProgramMatchState({
      programs, events, year: 2026, prevState: stale,
    });
    expect(second.linksChanged).toBe(true);
  });

  it('score-only drift does not republish', () => {
    const first = computeProgramMatchState({ programs, events, year: 2026 });
    const drifted: ProgramMatchState = {
      ...first.state,
      matches: first.state.matches.map(m => ({ ...m, score: m.score + 0.01 })),
    };
    const second = computeProgramMatchState({
      programs, events, year: 2026, prevState: drifted,
    });
    expect(second.linksChanged).toBe(false);
    expect(second.stateChanged).toBe(true); // state file still refreshes
  });

  it('republishes when a matched program title changes, same showId/dates', () => {
    const first = computeProgramMatchState({ programs, events, year: 2026 });
    const retitled = programs.map(p =>
      p.showId === 'CHQ-16530' ? { ...p, title: 'School of Music: Open Recital #6 (Revised)' } : p,
    );
    const second = computeProgramMatchState({
      programs: retitled, events, year: 2026, prevState: first.state,
    });
    expect(second.linksChanged).toBe(true);
    expect(second.links['ev-1']).toEqual([
      {
        title: 'School of Music: Open Recital #6 (Revised)',
        url: 'https://audienceaccess.co/show/CHQ-16530',
      },
    ]);
  });
});
