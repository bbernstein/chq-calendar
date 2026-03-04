import { useState, useRef, useEffect } from 'react';

interface YearSelectorProps {
  selectedYear: number;
  availableYears: number[];
  defaultYear: number;
  onYearChange: (year: number) => void;
}

export function YearSelector({ selectedYear, availableYears, defaultYear, onYearChange }: YearSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const sortedYears = [...availableYears].sort((a, b) => b - a);
  const showDropdown = availableYears.length > 1;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => showDropdown && setIsOpen(!isOpen)}
        className={`ml-2 sm:ml-3 px-2 sm:px-3 py-0.5 sm:py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs sm:text-sm font-medium rounded-full inline-flex items-center gap-1 ${showDropdown ? 'cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors' : 'cursor-default'}`}
        aria-haspopup={showDropdown ? 'listbox' : undefined}
        aria-expanded={isOpen}
      >
        {selectedYear} Season
        {showDropdown && (
          <svg
            className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 sm:left-2 mt-1 bg-white dark:bg-gray-700 rounded-md shadow-lg py-1 z-50 min-w-[160px] border border-gray-200 dark:border-gray-600"
          aria-label="Select season year"
        >
          {sortedYears.map((year) => (
            <button
              key={year}
              role="option"
              aria-selected={year === selectedYear}
              onClick={() => {
                onYearChange(year);
                setIsOpen(false);
              }}
              className={`block w-full text-left px-4 py-2 text-sm transition-colors ${
                year === selectedYear
                  ? 'bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-200 font-medium'
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600'
              }`}
            >
              <span className="flex items-center justify-between">
                <span>{year} Season</span>
                <span className="flex items-center gap-1">
                  {year === defaultYear && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">(current)</span>
                  )}
                  {year === selectedYear && (
                    <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
