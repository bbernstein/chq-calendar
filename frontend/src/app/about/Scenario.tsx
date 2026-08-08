import type { Scenario } from './aboutContent';
import { Screenshot } from './Screenshot';

interface ScenarioBlockProps {
  scenario: Scenario;
  widths: [number, number];
  /** Puts the screenshot on the left instead of the right, for alternation. */
  flip?: boolean;
  /**
   * Stacks a full-width screenshot under the prose instead of pairing them
   * side by side.
   *
   * The default layout caps the image column at `max-w-sm` (384px), which
   * suits the portrait phone captures the iOS guide uses. The web guide's
   * captures are 1280×900 landscape browser windows; squeezed into 384px
   * their UI text is unreadable, which defeats the point of showing them.
   * `flip` is meaningless here — there is no second column to swap with —
   * so `wide` wins over it.
   */
  wide?: boolean;
}

export function ScenarioBlock({ scenario, widths, flip, wide }: ScenarioBlockProps) {
  return (
    <section
      className={`flex flex-col gap-6 md:gap-10 ${
        wide ? '' : `md:items-center ${flip ? 'md:flex-row-reverse' : 'md:flex-row'}`
      }`}
    >
      <div className={wide ? undefined : 'md:flex-1'}>
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
        <div className={wide ? 'w-full' : 'md:flex-1 md:max-w-sm mx-auto w-full'}>
          <Screenshot shot={scenario.screenshot} widths={widths} wide={wide} />
        </div>
      )}
    </section>
  );
}
