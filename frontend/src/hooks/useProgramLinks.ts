import { useSidecarLinks, __resetSidecarLinksCacheForTests } from './useSidecarLinks';

/** One digital program link from program-links-<year>.json. */
export interface ProgramLink {
  title: string;
  url: string;
}

export interface UseProgramLinksResult {
  /** eventId → digital program link (at most one per event). */
  links: Record<string, ProgramLink[]>;
  loading: boolean;
}

export function useProgramLinks(year: number): UseProgramLinksResult {
  return useSidecarLinks<ProgramLink>('program-links', year);
}

/**
 * Test-only: clear the module-level cache so each test starts fresh.
 * (Shared with all sidecar-links hooks.)
 */
export function __resetProgramLinksCacheForTests(): void {
  __resetSidecarLinksCacheForTests();
}
