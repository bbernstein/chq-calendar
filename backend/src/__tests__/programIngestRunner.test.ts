import type { CalendarEventLite } from '../types/articles';
import type { Program, ProgramLinksFile, ProgramMatchState } from '../types/programs';
import { runProgramIngest } from '../services/programIngestRunner';

const program: Program = {
  showId: 'CHQ-16530',
  url: 'https://audienceaccess.co/show/CHQ-16530',
  title: 'School of Music: Open Recital #6',
  dateText: 'August 04, 2026',
  startDate: '2026-08-04',
  endDate: '2026-08-04',
  source: 'upcoming',
};
const event: CalendarEventLite = {
  id: 'ev-1',
  title: 'School of Music: Open Recital',
  startDate: '2026-08-04 14:00:00',
};

function makeDeps(over?: {
  programs?: Program[];
  prevState?: ProgramMatchState;
}) {
  const published: ProgramLinksFile[] = [];
  const savedStates: ProgramMatchState[] = [];
  return {
    deps: {
      client: { fetchPrograms: async () => over?.programs ?? [program] },
      loader: { load: async (_year: number) => [event] },
      publisher: {
        loadState: async () => over?.prevState,
        saveState: async (_y: number, s: ProgramMatchState) => { savedStates.push(s); },
        publishLinks: async (_y: number, f: ProgramLinksFile) => { published.push(f); },
      },
      now: new Date('2026-08-05T12:00:00Z'),
      year: 2026,
    },
    published,
    savedStates,
  };
}

describe('runProgramIngest', () => {
  it('publishes links and state on first run', async () => {
    const { deps, published, savedStates } = makeDeps();
    const summary = await runProgramIngest(deps);
    expect(published).toHaveLength(1);
    expect(published[0].links['ev-1']).toEqual([
      { title: program.title, url: program.url },
    ]);
    expect(savedStates).toHaveLength(1);
    expect(summary).toMatchObject({
      programs: 1, dated: 1, undated: 0, eventsTotal: 1,
      matchedEvents: 1, linksPublished: true,
    });
  });

  it('skips publish when nothing changed since prevState', async () => {
    const first = makeDeps();
    await runProgramIngest(first.deps);
    const second = makeDeps({ prevState: first.savedStates[0] });
    const summary = await runProgramIngest(second.deps);
    expect(second.published).toHaveLength(0);
    expect(second.savedStates).toHaveLength(0);
    expect(summary.linksPublished).toBe(false);
  });

  it('aborts without publishing when the scrape returns zero programs', async () => {
    const { deps, published, savedStates } = makeDeps({ programs: [] });
    await expect(runProgramIngest(deps)).rejects.toThrow('zero programs');
    expect(published).toHaveLength(0);
    expect(savedStates).toHaveLength(0);
  });
});
