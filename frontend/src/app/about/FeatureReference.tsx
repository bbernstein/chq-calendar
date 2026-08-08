import { groupFeatures, type Feature } from './aboutContent';

interface FeatureReferenceProps {
  features: Feature[];
  heading: string;
}

export function FeatureReference({ features, heading }: FeatureReferenceProps) {
  return (
    <section>
      <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
        {heading}
      </h2>
      <p className="mt-3 text-gray-600 dark:text-gray-400">
        Everything the app does. A ★ marks the ones people usually don’t find on their own.
      </p>
      <div className="mt-8 space-y-10">
        {groupFeatures(features).map(({ group, features: groupFeatureList }) => (
          <div key={group}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
              {group}
            </h3>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              {groupFeatureList.map((feature) => (
                <div
                  key={feature.id}
                  data-feature-id={feature.id}
                  data-not-obvious={feature.notObvious ? 'true' : undefined}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow p-4"
                >
                  <dt className="font-medium text-gray-900 dark:text-white">
                    {feature.notObvious && (
                      <>
                        <span className="text-blue-600 dark:text-blue-400 mr-1" aria-hidden="true">★</span>
                        <span className="sr-only">Worth knowing: </span>
                      </>
                    )}
                    {feature.title}
                  </dt>
                  <dd className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                    {feature.blurb}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
