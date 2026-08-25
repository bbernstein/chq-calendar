import { useState, useEffect } from 'react';
import { YearSelector } from '@/components/layout/YearSelector';
import { HeaderMenu, newTabLabel, type HeaderMenuItem } from '@/components/layout/HeaderMenu';
import { quickLinks, inAppLinks, externalLinks, type QuickLink } from '@/lib/quickLinks';
import { APP_STORE_URL } from '@/lib/constants';
import { isAppPromoAvailable, readDeviceInfo } from '@/lib/iosPromo';
import { useSiteHeaderReveal } from '@/hooks/useSiteHeaderReveal';
import { siteHeaderTop } from '@/app/filterHeaderLayout';

interface HeaderProps {
  selectedYear: number;
  availableYears: number[];
  defaultYear: number;
  onYearChange: (year: number) => void;
}

const toMenuItem = (link: QuickLink): HeaderMenuItem => ({
  id: link.id,
  title: link.title,
  // `webPath` keeps same-site destinations on localhost during development.
  href: link.webPath ?? link.url,
});

const APP_PROMO_ITEM: HeaderMenuItem = {
  id: 'get-the-app',
  title: 'Get the app',
  href: APP_STORE_URL,
  // Same tab: on iOS this hands off to the App Store app.
  newTab: false,
  setApart: true,
};

export function Header({ selectedYear, availableYears, defaultYear, onYearChange }: HeaderProps) {
  // Eligible iOS devices keep a persistent link to the app regardless of
  // whether the promo banner was dismissed. Detected in an effect so the first
  // paint is deterministic (and the link never flashes on desktop).
  const [appAvailable, setAppAvailable] = useState(false);

  useEffect(() => {
    setAppAvailable(isAppPromoAvailable(readDeviceInfo()));
  }, []);

  const promo = appAvailable ? [APP_PROMO_ITEM] : [];

  // Reveal on scroll up, hide on scroll down (#272). The header is the only
  // route to the "more" menu and the year selector, and below the fold it
  // used to be unreachable without scrolling the whole document back to the
  // top — from a rail tap, tens of thousands of pixels.
  const { revealed, headerRef } = useSiteHeaderReveal();

  return (
    /*
      Sticky with a negative `top`, never fixed: the header stays in flow, so
      document height never changes and the scroll-anchoring loop documented
      in `filterHeaderLayout.ts` has nothing to correct. `z-40` puts it above
      the filter/rail container's `z-30`, which rides down by this header's
      measured height while it is revealed.

      `inert` while parked is not cosmetic. The header is still in the DOM and
      still in flow, so a keyboard reader would tab into it and the browser
      would chase a focused control it cannot scroll into view — the same trap
      `filterCardParked` exists for.
    */
    <header
      ref={headerRef}
      data-site-header
      inert={!revealed || undefined}
      aria-hidden={!revealed || undefined}
      style={{ top: siteHeaderTop() }}
      // The shadow goes with the header. A shadow paints OUTSIDE the border
      // box, so parked — box entirely above the viewport — `shadow-lg`
      // (`0 10px 15px -3px`) still reached ~15px below it, and at `z-40` that
      // landed on the `z-30` rail. Measured by screenshotting the top 24px
      // with the header parked, with and without it: the images differ. A
      // hidden header was painting a grey band across the rail it yields to.
      className={`sticky z-40 bg-white dark:bg-gray-800 ${revealed ? 'shadow-lg' : ''}`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-2 sm:py-4">
          {/* The cluster stays shrinkable and the title truncates, so a narrow
              screen costs a few characters of the title rather than pushing
              the header wider than the viewport. What must NOT compress is
              the season pill (`shrink-0` on YearSelector) — squeezing that is
              what broke "2026 Season" across two lines. */}
          <div className="flex items-center min-w-0" data-testid="header-identity">
            <img
              src="/chq-calendar-icon-256.svg"
              alt="Chautauqua Calendar Logo"
              width={40}
              height={40}
              className="w-8 h-8 sm:w-10 sm:h-10 mr-2 sm:mr-3 shrink-0"
            />
            <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white truncate">
              CHQ Calendar
            </h1>
            <YearSelector
              selectedYear={selectedYear}
              availableYears={availableYears}
              defaultYear={defaultYear}
              onYearChange={onYearChange}
            />
          </div>

          {/* Desktop: this app's own routes stay as direct controls; the
              Chautauqua Institution's sites collapse into one menu. Three
              controls fit without wrapping, which is why there is no
              `flex-wrap` here — seven of them needed one and broke onto a
              second row between roughly 1024px and 1150px. */}
          <div className="hidden lg:flex items-center gap-2 justify-end" data-testid="header-desktop">
            {inAppLinks.map((link) => (
              <a
                key={link.id}
                href={link.webPath ?? link.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={newTabLabel(link.title)}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                {link.title}
              </a>
            ))}
            <HeaderMenu
              label="Chautauqua"
              ariaLabel="Chautauqua Institution sites"
              items={[...promo, ...externalLinks.map(toMenuItem)]}
            />
          </div>

          {/* Mobile: one flat list of everything, matching the iOS app's More
              menu. Seven items on a phone are not improved by section
              headers. */}
          <div className="lg:hidden" data-testid="header-mobile">
            <HeaderMenu
              label="More"
              ariaLabel="Site links"
              items={[...promo, ...quickLinks.map(toMenuItem)]}
              triggerClassName="px-2 py-1 text-xs"
            />
          </div>
        </div>
      </div>
    </header>
  );
}
