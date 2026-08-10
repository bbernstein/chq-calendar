import linksJson from '@shared/links.json';

export interface QuickLink {
  id: string;
  title: string;
  url: string;
  /** Relative path the web app opens instead of `url` (keeps local dev on localhost). */
  webPath?: string;
}

export const quickLinks: QuickLink[] = linksJson.quickLinks;
