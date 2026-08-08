import { useState, useEffect, useRef } from 'react';
import { YearSelector } from '@/components/layout/YearSelector';
import { quickLinks } from '@/lib/quickLinks';

interface HeaderProps {
  selectedYear: number;
  availableYears: number[];
  defaultYear: number;
  onYearChange: (year: number) => void;
}

export function Header({ selectedYear, availableYears, defaultYear, onYearChange }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }
    return () => { document.removeEventListener('mousedown', handleClickOutside); };
  }, [menuOpen]);

  return (
    <header className="bg-white dark:bg-gray-800 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-2 sm:py-4">
          <div className="flex items-center">
            <img
              src="/chq-calendar-icon-256.svg"
              alt="Chautauqua Calendar Logo"
              width={40}
              height={40}
              className="w-8 h-8 sm:w-10 sm:h-10 mr-2 sm:mr-3"
            />
            <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white whitespace-nowrap">
              CHQ Calendar
            </h1>
            <YearSelector
              selectedYear={selectedYear}
              availableYears={availableYears}
              defaultYear={defaultYear}
              onYearChange={onYearChange}
            />
          </div>
          {/* Desktop */}
          <div className="hidden lg:flex items-center gap-2 flex-wrap justify-end">
            {quickLinks.map((link) => (
              <button
                key={link.id}
                onClick={() => window.open(link.webPath ?? link.url, '_blank', 'noopener,noreferrer')}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                {link.title}
              </button>
            ))}
          </div>
          {/* Mobile */}
          <div className="lg:hidden relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="px-2 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center gap-1"
            >
              More
              <svg
                className={`w-3 h-3 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-40 bg-white dark:bg-gray-700 rounded-md shadow-lg py-1 z-50">
                {quickLinks.map((link) => (
                  <button
                    key={link.id}
                    onClick={() => { window.open(link.webPath ?? link.url, '_blank', 'noopener,noreferrer'); setMenuOpen(false); }}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
                  >
                    {link.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
