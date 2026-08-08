import type { PlatformInfo } from './aboutContent';

export function PlatformCard({ platform }: { platform: PlatformInfo }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 flex flex-col">
      <h3 className="text-xl font-bold text-gray-900 dark:text-white">{platform.name}</h3>
      <p className="mt-2 text-gray-700 dark:text-gray-300 flex-1">{platform.tagline}</p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {platform.ctaHref ? (
          <a
            href={platform.ctaHref}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            {platform.ctaLabel}
          </a>
        ) : (
          <span className="px-4 py-2 text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-md">
            {platform.ctaLabel}
          </span>
        )}
        <a
          href={platform.guideHref}
          className="text-sm font-medium text-blue-600 dark:text-blue-400 underline hover:no-underline"
        >
          {platform.name} guide →
        </a>
      </div>
    </div>
  );
}
