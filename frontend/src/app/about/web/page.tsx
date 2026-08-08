import { AboutLayout } from '../AboutLayout';
import { ScenarioBlock } from '../Scenario';
import { FeatureReference } from '../FeatureReference';
import { WEB_FEATURES, WEB_SCENARIOS } from '../aboutContent';

const WIDTHS: [number, number] = [640, 1280];

export default function AboutWebPage() {
  return (
    <AboutLayout
      title="CHQ Calendar on the web"
      subtitle="The full season in any browser. Nothing to install, nothing to sign up for."
      current="web"
    >
      {/* `wide`: these captures are 1280x900 landscape browser windows, not
          portrait phone shots, so they get the full content column instead
          of ScenarioBlock's 384px side-by-side slot. */}
      {WEB_SCENARIOS.map((scenario) => (
        <ScenarioBlock key={scenario.id} scenario={scenario} widths={WIDTHS} wide />
      ))}

      <FeatureReference features={WEB_FEATURES} heading="Every feature" />

      <section className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Open the calendar</h2>
        <p className="mt-3 text-gray-700 dark:text-gray-300">
          No account, no ads, and it works on any device with a browser.
        </p>
        <div className="mt-5">
          <a
            href="/"
            className="inline-block px-5 py-2.5 font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Open the calendar
          </a>
        </div>
        <p className="mt-5 text-sm text-gray-600 dark:text-gray-400">
          On an iPhone or iPad? The{' '}
          <a href="/about/iphone" className="text-blue-600 dark:text-blue-400 underline hover:no-underline">
            native app
          </a>{' '}
          adds reminders, widgets, a day planner, and a grounds map.
        </p>
      </section>
    </AboutLayout>
  );
}
