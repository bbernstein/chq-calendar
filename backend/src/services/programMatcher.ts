import { createHash } from 'crypto';
import { normalize } from './textNormalize';
import type { CalendarEventLite } from '../types/articles';
import type {
  Program,
  ProgramMatchRecord,
  ProgramMatchState,
  PublishedProgramLink,
} from '../types/programs';

/** Bump to force a full republish (matcher rule changes). */
export const MATCHER_VERSION = 1;
/** Dated programs: title Jaccard floor (date gate already passed). */
export const TITLE_THRESHOLD = 0.6;
/** Undated programs: stricter Jaccard floor (no date evidence). */
export const UNDATED_TITLE_THRESHOLD = 0.8;
/** Containment only counts when the shorter normalized title is this long. */
export const MIN_CONTAINMENT_LENGTH = 10;
const CONTAINMENT_SCORE = 0.9;

const sha16 = (s: string): string =>
  createHash('sha256').update(s).digest('hex').slice(0, 16);

export const computeProgramContentHash = (p: Program): string =>
  sha16(`${p.title}|${p.dateText}`);

export const computeEventFingerprint = (e: CalendarEventLite): string =>
  sha16(`${e.title}|${e.startDate}`);

/** "CHQ-16530" → 16530. IDs are assigned chronologically by the platform. */
export const showIdNum = (showId: string): number =>
  Number(showId.replace(/\D/g, ''));

/** Works for both "2026-08-04T14:00:00" and "2026-08-04 14:00:00". */
const eventDay = (startDate: string): string => startDate.slice(0, 10);

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface TitleScore {
  score: number;
  reasons: string[];
}

export function scoreTitles(programTitle: string, eventTitle: string): TitleScore {
  const np = normalize(programTitle);
  const ne = normalize(eventTitle);
  if (!np || !ne) return { score: 0, reasons: [] };
  const j = jaccard(new Set(np.split(' ')), new Set(ne.split(' ')));
  const shorter = np.length <= ne.length ? np : ne;
  const contained =
    shorter.length >= MIN_CONTAINMENT_LENGTH && (np.includes(ne) || ne.includes(np));
  const score = Math.round(Math.max(j, contained ? CONTAINMENT_SCORE : 0) * 10000) / 10000;
  const reasons = [`title-jaccard:${j.toFixed(2)}`];
  if (contained) reasons.push('title-containment');
  return { score, reasons };
}

/**
 * Scores one (program, event) pair, or null when the pair is ineligible.
 * `minUndatedShowId` is the season fence for undated programs: the smallest
 * numeric show ID among programs dated in the target year, or null when no
 * program is dated in-year (then no undated program is eligible at all).
 */
export function scorePair(
  program: Program,
  event: CalendarEventLite,
  minUndatedShowId: number | null,
): TitleScore | null {
  if (program.startDate && program.endDate) {
    const day = eventDay(event.startDate);
    if (day < program.startDate || day > program.endDate) return null;
    const t = scoreTitles(program.title, event.title);
    if (t.score < TITLE_THRESHOLD) return null;
    return { score: t.score, reasons: ['date-window', ...t.reasons] };
  }
  if (minUndatedShowId == null || showIdNum(program.showId) < minUndatedShowId) return null;
  const t = scoreTitles(program.title, event.title);
  if (!t.reasons.includes('title-containment') && t.score < UNDATED_TITLE_THRESHOLD) {
    return null;
  }
  return { score: t.score, reasons: ['undated', ...t.reasons] };
}

export interface ComputeProgramInput {
  programs: Program[];
  events: CalendarEventLite[];
  year: number;
  prevState?: ProgramMatchState;
}

export interface ComputeProgramResult {
  state: ProgramMatchState;
  links: Record<string, PublishedProgramLink[]>;
  linksChanged: boolean;
  stateChanged: boolean;
}

/** Canonical match identity for republish decisions — scores excluded. */
const canonicalMatches = (ms: ProgramMatchRecord[]): string =>
  ms.map(m => `${m.eventId}:${m.showId}`).sort().join(',');

export function computeProgramMatchState({
  programs,
  events,
  year,
  prevState,
}: ComputeProgramInput): ComputeProgramResult {
  const datedInYear = programs.filter(p => p.startDate?.startsWith(`${year}`));
  const minUndatedShowId = datedInYear.length
    ? Math.min(...datedInYear.map(p => showIdNum(p.showId)))
    : null;
  const byId = new Map(programs.map(p => [p.showId, p]));

  const matches: ProgramMatchRecord[] = [];
  for (const event of events) {
    let best: ProgramMatchRecord | undefined;
    for (const program of programs) {
      const scored = scorePair(program, event, minUndatedShowId);
      if (!scored) continue;
      const better =
        !best ||
        scored.score > best.score ||
        (scored.score === best.score && showIdNum(program.showId) > showIdNum(best.showId));
      if (better) {
        best = {
          eventId: event.id,
          showId: program.showId,
          score: scored.score,
          reasons: scored.reasons,
        };
      }
    }
    if (best) matches.push(best);
  }
  matches.sort((a, b) => a.eventId.localeCompare(b.eventId));

  const links: Record<string, PublishedProgramLink[]> = {};
  for (const m of matches) {
    const p = byId.get(m.showId)!;
    links[m.eventId] = [{ title: p.title, url: p.url }];
  }

  const state: ProgramMatchState = {
    matcherVersion: MATCHER_VERSION,
    programs: Object.fromEntries(
      [...programs]
        .sort((a, b) => showIdNum(a.showId) - showIdNum(b.showId))
        .map(p => [p.showId, computeProgramContentHash(p)]),
    ),
    eventFingerprints: Object.fromEntries(
      [...events]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(e => [e.id, computeEventFingerprint(e)]),
    ),
    matches,
  };

  const linksChanged =
    prevState == null ||
    prevState.matcherVersion !== MATCHER_VERSION ||
    canonicalMatches(prevState.matches) !== canonicalMatches(matches);
  const stateChanged =
    prevState == null || JSON.stringify(prevState) !== JSON.stringify(state);

  return { state, links, linksChanged, stateChanged };
}
