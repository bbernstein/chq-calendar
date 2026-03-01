import { getCategoryDisplayName } from '@/lib/constants';

interface CategoryFilterProps {
  availableCategories: string[];
  selectedCount: number;
  recentCategories: string[];
  toggleTag: (tag: string) => void;
  isTagSelected: (tag: string) => boolean;
  pillScroll: {
    scrollRef: React.RefObject<HTMLDivElement | null>;
    scrollState: { canScrollLeft: boolean; canScrollRight: boolean };
    handleScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  };
  listScroll: {
    scrollRef: React.RefObject<HTMLDivElement | null>;
    scrollState: { canScrollUp: boolean; canScrollDown: boolean };
    handleScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  };
}

export function CategoryFilter({
  availableCategories, selectedCount, recentCategories,
  toggleTag, isTagSelected, pillScroll, listScroll,
}: CategoryFilterProps) {
  return (
    <details>
      <summary className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 cursor-pointer flex items-center gap-2 min-w-0">
        <span className="flex-shrink-0 flex items-center gap-1">
          <svg className="w-3 h-3 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Categories {selectedCount > 0 && `(${selectedCount} selected)`}
        </span>
        {recentCategories.length > 0 && (
          <div className={`flex-1 min-w-0 pills-scroll-container ${pillScroll.scrollState.canScrollLeft ? 'scrolled-right' : ''} ${!pillScroll.scrollState.canScrollRight ? 'scrolled-to-end' : ''}`}>
            <div
              ref={pillScroll.scrollRef}
              className="flex gap-2 pb-1 overflow-x-auto overflow-y-hidden scrollbar-hide pr-4"
              onScroll={pillScroll.handleScroll}
            >
              {recentCategories.map(category => (
                <button
                  key={`recent-${category}`}
                  title={category}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleTag(category);
                  }}
                  className={`flex-shrink-0 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full text-xs font-medium transition-colors ${
                    isTagSelected(category)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-500'
                  }`}
                >
                  {getCategoryDisplayName(category)}
                </button>
              ))}
            </div>
          </div>
        )}
      </summary>
      <div className={`filter-list-container mb-2 ${listScroll.scrollState.canScrollUp ? 'scrolled-down' : ''} ${listScroll.scrollState.canScrollDown ? 'can-scroll-down' : ''}`}>
        <div
          ref={listScroll.scrollRef}
          className="max-h-24 sm:max-h-32 overflow-y-auto scrollable-list"
          onScroll={listScroll.handleScroll}
        >
          <div className="flex flex-wrap gap-1 sm:gap-2">
            {availableCategories
              .filter(category => !category.startsWith('Week '))
              .map(category => (
                <button
                  key={category}
                  title={category}
                  onClick={() => toggleTag(category)}
                  className={`px-1 py-0.5 sm:px-2 sm:py-1 rounded-full text-xs font-medium transition-colors ${
                    isTagSelected(category)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {getCategoryDisplayName(category)}
                </button>
              ))}
          </div>
        </div>
      </div>
    </details>
  );
}
