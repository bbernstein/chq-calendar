/**
 * Public landing page for the publisher portal.
 *
 * Routes:
 *   /publish/         — this page
 *   /publish/test/    — feed validator + preview tool (Phase A)
 *   /publish/apply/   — application form (Phase B, not yet built)
 *
 * Visual style matches `frontend/src/app/feedback/page.tsx` and
 * `frontend/src/app/admin/publishers/page.tsx` — gradient background,
 * white card, dark-mode via prefers-color-scheme.
 */

export default function PublishLandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-lg">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center py-4">
            <img
              src="/chq-calendar-icon-256.svg"
              alt="Chautauqua Calendar Logo"
              width={32}
              height={32}
              className="w-8 h-8 mr-3"
            />
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
              Publish on Chautauqua Calendar
            </h1>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 sm:p-8">
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Get your venue&apos;s events on chqcal.org
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-3">
              Want your venue&apos;s events to appear on{' '}
              <a
                href="https://www.chqcal.org"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                chqcal.org
              </a>
              ? Publish a feed in our format and we&apos;ll pull it in
              automatically — your events show up alongside the rest of the
              Chautauqua season programming.
            </p>
            <p className="text-gray-700 dark:text-gray-300">
              You host the feed (a JSON document or a parseable HTML page) at
              a public URL. Our ingest pipeline fetches it on a schedule,
              validates it against the publisher format, and adds new or
              updated events to the calendar.
            </p>
          </section>

          {/* How it works */}
          <section className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
              How it works
            </h3>
            <ol className="list-decimal list-inside space-y-2 text-gray-700 dark:text-gray-300">
              <li>
                Publish your events at a public URL in the{' '}
                <span className="font-mono text-sm">
                  @chq-calendar/publisher-format
                </span>{' '}
                JSON shape (or as HTML we can extract).
              </li>
              <li>
                Use the test tool below to validate your feed and preview how
                events will look — no account required.
              </li>
              <li>
                When the feed looks right, apply to be a registered publisher.
                Once approved, the calendar fetches your feed hourly.
              </li>
            </ol>
          </section>

          {/* CTAs */}
          <section className="grid sm:grid-cols-2 gap-4">
            <a
              href="/publish/test/"
              className="block p-5 border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
            >
              <h4 className="text-lg font-semibold text-blue-900 dark:text-blue-200 mb-1">
                Test your feed
              </h4>
              <p className="text-sm text-blue-800 dark:text-blue-300">
                Paste any URL and see validation errors, warnings, and a
                preview of every parsed event.
              </p>
            </a>

            <a
              href="/publish/apply/"
              className="block p-5 border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
            >
              <h4 className="text-lg font-semibold text-blue-900 dark:text-blue-200 mb-1">
                Apply to be a publisher
              </h4>
              <p className="text-sm text-blue-800 dark:text-blue-300">
                Submit your contact info and feed URL for review. We&apos;ll
                send a verification email and an admin will approve before
                your events go live.
              </p>
            </a>
          </section>

          {/* Help / contact */}
          <section className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 space-y-2">
            <p>
              Already a publisher?{' '}
              <a
                href="/publish/login/"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                Sign in
              </a>{' '}
              to view your status and recent fetch history.
            </p>
            <p>
              Questions? Reach out via the{' '}
              <a
                href="/feedback/"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                feedback form
              </a>
              .
            </p>
          </section>
        </div>
      </main>

      <footer className="bg-gray-800 text-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center">
          <p className="text-gray-400">
            &copy; {new Date().getFullYear()} Chautauqua Calendar by Bernie
            and Claude
          </p>
        </div>
      </footer>
    </div>
  );
}
