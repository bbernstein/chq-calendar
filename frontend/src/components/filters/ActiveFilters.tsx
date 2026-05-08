import { useEffect, useState } from 'react';
import type { ActiveChip } from './buildActiveChips';

interface ActiveFiltersProps {
  filteredCount: number;
  totalCount: number;
  hasFilters: boolean;
  chips: ActiveChip[];
  onClear: () => void;
}

type Variant = '1' | '2' | '3';

function readVariantFromUrl(): Variant {
  if (typeof window === 'undefined') return '1';
  const v = new URLSearchParams(window.location.search).get('fv');
  return v === '2' || v === '3' ? v : '1';
}

function useVariant(): Variant {
  const [variant, setVariant] = useState<Variant>(readVariantFromUrl);
  useEffect(() => {
    const onPop = () => setVariant(readVariantFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return variant;
}

const FilterIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L15 12.414V19a1 1 0 01-1.447.894l-4-2A1 1 0 019 17v-4.586L3.293 6.707A1 1 0 013 6V4z" />
  </svg>
);

const ResetIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M4 4v5h5M20 20v-5h-5M5.5 9A7 7 0 0118 7m1.5 8a7 7 0 01-12.5 2" />
  </svg>
);

const CloseIcon = ({ className = 'w-3 h-3' }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 6l12 12M6 18L18 6" />
  </svg>
);

function chipClassesFor(variant: Variant): string {
  if (variant === '1') {
    return [
      'inline-flex items-center gap-1 max-w-full px-2 py-1 rounded-md text-xs font-medium',
      'bg-amber-100 text-amber-900 border border-amber-300',
      'dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-700',
      'hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors',
    ].join(' ');
  }
  if (variant === '2') {
    return [
      'inline-flex items-center gap-1 max-w-full px-2 py-1 rounded-md text-xs font-medium',
      'bg-white text-gray-800 border border-gray-400',
      'dark:bg-gray-800 dark:text-gray-100 dark:border-gray-500',
      'hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors',
    ].join(' ');
  }
  return [
    'inline-flex items-center gap-1 max-w-full px-2.5 py-1 rounded-full text-xs font-medium',
    'bg-blue-50 text-blue-900 border border-blue-300',
    'dark:bg-blue-900/30 dark:text-blue-100 dark:border-blue-700',
    'hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors',
  ].join(' ');
}

function leadingLabelFor(variant: Variant): string {
  if (variant === '1') return 'Filtering by:';
  if (variant === '2') return 'Filters:';
  return 'Active filters:';
}

function FilterChip({ chip, variant }: { chip: ActiveChip; variant: Variant }) {
  const showPrefix = variant === '3' && chip.prefix;
  const ariaLabel = chip.prefix ? `Remove filter ${chip.prefix}: ${chip.label}` : `Remove filter ${chip.label}`;
  return (
    <button
      type="button"
      onClick={chip.onRemove}
      className={chipClassesFor(variant)}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {showPrefix && <span className="opacity-70">{chip.prefix}:</span>}
      <span className="truncate">{chip.label}</span>
      <CloseIcon className="w-3 h-3 flex-shrink-0 opacity-70" />
    </button>
  );
}

function ResetAction({ variant, onClear }: { variant: Variant; onClear: () => void }) {
  if (variant === '2') {
    return (
      <button
        type="button"
        onClick={onClear}
        className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 text-sm text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
        aria-label="Show all events"
        title="Show all events"
      >
        <ResetIcon />
        <span className="hidden sm:inline">Show all</span>
      </button>
    );
  }
  const label = variant === '1' ? 'Show all events' : 'Reset all';
  const shortLabel = variant === '1' ? 'Show all' : 'Reset';
  return (
    <button
      type="button"
      onClick={onClear}
      className="flex-shrink-0 text-sm font-medium text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100 underline underline-offset-2 whitespace-nowrap"
    >
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{shortLabel}</span>
    </button>
  );
}

export function ActiveFilters({ filteredCount, totalCount, hasFilters, chips, onClear }: ActiveFiltersProps) {
  const variant = useVariant();

  return (
    <div className="mt-2 sm:mt-4 pt-2 sm:pt-3 border-t border-gray-200 dark:border-gray-700">
      {hasFilters && chips.length > 0 && (
        <div className="mb-2 flex items-start gap-2 flex-wrap">
          <span className="flex-shrink-0 inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300 pt-1">
            <FilterIcon className="w-4 h-4" />
            <span className="hidden sm:inline">{leadingLabelFor(variant)}</span>
          </span>
          <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
            {chips.map(chip => (
              <FilterChip key={chip.key} chip={chip} variant={variant} />
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-gray-600 dark:text-gray-300 font-medium">
          {hasFilters
            ? `Events (${filteredCount}/${totalCount})`
            : `Events (${totalCount})`
          }
        </div>
        {hasFilters && <ResetAction variant={variant} onClear={onClear} />}
      </div>
    </div>
  );
}
