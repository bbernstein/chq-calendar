import { AboutLayout } from './AboutLayout';
import { PlatformCard } from './PlatformCard';
import { FeatureReference } from './FeatureReference';
import { PLATFORMS, SHARED_HIGHLIGHTS } from './aboutContent';

export default function AboutPage() {
  return (
    <AboutLayout
      title="A calendar for the whole Chautauqua season"
      subtitle="CHQ Calendar gathers every publicly posted event of the season into one place you can search, filter, and plan around — on your phone or in your browser."
      current="overview"
    >
      <section>
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
          Pick where you’re starting
        </h2>
        <p className="mt-3 text-gray-600 dark:text-gray-400">
          Same events, same season, no account either way. The iPhone and iPad app
          adds reminders, widgets, a day planner, and a map of the grounds.
        </p>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {PLATFORMS.map((platform) => (
            <PlatformCard key={platform.id} platform={platform} />
          ))}
        </div>
      </section>

      <FeatureReference features={SHARED_HIGHLIGHTS} heading="What it does, everywhere" />

      <section>
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
          Need a hand?
        </h2>
        <p className="mt-3 text-gray-700 dark:text-gray-300">
          If something looks wrong — a bad date, a broken link, a missing event —
          or you just have a question, our{' '}
          <a href="/support" className="text-blue-600 dark:text-blue-400 underline hover:no-underline">
            support page
          </a>{' '}
          explains where to start, and the{' '}
          <a href="/feedback" className="text-blue-600 dark:text-blue-400 underline hover:no-underline">
            feedback form
          </a>{' '}
          reaches us directly. Every submission gets read.
        </p>
      </section>
    </AboutLayout>
  );
}
