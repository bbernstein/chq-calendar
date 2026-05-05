/**
 * Publisher format reference — public docs page at /publish/docs/.
 *
 * IMPORTANT — keep in sync with `docs/publisher/AUTHORING.md`.
 * Both files describe the same format. The markdown file is the source of
 * truth for repo browsers and contributors; this page is the public-facing
 * version on chqcal.org. If you edit one, mirror the change in the other.
 */

import type { ReactNode } from 'react';

const MINIMAL_FEED_JSON = `{
  "formatVersion": "1.0",
  "publisher": {
    "id": "example-pub",
    "name": "Example Publisher",
    "contactEmail": "events@example.org"
  },
  "events": [
    {
      "id": "ev-2026-07-04-talk",
      "title": "Sample Talk on Civic Life",
      "startDate": "2026-07-04T18:00:00-04:00",
      "endDate":   "2026-07-04T19:00:00-04:00",
      "category": "Special Lectures",
      "venueId":  "hall-of-philosophy",
      "lastModified": "2026-05-01T12:00:00-04:00"
    }
  ]
}`;

const HTML_EMBED_EXAMPLE = `<!-- chq-publisher
{ "id": "example-pub", "name": "Example Publisher", "contactEmail": "events@example.org" }
-->

<article>
  <h2>Keynote: The Civic Imagination</h2>
  <!-- chq-event
  {
    "id": "ev-2026-07-04-keynote",
    "title": "Keynote: The Civic Imagination",
    "startDate": "2026-07-04T18:00:00-04:00",
    "endDate":   "2026-07-04T19:30:00-04:00",
    "category": "Special Lectures",
    "venueId":  "hall-of-philosophy",
    "lastModified": "2026-05-01T12:00:00-04:00"
  }
  -->
</article>`;

const FREE_VENUE_EXAMPLE = `"venue": { "name": "Smith Memorial Library", "address": "Bestor Plaza" }`;

export default function PublishDocsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <header className="bg-white dark:bg-gray-800 shadow-lg">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center py-4">
            <a href="/publish/" className="flex items-center hover:opacity-80">
              <img
                src="/chq-calendar-icon-256.svg"
                alt="Chautauqua Calendar Logo"
                width={32}
                height={32}
                className="w-8 h-8 mr-3"
              />
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                Publisher Format Docs
              </h1>
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <article className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 sm:p-8 prose-styles">
          <p className="text-gray-700 dark:text-gray-300 mb-4">
            If you run an organization, group, or page in the Chautauqua orbit,
            you can publish your events to{' '}
            <a href="https://www.chqcal.org" className="link">chqcal.org</a> by
            serving a small JSON file (or by embedding a few HTML comments on
            a page you already have). We fetch your feed on a schedule and
            merge new and updated events into the calendar. You stay the
            author; we stay the aggregator.
          </p>
          <p className="text-gray-700 dark:text-gray-300 mb-6">
            This guide covers the minimum-viable setup, the field reference,
            and how to validate your feed locally before submitting.
          </p>

          <Section id="minimal" title="The Minimum-Viable Feed">
            <p>Publish a JSON document that looks like this:</p>
            <CodeBlock language="json" code={MINIMAL_FEED_JSON} />
            <p>
              A copy-pasteable version lives at{' '}
              <a className="link" href="https://github.com/bbernstein/chq-calendar/blob/main/docs/publisher/examples/minimal-feed.json">
                <code>examples/minimal-feed.json</code>
              </a>
              . A version using every optional field is at{' '}
              <a className="link" href="https://github.com/bbernstein/chq-calendar/blob/main/docs/publisher/examples/full-feed.json">
                <code>examples/full-feed.json</code>
              </a>
              .
            </p>
          </Section>

          <Section id="fields" title="Field Reference">
            <h3 className="subhead">Top level</h3>
            <FieldTable
              rows={[
                ['formatVersion', 'yes', <>Always <code>"1.0"</code> for now.</>],
                ['publisher', 'yes', 'See below.'],
                ['events', 'yes', <>An array. May be empty (means &ldquo;no events right now&rdquo;).</>],
              ]}
            />

            <h3 className="subhead">publisher</h3>
            <FieldTable
              rows={[
                ['id', 'yes', <>A stable lowercase slug we register for you (<code>a-z0-9-</code> only).</>],
                ['name', 'yes', 'Display name shown to readers.'],
                ['contactEmail', 'yes', 'We email here if your feed breaks.'],
                ['url', 'optional', 'Link back to your homepage.'],
              ]}
            />

            <h3 className="subhead">events[]</h3>
            <FieldTable
              rows={[
                ['id', 'yes', <><strong>Stable</strong> per-event identifier (any string). <strong>Never reuse for a different event.</strong></>],
                ['title', 'yes', 'Plain text, no HTML.'],
                ['startDate', 'yes', <>ISO 8601 with timezone offset, e.g. <code>2026-07-04T18:00:00-04:00</code>.</>],
                ['endDate', 'yes', <>Same format. Must be ≥ <code>startDate</code>.</>],
                ['category', 'yes', <>Must be one of the names listed in <a className="link" href="https://github.com/bbernstein/chq-calendar/blob/main/docs/publisher/categories.json"><code>categories.json</code></a>.</>],
                ['lastModified', 'yes', 'ISO 8601 with offset. Bump this when you change anything else about the event.'],
                ['status', 'optional', <><code>"scheduled"</code> (default), <code>"cancelled"</code>, or <code>"rescheduled"</code>.</>],
                ['description', 'optional', <>Light HTML allowed: <code>&lt;p&gt;</code>, <code>&lt;br&gt;</code>, <code>&lt;strong&gt;</code>, <code>&lt;em&gt;</code>, <code>&lt;a href&gt;</code>, <code>&lt;ul&gt;</code>, <code>&lt;ol&gt;</code>, <code>&lt;li&gt;</code>. Rest stripped.</>],
                ['venueId', 'one of', <>Slug from <a className="link" href="https://github.com/bbernstein/chq-calendar/blob/main/docs/publisher/venues.json"><code>venues.json</code></a>. <strong>Use this when the event is at a known CHQ venue.</strong></>],
                ['venue', 'one of', <>Free-form <code>{'{ name, address?, url? }'}</code> for venues we haven&rsquo;t catalogued.</>],
                ['tags', 'optional', 'Array of strings.'],
                ['presenter', 'optional', 'Speaker, performer, etc.'],
                ['url', 'optional', 'Link to your event page.'],
                ['cost', 'optional', <>Free-form (&ldquo;Free with gate ticket&rdquo;, &ldquo;$15&rdquo;, etc.).</>],
                ['attachments', 'optional', <>Array of <code>{'{ url, type, isImage }'}</code>.</>],
              ]}
            />
            <p className="mt-4">
              You must supply <strong>either</strong> <code>venueId</code>{' '}
              <strong>or</strong> <code>venue</code>, never both, never
              neither.
            </p>
          </Section>

          <Section id="category" title="Choosing a Category">
            <p>
              See{' '}
              <a className="link" href="https://github.com/bbernstein/chq-calendar/blob/main/docs/publisher/categories.json">
                <code>categories.json</code>
              </a>{' '}
              for the canonical list. Use the exact <code>name</code>, e.g.{' '}
              <code>&quot;Chamber Music&quot;</code>, not the slug. If nothing
              fits, email us — adding a category is a one-line change.
            </p>
          </Section>

          <Section id="venue" title="Choosing a Venue">
            <p>
              See{' '}
              <a className="link" href="https://github.com/bbernstein/chq-calendar/blob/main/docs/publisher/venues.json">
                <code>venues.json</code>
              </a>
              . Use the <code>id</code> (slug), e.g.{' '}
              <code>&quot;hall-of-philosophy&quot;</code>. If your event is
              somewhere not in the list, use the free-form <code>venue</code>{' '}
              object instead:
            </p>
            <CodeBlock language="json" code={FREE_VENUE_EXAMPLE} />
          </Section>

          <Section id="dates" title="Date and Time Format">
            <p>
              Always include a timezone offset.{' '}
              <code>2026-07-04T18:00:00</code> (no offset) is rejected.
              Chautauqua is <code>-04:00</code> from June through October
              (EDT) and <code>-05:00</code> the rest of the year (EST).
            </p>
          </Section>

          <Section id="html" title="The HTML-Embedded Variant">
            <p>
              If you&rsquo;d rather embed events into pages you already
              maintain, drop HTML comments. One <code>chq-publisher</code>{' '}
              comment per page identifies who you are; one or more{' '}
              <code>chq-event</code> comments carry the events:
            </p>
            <CodeBlock language="html" code={HTML_EMBED_EXAMPLE} />
            <p>
              A full example is at{' '}
              <a className="link" href="https://github.com/bbernstein/chq-calendar/blob/main/docs/publisher/examples/aggregator-page.html">
                <code>examples/aggregator-page.html</code>
              </a>
              . You can also use a single <code>chq-events</code> comment
              containing <code>{'{ publisher, events: [...] }'}</code> if
              that&rsquo;s easier.
            </p>
          </Section>

          <Section id="updates" title="Updating, Cancelling, and Rescheduling Events">
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Update</strong>: change anything you like, then bump{' '}
                <code>lastModified</code>. We re-ingest on the next fetch.
              </li>
              <li>
                <strong>Reschedule</strong>: update <code>startDate</code> /{' '}
                <code>endDate</code> and bump <code>lastModified</code>.
                Optionally set <code>status: &quot;rescheduled&quot;</code> to
                surface a banner.
              </li>
              <li>
                <strong>Cancel</strong>: either drop the event from your feed
                (silent removal) or set <code>status: &quot;cancelled&quot;</code>{' '}
                so we show a &ldquo;Cancelled&rdquo; treatment.
              </li>
              <li>
                <strong>Stable IDs</strong>: never recycle an <code>id</code>{' '}
                for a different event. If it&rsquo;s a new event, give it a
                new <code>id</code>.
              </li>
            </ul>
          </Section>

          <Section id="validate" title="Validating Locally">
            <p>Run the validator against your file or URL:</p>
            <CodeBlock
              language="bash"
              code={'npx -p @chq-calendar/publisher-format chq-validate-feed <path-or-url>'}
            />
            <p>
              It prints <code>OK</code> plus the event count, or a list of
              errors with JSON-Pointer paths into the offending field. Fix
              and re-run until it&rsquo;s green; we run the same validator
              at ingest.
            </p>
            <p className="mt-3">
              You can also paste a URL into our hosted{' '}
              <a className="link" href="/publish/test/">
                feed test tool
              </a>{' '}
              to see validation errors and an event preview without
              installing anything.
            </p>
          </Section>

          <Section id="register" title="Registering Your Publisher">
            <p>
              Once your feed validates cleanly,{' '}
              <a className="link" href="/publish/apply/">
                apply to be a registered publisher
              </a>
              . You&rsquo;ll get a verification email; click the link, and an
              admin will review and approve. After that, your feed is fetched
              hourly and your events appear on chqcal.org alongside the rest
              of the season.
            </p>
          </Section>

          <Section id="manage" title="Managing Your Publisher">
            <p>
              After approval, sign in at{' '}
              <a className="link" href="/publish/status/">
                /publish/status/
              </a>{' '}
              with the magic-link flow at{' '}
              <a className="link" href="/publish/login/">
                /publish/login/
              </a>{' '}
              to manage your publisher yourself. The status page shows your
              latest fetch result, last error (if any), and the following
              self-service controls:
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Edit profile</strong>: change your display name,
                organization, source URL, and source type. URL or
                source-type changes are validated against your live feed
                before saving — if the new URL doesn&rsquo;t parse, the
                save is rejected with the validator&rsquo;s error.
              </li>
              <li>
                <strong>Change email</strong>: triggers a verification link
                to the new address. The old address simultaneously gets a
                notification with a &ldquo;this wasn&rsquo;t me&rdquo;
                cancel link, so a stolen session can&rsquo;t silently
                hijack your account. The change only takes effect once the
                new address clicks the link.
              </li>
              <li>
                <strong>Pause / Resume</strong>: pause to temporarily stop
                fetches without retracting your already-published events.
                Useful during off-season maintenance. Resume to start
                fetching again on the next hourly cycle.
              </li>
              <li>
                <strong>Fetch now</strong>: manually trigger an
                out-of-cycle ingest of your feed. Rate-limited to once
                every five minutes per publisher. Handy after pushing an
                update you want to see live immediately.
              </li>
              <li>
                <strong>Disable</strong>: permanently disable your
                publisher. Requires typing your publisher slug to
                confirm. Within an hour your events are retracted from
                the calendar. Re-enabling requires an admin to flip the
                flag back — there&rsquo;s no self-serve undo.
              </li>
            </ul>
          </Section>

          <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between text-sm">
            <a href="/publish/" className="link">
              ← Back to publisher portal
            </a>
            <a href="/publish/apply/" className="link">
              Apply to publish →
            </a>
          </div>
        </article>
      </main>

      <footer className="bg-gray-800 text-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center">
          <p className="text-gray-400">
            &copy; {new Date().getFullYear()} Chautauqua Calendar by Bernie and Claude
          </p>
        </div>
      </footer>

      {/*
       * Local utility classes used in this page only. Tailwind 4 lets us
       * compose with @apply at the source level, but for a one-page reuse
       * inline styles via a <style> tag are simpler and avoid touching
       * globals.css.
       */}
      <style>{`
        .link {
          color: rgb(37 99 235);
          text-decoration: underline;
          text-decoration-color: rgba(37, 99, 235, 0.4);
        }
        .link:hover { text-decoration-color: currentColor; }
        .subhead {
          font-weight: 600;
          margin-top: 1.25rem;
          margin-bottom: 0.5rem;
          color: rgb(17 24 39);
        }
        .prose-styles code {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.875em;
          background: rgba(15, 23, 42, 0.06);
          padding: 0.05em 0.35em;
          border-radius: 3px;
        }
        .prose-styles pre code {
          background: none;
          padding: 0;
        }
        /*
         * Dark mode is driven by prefers-color-scheme on this site (no
         * \`.dark\` class is added to the DOM), so the dark-mode overrides
         * for these hand-authored rules must live in a media query rather
         * than a \`.dark X\` selector.
         */
        @media (prefers-color-scheme: dark) {
          .link { color: rgb(96 165 250); }
          .subhead { color: rgb(243 244 246); }
          .prose-styles code { background: rgba(255, 255, 255, 0.08); }
        }
      `}</style>
    </div>
  );
}

interface SectionProps {
  id: string;
  title: string;
  children: ReactNode;
}

function Section({ id, title, children }: SectionProps) {
  return (
    <section id={id} className="mt-8">
      <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
        {title}
      </h2>
      <div className="text-gray-700 dark:text-gray-300 space-y-3">
        {children}
      </div>
    </section>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  return (
    <pre className="my-3 p-4 rounded-md bg-gray-900 text-gray-100 dark:bg-black/40 overflow-x-auto text-sm leading-relaxed">
      <code className={`language-${language}`}>{code}</code>
    </pre>
  );
}

interface FieldTableProps {
  rows: Array<[string, string, ReactNode]>;
}

function FieldTable({ rows }: FieldTableProps) {
  return (
    <div className="my-3 overflow-x-auto">
      <table className="min-w-full text-sm border border-gray-200 dark:border-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-700/40">
          <tr>
            <th className="px-3 py-2 text-left font-semibold text-gray-900 dark:text-white">
              Field
            </th>
            <th className="px-3 py-2 text-left font-semibold text-gray-900 dark:text-white whitespace-nowrap">
              Required
            </th>
            <th className="px-3 py-2 text-left font-semibold text-gray-900 dark:text-white">
              Notes
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([field, required, notes]) => (
            <tr key={field} className="border-t border-gray-200 dark:border-gray-700">
              <td className="px-3 py-2 font-mono whitespace-nowrap text-gray-900 dark:text-gray-100">
                {field}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-gray-700 dark:text-gray-300">
                {required}
              </td>
              <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                {notes}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
