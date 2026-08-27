import { useState, useRef } from 'react';
import { memo } from 'preact/compat';
import type { Event } from '@/lib/types';
import type { ArticleLink } from '@/hooks/useArticleLinks';
import type { ProgramLink } from '@/hooks/useProgramLinks';
import { getCategoryDisplayName } from '@/lib/constants';
import { isDesktop } from '@/lib/utils/calendarUrls';
import { formatChqTime, parseEventDate } from '@/lib/utils/chqTime';
import { CalendarPopup } from './CalendarPopup';

/**
 * Labels an article link with its kind and publish date, e.g. "(recap 7/13)".
 * `pubDate` is a YYYY-MM-DD string; month and day are shown without leading
 * zeros.
 */
export function formatArticleMeta(kind: ArticleLink['kind'], pubDate: string): string {
  const [, m, d] = pubDate.slice(0, 10).split('-').map(Number);
  return `(${kind} ${m}/${d})`;
}

/**
 * Whether `url` points at chq.org or one of its subdomains, which is what
 * decides between the "Open on chq.org" and "Open event page" labels.
 * Publisher-feed events carry the publisher's own URL, so the label is derived
 * from the host rather than from `sourcePublisherId` — that stays right even
 * when a publisher links back to chq.org. A malformed URL is not chq.org.
 */
export function isChqOrgUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'chq.org' || host.endsWith('.chq.org');
  } catch {
    return false;
  }
}

interface EventCardProps {
  event: Event;
  index: number;
  isExpanded: boolean;
  onToggleDescription: (eventId: string) => void;
  onToggleTag: (tag: string) => void;
  isTagSelected: (tag: string) => boolean;
  isFavorite: boolean;
  onToggleFavorite: (eventId: string) => void;
  onDownloadICS: (event: Event) => void;
  articleLinks?: ArticleLink[];
  programLinks?: ProgramLink[];
}

function EventCardInner({ event, index, isExpanded, onToggleDescription, onToggleTag, isTagSelected, isFavorite, onToggleFavorite, onDownloadICS, articleLinks, programLinks }: EventCardProps) {
  const [showPopup, setShowPopup] = useState(false);
  const calendarButtonRef = useRef<HTMLButtonElement>(null);

  const handleCalendarClick = () => {
    if (isDesktop()) {
      setShowPopup(prev => !prev);
    } else {
      onDownloadICS(event);
    }
  };

  const detailCategories = event.categories?.filter(cat => !cat.name.startsWith('Week ')) ?? [];
  const hasProgramLinks = Boolean(programLinks && programLinks.length > 0);
  const hasArticleLinks = Boolean(articleLinks && articleLinks.length > 0);
  /**
   * The event name is the disclosure control only when there is something
   * behind it. An event with nothing but a title and a time should not offer a
   * control that opens an empty box.
   */
  const hasDetails = Boolean(
    event.description ||
    detailCategories.length > 0 ||
    hasProgramLinks ||
    hasArticleLinks ||
    event.url,
  );
  const detailPanelId = `event-details-${event.id}`;

  const hintGlyphs = (
    <>
      {hasProgramLinks && <span className="ml-1" title="Digital program">📖</span>}
      {hasArticleLinks && <span className="ml-1" title="Chautauquan Daily coverage">📰</span>}
    </>
  );

  return (
    <div data-event-id={event.id} className={`event-card py-2 sm:py-3 ${index > 0 ? 'border-t border-gray-200 dark:border-gray-700' : ''} hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors`}>
      <div className="flex justify-between items-start gap-2 sm:gap-4">
        <div className="flex-1 min-w-0">
          {/* Time and location above title */}
          <div className="flex items-center justify-between text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-1">
            <span>
              🕐 {formatChqTime(parseEventDate(event.startDate))}
              {event.location && <span className="ml-2">📍 {event.location}</span>}
            </span>
            <span className="flex items-center flex-shrink-0 ml-2">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleFavorite(event.id); }}
                className={`p-1.5 rounded-full transition-colors ${
                  isFavorite
                    ? 'text-yellow-500 hover:text-yellow-600'
                    : 'text-gray-300 dark:text-gray-600 hover:text-yellow-400'
                }`}
                title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </button>
              <button
                ref={calendarButtonRef}
                type="button"
                onClick={(e) => { e.stopPropagation(); handleCalendarClick(); }}
                className="p-1.5 rounded-full text-gray-300 dark:text-gray-600 hover:text-blue-500 transition-colors"
                title="Add to calendar"
                aria-label="Add to calendar"
              >
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
            </span>
          </div>

          {/* Event title */}
          <h4
            className={`text-sm sm:text-lg font-semibold mb-1 leading-tight ${
              event.status === 'cancelled'
                ? 'line-through text-gray-500 dark:text-gray-400'
                : 'text-gray-900 dark:text-white'
            }`}
          >
            {hasDetails ? (
              <button
                type="button"
                onClick={() => onToggleDescription(event.id)}
                aria-expanded={isExpanded}
                aria-controls={detailPanelId}
                className={`text-left w-full transition-colors ${
                  event.status === 'cancelled'
                    ? ''
                    : 'hover:text-blue-700 dark:hover:text-blue-300'
                }`}
              >
                {event.title}
                {hintGlyphs}
                <span className="ml-1 text-xs align-middle text-gray-400 dark:text-gray-500" aria-hidden="true">
                  {isExpanded ? '▾' : '▸'}
                </span>
              </button>
            ) : (
              event.title
            )}
          </h4>

          {/* Status badges and publisher attribution.
              Currently set only by publisher-feed events; renders correctly
              for any event that has these fields (no source check required). */}
          {(event.status === 'cancelled' || event.status === 'rescheduled' || event.sourcePublisherName) && (
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {event.status === 'cancelled' && (
                <span className="inline-block px-2 py-0.5 rounded bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 text-xs font-semibold">
                  Cancelled
                </span>
              )}
              {event.status === 'rescheduled' && (
                <span className="inline-block px-2 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 text-xs font-semibold">
                  Rescheduled
                </span>
              )}
              {event.sourcePublisherName && (
                <span className="text-xs italic text-gray-500 dark:text-gray-400">
                  via {event.sourcePublisherName}
                </span>
              )}
            </div>
          )}

          {/* Detail panel, opened by the event name above. Left unmounted when
              collapsed rather than hidden — the list renders ~1,470 events. */}
          {hasDetails && isExpanded && (
            <div id={detailPanelId} className="mb-2">
              {event.description && (
                <div className="text-gray-600 dark:text-gray-300 text-sm mb-2">
                  {event.description
                    .split(/\r?\n/)
                    .map(line => line.trim())
                    .filter(line => line.length > 0)
                    .map((paragraph, index) => (
                      <p key={index} className={index > 0 ? 'mt-2' : ''}>
                        {paragraph}
                      </p>
                    ))}
                </div>
              )}

              {detailCategories.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {detailCategories.map((category, catIndex) => (
                    <button
                      key={`${event.id}-category-${catIndex}`}
                      onClick={() => onToggleTag(category.name)}
                      className={`px-1 py-0.5 sm:px-2 sm:py-1 rounded-full text-xs transition-colors cursor-pointer hover:opacity-80 ${
                        isTagSelected(category.name)
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {getCategoryDisplayName(category.name)}
                    </button>
                  ))}
                </div>
              )}

              {programLinks && programLinks.length > 0 && (
                <div className="mb-2">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                    Digital Program
                  </div>
                  <ul className="space-y-0.5">
                    {programLinks.map((link) => (
                      <li key={link.url} className="text-sm">
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline"
                        >
                          📖 {link.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {articleLinks && articleLinks.length > 0 && (
                <div className="mb-2">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                    In the Chautauquan Daily
                  </div>
                  <ul className="space-y-0.5">
                    {articleLinks.map((link) => (
                      <li key={link.url} className="text-sm">
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline"
                        >
                          📰 {link.title}
                        </a>
                        <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">
                          {formatArticleMeta(link.kind, link.pubDate)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {/* Kept for cancelled events too: chq.org is where a
                  cancellation is confirmed. */}
              {event.url && (
                <div className="mb-1">
                  <a
                    href={event.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400 text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                  >
                    {isChqOrgUrl(event.url) ? 'Open on chq.org' : 'Open event page'}
                    <span aria-hidden="true">↗</span>
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Presenter */}
          {event.presenter && (
            <div className="flex flex-wrap gap-2 text-xs sm:text-sm text-gray-500 dark:text-gray-400">
              <span>👤 {event.presenter}</span>
            </div>
          )}
        </div>

        {/* Event Image */}
        {event.attachments && event.attachments.length > 0 && (
          <div className="flex-shrink-0">
            {event.attachments
              .filter(attachment => attachment.isImage)
              .slice(0, 1)
              .map((attachment, imgIndex) => (
                <img
                  key={imgIndex}
                  src={attachment.url}
                  alt={`${event.title} image`}
                  width={48}
                  height={48}
                  loading="lazy"
                  decoding="async"
                  className="w-12 h-12 sm:w-20 sm:h-20 object-cover rounded-lg border border-gray-200"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ))}
          </div>
        )}
      </div>

      {/* Calendar service picker popup (desktop only) */}
      {showPopup && calendarButtonRef.current && (
        <CalendarPopup
          event={event}
          buttonRect={calendarButtonRef.current.getBoundingClientRect()}
          onClose={() => setShowPopup(false)}
        />
      )}
    </div>
  );
}

/**
 * Memoized, and — like `EventListView` — that is a performance *contract*.
 *
 * The list is the whole year: 89 day sections and 1,687 cards, all mounted
 * (#274 phase 4). `EventListView`'s own memo protects it from a parent state
 * change that leaves its props alone, which is what a scroll does. It cannot
 * protect it from a change to its props, and two of them change on the most
 * ordinary interactions there are: `favoriteIds` (`useFavorites` returns a new
 * `Set`) and `expandedDescriptions` (`useFilterState` likewise). Three more —
 * `weeklyThemes`, `articleLinks`, `programLinks` — arrive from sidecars
 * seconds after the list paints.
 *
 * Without this, every one of those re-rendered all 1,687 cards, each re-running
 * `parseEventDate` + `formatChqTime`. Measured against this branch's own
 * preview build at 4x CPU throttle, with the 2026 year mounted:
 *
 * | interaction        | render flush   | longest long task |
 * |--------------------|----------------|-------------------|
 * | star one event     | 549ms -> 390ms | 492ms -> 350ms    |
 * | expand one descr.  | 213ms ->  33ms | 170ms -> none     |
 *
 * (medians of five, `e2e/measure-card-renders.mjs`.) Expanding a description
 * stops producing a long task at all. Starring still costs, and the residue is
 * NOT card rendering: `favoriteIds` is also an input to `filterOpts` in
 * `page.tsx`, so starring re-runs `filterEvents` and `groupEventsByDay` over
 * the whole year before any card is touched. Separate cost, separate fix, out
 * of scope here. The load-phase long-task profile is unchanged by this memo
 * (990/664/178/84/65/63ms before, 977/662/168/78/67/63ms after).
 *
 * NOTE: this only bites while every prop `EventListView` hands a card stays
 * stable across an unrelated change — `onDownloadICS` is a module import, the
 * four callbacks are `useCallback`s, and `articleLinks?.[event.id]` /
 * `programLinks?.[event.id]` are lookups into records that only change when
 * the sidecar lands. **An inline arrow added to the call site silently removes
 * this memo without failing a single behavioural test.**
 * `EventCard.memo.test.tsx` is the guard.
 */
export const EventCard = memo(EventCardInner);
