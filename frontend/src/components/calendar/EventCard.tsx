import type { Event } from '@/lib/types';
import { getCategoryDisplayName } from '@/lib/constants';

interface EventCardProps {
  event: Event;
  index: number;
  isExpanded: boolean;
  onToggleDescription: (eventId: string) => void;
  onToggleTag: (tag: string) => void;
  isTagSelected: (tag: string) => boolean;
}

export function EventCard({ event, index, isExpanded, onToggleDescription, onToggleTag, isTagSelected }: EventCardProps) {
  return (
    <div className={`event-card py-2 sm:py-3 ${index > 0 ? 'border-t border-gray-200 dark:border-gray-700' : ''} hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors`}>
      <div className="flex justify-between items-start gap-2 sm:gap-4">
        <div className="flex-1 min-w-0">
          {/* Time and location above title */}
          <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-1">
            🕐 {new Date(event.startDate).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            })}
            {event.location && (
              <span className="ml-2">📍 {event.location}</span>
            )}
          </div>

          {/* Event title */}
          <h4 className="text-sm sm:text-lg font-semibold text-gray-900 dark:text-white mb-1 leading-tight">
            {event.url ? (
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

          {/* Description with disclosure widget */}
          {(event.description || (event.categories && event.categories.filter(cat => !cat.name.startsWith('Week ')).length > 0)) && (
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
                </div>
              ) : (
                <button
                  onClick={() => onToggleDescription(event.id)}
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-xs font-medium flex items-center gap-1"
                >
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
    </div>
  );
}
