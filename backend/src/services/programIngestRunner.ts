import type { CalendarEventLite } from '../types/articles';
import type { Program, ProgramLinksFile, ProgramMatchState } from '../types/programs';
import { computeProgramMatchState, MATCHER_VERSION } from './programMatcher';

/** Structural deps so the local script can substitute file-backed stand-ins. */
export interface ProgramsSource {
  fetchPrograms(): Promise<Program[]>;
}
export interface ProgramEventsSource {
  load(year: number): Promise<CalendarEventLite[]>;
}
export interface ProgramLinksSink {
  loadState(year: number): Promise<ProgramMatchState | undefined>;
  saveState(year: number, state: ProgramMatchState): Promise<void>;
  publishLinks(year: number, file: ProgramLinksFile): Promise<void>;
}

export interface ProgramIngestDeps {
  client: ProgramsSource;
  loader: ProgramEventsSource;
  publisher: ProgramLinksSink;
  now: Date;
  year: number;
}

export interface ProgramIngestSummary {
  programs: number;
  dated: number;
  undated: number;
  eventsTotal: number;
  matchedEvents: number;
  linksPublished: boolean;
}

/**
 * One ingest cycle: full scrape → full re-match → publish when the link set
 * changed. A zero-program scrape aborts loudly instead of publishing — the
 * previously published sidecar stays live through markup drift or outages.
 */
export async function runProgramIngest(deps: ProgramIngestDeps): Promise<ProgramIngestSummary> {
  const { client, loader, publisher, now, year } = deps;

  const programs = await client.fetchPrograms();
  if (programs.length === 0) {
    throw new Error(
      '[program-ingest] scraped zero programs — refusing to publish (markup drift or fetch failure?)',
    );
  }
  const events = await loader.load(year);
  const prevState = await publisher.loadState(year);
  const { state, links, linksChanged, stateChanged } = computeProgramMatchState({
    programs, events, year, prevState,
  });

  if (linksChanged) {
    await publisher.publishLinks(year, {
      generatedAt: now.toISOString(),
      matcherVersion: MATCHER_VERSION,
      links,
    });
  }
  if (stateChanged) {
    await publisher.saveState(year, state);
  }

  const summary: ProgramIngestSummary = {
    programs: programs.length,
    dated: programs.filter(p => p.startDate != null).length,
    undated: programs.filter(p => p.startDate == null).length,
    eventsTotal: events.length,
    matchedEvents: Object.keys(links).length,
    linksPublished: linksChanged,
  };
  console.log('[program-ingest] summary:', JSON.stringify(summary));
  return summary;
}
