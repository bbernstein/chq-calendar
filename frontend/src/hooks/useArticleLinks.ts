import { useSidecarLinks, __resetSidecarLinksCacheForTests } from './useSidecarLinks';

export type ArticleLinkKind = 'preview' | 'recap';

export interface ArticleLink {
  title: string;
  url: string;
  kind: ArticleLinkKind;
  /** YYYY-MM-DD publication date on chqdaily.com. */
  pubDate: string;
}

export interface UseArticleLinksResult {
  /** eventId → linked Daily articles (previews first, then recaps). */
  links: Record<string, ArticleLink[]>;
  loading: boolean;
}

export function useArticleLinks(year: number): UseArticleLinksResult {
  return useSidecarLinks<ArticleLink>('article-links', year);
}

/**
 * Test-only: clear the module-level cache so each test starts fresh.
 * (Shared with all sidecar-links hooks.)
 */
export function __resetArticleLinksCacheForTests(): void {
  __resetSidecarLinksCacheForTests();
}
