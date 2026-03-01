interface ActiveFiltersProps {
  filteredCount: number;
  totalCount: number;
  hasFilters: boolean;
  onClear: () => void;
}

export function ActiveFilters({ filteredCount, totalCount, hasFilters, onClear }: ActiveFiltersProps) {
  return (
    <div className="mt-2 sm:mt-4 pt-2 sm:pt-3 border-t border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600 dark:text-gray-300 font-medium">
          {hasFilters
            ? `Events (${filteredCount}/${totalCount})`
            : `Events (${totalCount})`
          }
        </div>
        {hasFilters && (
          <button
            onClick={onClear}
            className="px-3 py-1 sm:px-4 sm:py-2 text-sm text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Clear All Filters
          </button>
        )}
      </div>
    </div>
  );
}
