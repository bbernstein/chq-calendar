/**
 * Support — public page at /support/.
 *
 * Required by App Store Connect as the app's Support URL.
 */

import type { ReactNode } from 'react';

const DISCLAIMER =
  'CHQ Calendar is an independent app and is not affiliated with, endorsed by, or sponsored by Chautauqua Institution. Event information is drawn from publicly posted listings; chq.org remains the authoritative source.';

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <header className="bg-white dark:bg-gray-800 shadow-lg">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center py-4">
            <a href="/" className="flex items-center hover:opacity-80">
              <img
                src="/chq-calendar-icon-256.svg"
                alt="Chautauqua Calendar Logo"
                width={32}
                height={32}
                className="w-8 h-8 mr-3"
              />
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                Support
              </h1>
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <article className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 sm:p-8 prose-styles">
          <p className="text-gray-700 dark:text-gray-300 mb-6">
            CHQ Calendar is an independent, unofficial guide to the
            Chautauqua Institution&rsquo;s summer season. It gathers
            publicly posted event listings — lectures, concerts, worship
            services, and more — into one place you can browse, search,
            filter by week or venue, and add straight to your own calendar.
            It&rsquo;s available as a website at chqcal.org and as a native
            iOS app.
          </p>

          <Section title="Report a Problem or Ask a Question">
            <p>
              If something looks wrong — a bad date, a broken link, a
              missing event — or you just have a question, let us know
              through our{' '}
              <a className="link" href="/feedback">
                feedback form
              </a>
              . We read every submission.
            </p>
          </Section>

          <Section title="Tickets and Official Announcements">
            <p>
              Events shown here come from publicly posted listings, not
              from a feed we control ourselves. For ticketing, schedule
              changes, and official announcements, chq.org remains the
              authoritative source.
            </p>
          </Section>

          <Section title="Privacy">
            <p>
              CHQ Calendar has no accounts, no analytics, and no tracking.
              See our{' '}
              <a className="link" href="/privacy">
                privacy policy
              </a>{' '}
              for the full details of what information (if any) is
              collected.
            </p>
          </Section>

          <Section title="About This App">
            <p>{DISCLAIMER}</p>
          </Section>
        </article>
      </main>

      <footer className="bg-gray-800 text-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center">
          <p className="text-gray-400">
            &copy; {new Date().getFullYear()} Chautauqua Calendar by Bernie
          </p>
        </div>
      </footer>

      {/*
       * Local utility classes used on this page only, mirroring the
       * /publish/docs page. Dark mode on this site is driven entirely by
       * prefers-color-scheme (no `.dark` class is added to the DOM), so the
       * dark-mode overrides for these hand-authored rules live in a media
       * query rather than a `.dark X` selector.
       */}
      <style>{`
        .link {
          color: rgb(37 99 235);
          text-decoration: underline;
          text-decoration-color: rgba(37, 99, 235, 0.4);
        }
        .link:hover { text-decoration-color: currentColor; }
        @media (prefers-color-scheme: dark) {
          .link { color: rgb(96 165 250); }
        }
      `}</style>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
        {title}
      </h2>
      <div className="text-gray-700 dark:text-gray-300 space-y-3">
        {children}
      </div>
    </section>
  );
}
