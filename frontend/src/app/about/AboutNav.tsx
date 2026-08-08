/** Named `…Key` rather than `AboutPage` so it never reads as the page
 *  component of the same name exported from ./page.tsx. */
export type AboutPageKey = 'overview' | 'ios' | 'web';

const ITEMS: Array<{ key: AboutPageKey | 'support'; label: string; href: string }> = [
  { key: 'overview', label: 'Overview', href: '/about' },
  { key: 'ios', label: 'iPhone & iPad', href: '/about/iphone' },
  { key: 'web', label: 'Web', href: '/about/web' },
  { key: 'support', label: 'Support', href: '/support' },
];

export function AboutNav({ current }: { current: AboutPageKey }) {
  return (
    <nav aria-label="Guide sections" className="flex flex-wrap gap-1 sm:gap-2">
      {ITEMS.map((item) => {
        const isCurrent = item.key === current;
        return (
          <a
            key={item.key}
            href={item.href}
            aria-current={isCurrent ? 'page' : undefined}
            className={
              isCurrent
                ? 'px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white'
                : 'px-3 py-1.5 text-sm rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
            }
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
