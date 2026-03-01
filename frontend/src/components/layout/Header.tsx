'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { ACTIVE_YEAR } from '@/lib/constants';

export function Header() {
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
            <Image
              src="/chq-calendar-icon-256.svg"
              alt="Chautauqua Calendar Logo"
              width={40}
              height={40}
              className="w-8 h-8 sm:w-10 sm:h-10 mr-2 sm:mr-3"
            />
            <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">
              CHQ Calendar
            </h1>
            <span className="ml-2 sm:ml-3 px-2 sm:px-3 py-0.5 sm:py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs sm:text-sm font-medium rounded-full">
              {ACTIVE_YEAR} Season
            </span>
          </div>
          {/* Desktop */}
          <div className="hidden md:flex items-center gap-2">
            <button
              onClick={() => window.open('/feedback', '_blank')}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Feedback
            </button>
            <button
              onClick={() => window.open('https://programs.chq.org/', '_blank')}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Programs
            </button>
          </div>
          {/* Mobile */}
          <div className="md:hidden relative" ref={menuRef}>
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
                <button
                  onClick={() => { window.open('/feedback', '_blank'); setMenuOpen(false); }}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
                >
                  Feedback
                </button>
                <button
                  onClick={() => { window.open('https://programs.chq.org/', '_blank'); setMenuOpen(false); }}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
                >
                  Programs
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
