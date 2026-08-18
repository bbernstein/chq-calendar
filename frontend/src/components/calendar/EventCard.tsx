import { useState, useRef } from 'react';
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

export function EventCard({ event, index, isExpanded, onToggleDescription, onToggleTag, isTagSelected, isFavorite, onToggleFavorite, onDownloadICS, articleLinks, programLinks }: EventCardProps) {
  const [showPopup, setShowPopup] = useState(false);
  const calendarButtonRef = useRef<HTMLButtonElement>(null);

  const handleCalendarClick = () => {
    if (isDesktop()) {
      setShowPopup(prev => !prev);
    } else {
      onDownloadICS(event);
    }
  };

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
            {event.url && event.status !== 'cancelled' ? (
              <a
                href={event.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline"
              >
                {event.title} 🔗
              </a>
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

          {/* Description with disclosure widget */}
          {(event.description ||
            (event.categories && event.categories.filter(cat => !cat.name.startsWith('Week ')).length > 0) ||
            (articleLinks && articleLinks.length > 0) ||
            (programLinks && programLinks.length > 0)) && (
            <div className="mb-2">
              {isExpanded ? (
                <div>
                  <button
                    onClick={() => onToggleDescription(event.id)}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-xs font-medium flex items-center gap-1"
                  >
                    <span className="text-xs">▼</span> Show less
                  </button>

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

                  <div className="mb-2 flex flex-wrap gap-1">
                    {event.categories?.filter(cat => !cat.name.startsWith('Week ')).map((category, catIndex) => (
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
                </div>
              ) : (
                <button
                  onClick={() => onToggleDescription(event.id)}
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-xs font-medium flex items-center gap-1"
                >
                  {programLinks && programLinks.length > 0 && (
                    <span title="Digital program">📖</span>
                  )}
                  {articleLinks && articleLinks.length > 0 && (
                    <span title="Chautauquan Daily coverage">📰</span>
                  )}
                  <span className="text-xs">▶</span> Show more
                </button>
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
