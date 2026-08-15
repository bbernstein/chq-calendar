import linksJson from '@shared/links.json';

export interface QuickLink {
  id: string;
  title: string;
  url: string;
  /** Relative path the web app opens instead of `url` (keeps local dev on localhost). */
  webPath?: string;
  /**
   * True for destinations that leave this app — the Chautauqua Institution
   * sites. The header collapses these into a single menu instead of
   * rendering them as peers of the app's own routes. Declared explicitly
   * rather than inferred from a missing `webPath`, which would make the
   * grouping an accident of how local development happens to be wired.
   */
  external?: boolean;
}

export const quickLinks: QuickLink[] = linksJson.quickLinks;

/** Routes within this app (Guide, Feedback) — shown as direct header controls. */
export const inAppLinks: QuickLink[] = quickLinks.filter((link) => !link.external);

/** Off-site Chautauqua destinations — collapsed into the header's menu. */
export const externalLinks: QuickLink[] = quickLinks.filter((link) => link.external);
