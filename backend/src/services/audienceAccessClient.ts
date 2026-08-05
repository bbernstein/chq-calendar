import * as cheerio from 'cheerio';
import type { Program } from '../types/programs';
import { parseProgramDateText } from './programDates';

const DEFAULT_BASE_URL = 'https://audienceaccess.co';
const USER_AGENT = 'chqcal.org program-linker (https://www.chqcal.org)';
const REQUEST_TIMEOUT_MS = 10_000;
const SHOW_ID_RE = /\/show\/(CHQ-\d+)/;

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

function buildProgram(
  href: string | undefined,
  title: string,
  dateText: string,
  source: Program['source'],
): Program | null {
  const showId = href ? SHOW_ID_RE.exec(href)?.[1] : undefined;
  if (!showId || !title) return null;
  const parsed = parseProgramDateText(dateText);
  return {
    showId,
    url: `${DEFAULT_BASE_URL}/show/${showId}`,
    title,
    dateText,
    startDate: parsed?.startDate ?? null,
    endDate: parsed?.endDate ?? null,
    source,
  };
}

/** Parses the upcoming-events page (carousel of `.slide` blocks). */
export function parseUpcomingPage(html: string): Program[] {
  const $ = cheerio.load(html);
  const out: Program[] = [];
  $('.slide').each((_, el) => {
    const slide = $(el);
    const program = buildProgram(
      slide.find('a[href*="/show/CHQ-"]').first().attr('href'),
      collapse(slide.find('.mobile-index-footer-show-name').first().text()),
      collapse(slide.find('.mobile-index-footer-show-date').first().text()),
      'upcoming',
    );
    if (program) out.push(program);
  });
  return out;
}

/** Parses the past-events page (grid of `.mobile-past-events-feature-box`). */
export function parsePastPage(html: string): Program[] {
  const $ = cheerio.load(html);
  const out: Program[] = [];
  $('.mobile-past-events-feature-box').each((_, el) => {
    const box = $(el);
    const program = buildProgram(
      box.find('a[href*="/show/CHQ-"]').first().attr('href'),
      collapse(box.find('.mobile-past-events-feature-title').first().text()),
      collapse(box.find('.mobile-past-events-feature-dates').first().text()),
      'past',
    );
    if (program) out.push(program);
  });
  return out;
}

/**
 * Read-only scraper for the audienceaccess.co digital-program listings.
 * Two requests per run; throws on any non-2xx so the caller aborts the run
 * (and keeps the previously published sidecar) instead of publishing from
 * a partial scrape.
 */
export class AudienceAccessClient {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  private async getHtml(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await this.fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`audienceaccess request failed: ${res.status} ${url}`);
      }
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchPrograms(): Promise<Program[]> {
    const upcomingHtml = await this.getHtml(`${this.baseUrl}/CHQ`);
    const pastHtml = await this.getHtml(`${this.baseUrl}/past/CHQ`);
    const pastPrograms = parsePastPage(pastHtml);
    if (pastPrograms.length === 0) {
      throw new Error(
        '[audienceaccess] past page parsed to zero programs — refusing to publish (markup drift?)',
      );
    }
    const byId = new Map<string, Program>();
    for (const p of pastPrograms) byId.set(p.showId, p);
    for (const p of parseUpcomingPage(upcomingHtml)) byId.set(p.showId, p);
    return [...byId.values()];
  }
}
