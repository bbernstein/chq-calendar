import type { ReactNode } from 'react';
import { AboutNav, type AboutPageKey } from './AboutNav';

interface AboutLayoutProps {
  title: string;
  subtitle?: string;
  current: AboutPageKey;
  children: ReactNode;
}

export function AboutLayout({ title, subtitle, current, children }: AboutLayoutProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <header className="bg-white dark:bg-gray-800 shadow-lg">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3 py-4">
            <a href="/" className="flex items-center hover:opacity-80">
              <img
                src="/chq-calendar-icon-256.svg"
                alt="Chautauqua Calendar logo"
                width={32}
                height={32}
                className="w-8 h-8 mr-3"
              />
              <span className="text-xl font-bold text-gray-900 dark:text-white">
                CHQ Calendar
              </span>
            </a>
            <AboutNav current={current} />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-3 text-lg text-gray-700 dark:text-gray-300 max-w-2xl">
            {subtitle}
          </p>
        )}
        <div className="mt-8 sm:mt-12 space-y-12 sm:space-y-16">{children}</div>
      </main>

      <footer className="bg-gray-800 text-white mt-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center">
          <p className="text-gray-400">
            &copy; {new Date().getFullYear()} Chautauqua Calendar by Bernie
          </p>
          {/* Literal prose, NOT {DISCLAIMER} from aboutContent.ts: Task 8's
              verbatim-duplication test reads this source file as text and
              compares on collapsed whitespace, exactly as it does for
              page.tsx and support/page.tsx today. Referencing the constant
              would render identically but fail that later test. */}
          <p className="text-gray-500 text-sm mt-3 max-w-2xl mx-auto">
            CHQ Calendar is an independent app and is not affiliated with, endorsed by, or
            sponsored by Chautauqua Institution. Event information is drawn from publicly
            posted listings; chq.org remains the authoritative source.
          </p>
          <p className="text-gray-400 text-sm mt-3">
            <a href="/privacy" className="hover:text-white underline">Privacy</a>
            <span className="mx-2" aria-hidden="true">·</span>
            <a href="/support" className="hover:text-white underline">Support</a>
            <span className="mx-2" aria-hidden="true">·</span>
            <a href="/feedback" className="hover:text-white underline">Feedback</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
