import type { Scenario } from './aboutContent';
import { Screenshot } from './Screenshot';

interface ScenarioBlockProps {
  scenario: Scenario;
  widths: [number, number];
  /** Puts the screenshot on the left instead of the right, for alternation. */
  flip?: boolean;
}

export function ScenarioBlock({ scenario, widths, flip }: ScenarioBlockProps) {
  return (
    <section
      className={`flex flex-col gap-6 md:gap-10 md:items-center ${
        flip ? 'md:flex-row-reverse' : 'md:flex-row'
      }`}
    >
      <div className="md:flex-1">
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
          {scenario.title}
        </h2>
        <div className="mt-4 space-y-4 text-gray-700 dark:text-gray-300">
          {scenario.body.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>
      </div>
      {scenario.screenshot && (
        <div className="md:flex-1 md:max-w-sm mx-auto w-full">
          <Screenshot shot={scenario.screenshot} widths={widths} />
        </div>
      )}
    </section>
  );
}
