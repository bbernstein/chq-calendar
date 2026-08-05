/** One digital program book scraped from audienceaccess.co/CHQ. */
export interface Program {
  /** "CHQ-16781" — numeric part is assigned chronologically by the platform. */
  showId: string;
  /** Canonical program URL, e.g. https://audienceaccess.co/show/CHQ-16781 */
  url: string;
  title: string;
  /** Raw date text from the listing (may be a byline or blurb, not a date). */
  dateText: string;
  /** YYYY-MM-DD parsed from dateText, or null when dateText isn't a date. */
  startDate: string | null;
  /** YYYY-MM-DD; equals startDate for single-date programs. */
  endDate: string | null;
  source: 'upcoming' | 'past';
}

/** One entry in the published sidecar. */
export interface PublishedProgramLink {
  title: string;
  url: string;
}

/** Shape of cache/calendar-cache/program-links-<year>.json. */
export interface ProgramLinksFile {
  generatedAt: string;
  matcherVersion: number;
  links: Record<string, PublishedProgramLink[]>;
}

/** One above-threshold (program, event) match kept in private state. */
export interface ProgramMatchRecord {
  eventId: string;
  showId: string;
  score: number;
  reasons: string[];
}

/**
 * Private S3 state. With full recompute each run this exists for debugging
 * (scores/reasons) and change detection, not incremental skipping.
 */
export interface ProgramMatchState {
  matcherVersion: number;
  /** showId -> hash of title|dateText|url */
  programs: Record<string, string>;
  /** eventId -> hash of title|startDate */
  eventFingerprints: Record<string, string>;
  matches: ProgramMatchRecord[];
}
