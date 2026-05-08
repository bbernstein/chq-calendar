import type { ActiveChip } from './buildActiveChips';

interface ActiveFiltersProps {
  filteredCount: number;
  totalCount: number;
  hasFilters: boolean;
  hasDateFilters: boolean;
  hasNonDateFilters: boolean;
  chips: ActiveChip[];
  onClear: () => void;
  onClearNonDateFilters: () => void;
}

const FilterIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L15 12.414V19a1 1 0 01-1.447.894l-4-2A1 1 0 019 17v-4.586L3.293 6.707A1 1 0 013 6V4z" />
  </svg>
);

const CloseIcon = ({ className = 'w-3 h-3' }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 6l12 12M6 18L18 6" />
  </svg>
);

const ResetIcon = ({ className = 'w-3 h-3' }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M4 4v5h5M20 20v-5h-5M5.5 9A7 7 0 0118 7m1.5 8a7 7 0 01-12.5 2" />
  </svg>
);

const CalendarKeepIcon = ({ className = 'w-3 h-3' }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M8 7V3m8 4V3M3 11h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2zM9 16l2 2 4-4" />
  </svg>
);

const CHIP_CLASSES = [
  'inline-flex items-center gap-1 max-w-full px-2 py-1 rounded-md text-xs font-medium',
  'bg-amber-100 text-amber-900 border border-amber-300',
  'dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-700',
  'hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors',
].join(' ');

const CLEAR_BUTTON_CLASSES = [
  'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap',
  'bg-blue-600 text-white border border-blue-700',
  'dark:bg-blue-500 dark:text-white dark:border-blue-400',
  'hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors',
].join(' ');

function FilterChip({ chip }: { chip: ActiveChip }) {
  const ariaLabel = chip.prefix ? `Remove filter ${chip.prefix}: ${chip.label}` : `Remove filter ${chip.label}`;
  return (
    <button
      type="button"
      onClick={chip.onRemove}
      className={CHIP_CLASSES}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <span className="truncate">{chip.label}</span>
      <CloseIcon className="w-3 h-3 flex-shrink-0 opacity-70" />
    </button>
  );
}

function ShowAllEventsButton({ onClear }: { onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label="Clear all filters and show all events"
      title="Clear all filters and show all events"
      className={CLEAR_BUTTON_CLASSES}
    >
      <ResetIcon className="w-3 h-3 flex-shrink-0" />
      <span className="hidden sm:inline">Show all events</span>
      <span className="sm:hidden">Show all</span>
    </button>
  );
}

function KeepDatesButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Keep date and week filters but clear all other filters"
      title="Keep date and week filters but clear all other filters"
      className={CLEAR_BUTTON_CLASSES}
    >
      <CalendarKeepIcon className="w-3 h-3 flex-shrink-0" />
      <span className="hidden sm:inline">Keep dates, show all</span>
      <span className="sm:hidden">Keep dates</span>
    </button>
  );
}

export function ActiveFilters({
  filteredCount, totalCount, hasFilters, hasDateFilters, hasNonDateFilters,
  chips, onClear, onClearNonDateFilters,
}: ActiveFiltersProps) {
  const showKeepDates = hasDateFilters && hasNonDateFilters;

  return (
    <div className="mt-2 sm:mt-4 pt-2 sm:pt-3 border-t border-gray-200 dark:border-gray-700">
      {hasFilters && chips.length > 0 && (
        <div className="mb-2 flex items-start gap-2 flex-wrap">
          <span className="flex-shrink-0 inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300 pt-1">
            <FilterIcon className="w-4 h-4" />
            <span className="sr-only sm:not-sr-only">Filtering by:</span>
          </span>
          <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
            <ShowAllEventsButton onClear={onClear} />
            {showKeepDates && <KeepDatesButton onClick={onClearNonDateFilters} />}
            {chips.map(chip => (
              <FilterChip key={chip.key} chip={chip} />
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-sm text-gray-600 dark:text-gray-300 font-medium">
          {hasFilters
            ? `Events (${filteredCount}/${totalCount})`
            : `Events (${totalCount})`
          }
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear all filters and show all events"
            title="Clear all filters and show all events"
            className="text-sm font-medium text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100 underline underline-offset-2 whitespace-nowrap"
          >
            <span className="hidden sm:inline">Show all events</span>
            <span className="sm:hidden">Show all</span>
          </button>
        )}
        {showKeepDates && (
          <button
            type="button"
            onClick={onClearNonDateFilters}
            aria-label="Keep date and week filters but clear all other filters"
            title="Keep date and week filters but clear all other filters"
            className="text-sm font-medium text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100 underline underline-offset-2 whitespace-nowrap"
          >
            <span className="hidden sm:inline">Keep dates, show all</span>
            <span className="sm:hidden">Keep dates</span>
          </button>
        )}
      </div>
    </div>
  );
}
