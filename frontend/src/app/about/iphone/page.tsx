import { AboutLayout } from '../AboutLayout';
import { ScenarioBlock } from '../Scenario';
import { FeatureReference } from '../FeatureReference';
import { IOS_FEATURES, IOS_SCENARIOS, PLATFORMS } from '../aboutContent';

const WIDTHS: [number, number] = [420, 840];

export default function AboutIphonePage() {
  const ios = PLATFORMS.find((p) => p.id === 'ios')!;

  return (
    <AboutLayout
      title="CHQ Calendar for iPhone & iPad"
      subtitle="Everything on the web, plus reminders, Home Screen widgets, a day planner, and a map of the grounds."
      current="ios"
    >
      {IOS_SCENARIOS.map((scenario, i) => (
        <ScenarioBlock key={scenario.id} scenario={scenario} widths={WIDTHS} flip={i % 2 === 1} />
      ))}

      <FeatureReference features={IOS_FEATURES} heading="Every feature" />

      <section className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Get the app</h2>
        <p className="mt-3 text-gray-700 dark:text-gray-300">
          Free, with no account and no ads.
        </p>
        <div className="mt-5">
          {ios.ctaHref ? (
            <a
              href={ios.ctaHref}
              className="inline-block px-5 py-2.5 font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              {ios.ctaLabel}
            </a>
          ) : (
            <span className="inline-block px-5 py-2.5 font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-md">
              {ios.ctaLabel}
            </span>
          )}
        </div>
        <p className="mt-5 text-sm text-gray-600 dark:text-gray-400">
          Prefer your browser? The{' '}
          <a href="/about/web" className="text-blue-600 dark:text-blue-400 underline hover:no-underline">
            web app
          </a>{' '}
          has the same events and needs no installation.
        </p>
      </section>
    </AboutLayout>
  );
}
