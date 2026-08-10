/**
 * Privacy policy — public page at /privacy/.
 *
 * Required by App Store Connect as the app's Privacy Policy URL. The facts
 * stated here are load-bearing: Apple's privacy "nutrition label" declares
 * the same facts, so this page must stay accurate to what the codebase
 * actually does. If the app's data handling changes, update this page and
 * the nutrition label together.
 */

import type { ReactNode } from 'react';

const DISCLAIMER =
  'CHQ Calendar is an independent app and is not affiliated with, endorsed by, or sponsored by Chautauqua Institution. Event information is drawn from publicly posted listings; chq.org remains the authoritative source.';

export default function PrivacyPage() {
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
                Privacy Policy
              </h1>
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <article className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 sm:p-8 prose-styles">
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
            Last updated: August 1, 2026
          </p>

          <p className="text-gray-700 dark:text-gray-300 mb-6">
            CHQ Calendar is a calendar of the Chautauqua Institution&rsquo;s
            summer season, available as a website at chqcal.org and as a
            native iOS app. This page explains what information the website
            and the app handle, and what they don&rsquo;t.
          </p>

          <Section title="No Accounts">
            <p>
              CHQ Calendar has no accounts. There is no sign-in, no password,
              and no profile to set up — every feature is available
              immediately, to everyone, without providing any personal
              information.
            </p>
          </Section>

          <Section title="No Analytics SDKs or Ad Tracking">
            <p>
              The app and website contain no third-party analytics SDKs and
              no advertising identifiers. Neither one tracks you across
              other apps or websites in the sense Apple&rsquo;s App Tracking
              Transparency framework means by tracking, and neither shows
              you targeted ads. See &ldquo;How We Measure Site Traffic&rdquo;
              below for the one place we do measure aggregate usage of the
              website.
            </p>
          </Section>

          <Section title="Your Preferences Stay on Your Device">
            <p>
              The categories, venues, weeks, and favorites you filter by are
              saved locally — in your browser&rsquo;s <code>localStorage</code>{' '}
              on the website, and in <code>UserDefaults</code> in the iOS
              app. That information never leaves your device: it is not sent
              to us, not synced to any server, and not shared with anyone
              else.
            </p>
          </Section>

          <Section title="Event Data Is Cached for Offline Use">
            <p>
              So the app stays fast and keeps working when you lose signal
              on the grounds, it caches the season&rsquo;s public event data
              on your device. This cache holds only the same event details
              anyone can see on chqcal.org — titles, times, venues,
              presenters — and nothing about you personally.
            </p>
          </Section>

          <Section title="Calendar Access Is Write-Only">
            <p>
              When you add an event to your calendar from the iOS app, it
              requests write-only calendar access. That means the app can
              create the specific event you asked to add, but it cannot
              read, browse, or modify anything already on your calendar.
              Nothing is written unless you explicitly tap &ldquo;Add to
              Calendar&rdquo; for that event.
            </p>
          </Section>

          <Section title="How We Measure Site Traffic">
            <p>
              chqcal.org&rsquo;s content delivery network records the IP
              address and user-agent string of every request it serves —
              including requests made by the iOS app, which talks to this
              same website — and retains those raw logs for 90 days. From
              them we derive a pseudonymous, hashed visitor key and use it
              to count unique visitors and tell new visitors from returning
              ones, in aggregate, across days, weeks, and the season. This
              is ordinary web traffic measurement: it is not used for
              advertising, it involves no ad networks or data brokers, and
              it is never sold or shared with anyone. It is not linked to
              any account or real-world identity, because CHQ Calendar has
              no accounts. If you would rather not be counted this way,
              use a browser extension or network setting that hides your
              IP address (a VPN, for example); we have no way to identify
              or exempt individual requests otherwise.
            </p>
          </Section>

          <Section title="About This App">
            <p>{DISCLAIMER}</p>
          </Section>

          <Section title="Questions">
            <p>
              If you have a question about this policy or about how the app
              or website works, visit our{' '}
              <a className="link" href="/support">
                support page
              </a>
              .
            </p>
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
        .prose-styles code {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.875em;
          background: rgba(15, 23, 42, 0.06);
          padding: 0.05em 0.35em;
          border-radius: 3px;
        }
        @media (prefers-color-scheme: dark) {
          .link { color: rgb(96 165 250); }
          .prose-styles code { background: rgba(255, 255, 255, 0.08); }
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
