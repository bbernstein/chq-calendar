import { useState, useEffect } from 'react';
import { YearSelector } from '@/components/layout/YearSelector';
import { HeaderMenu, newTabLabel, type HeaderMenuItem } from '@/components/layout/HeaderMenu';
import { quickLinks, inAppLinks, externalLinks, type QuickLink } from '@/lib/quickLinks';
import { APP_STORE_URL } from '@/lib/constants';
import { isAppPromoAvailable, readDeviceInfo } from '@/lib/iosPromo';
import { useSiteHeaderReveal } from '@/hooks/useSiteHeaderReveal';
import { siteHeaderTop } from '@/app/filterHeaderLayout';
import { FiltersIcon } from '@/components/filters/FiltersIcon';

/**
 * The Filters toggle, which lives here rather than on the day rail (#274
 * phase 3).
 *
 * The rail's version carried a `visible` flag — it only appeared once the
 * reader had scrolled past the in-flow filter card, because before that the
 * card was right there. There is no such flag here, and its absence is the
 * change: the panel is an overlay in every state, so the funnel is the only
 * way to it and must always be present. Reachability comes from the header
 * itself, which returns on any upward flick (#272).
 */
export interface HeaderFiltersToggleProps {
  /** Whether the panel is currently open — drives `aria-expanded`. */
  open: boolean;
  onToggle: () => void;
  /** The panel's element id, for `aria-controls`. */
  panelId: string;
  /** `useFilterPanel`'s `toggleRef`, so Escape can return focus here. */
  toggleRef: (el: HTMLButtonElement | null) => void;
  /**
   * Whether to paint the active-filter dot: true once the reader has narrowed
   * the list themselves. `useFilterState.hasFilters` is exactly that now —
   * it used to also count the default `next` date scope, so the dot needed a
   * separate flag to avoid being lit for every reader before they touched
   * anything (#274 phase 4 deleted the scopes and collapsed the two).
   */
  hasActiveFilters: boolean;
}

interface HeaderProps {
  selectedYear: number;
  availableYears: number[];
  defaultYear: number;
  onYearChange: (year: number) => void;
  /**
   * Optional: a header without a filter panel is a valid header. `page.tsx` is
   * the only caller that has one today, and that is not a reason to make every
   * future caller invent one.
   */
  filtersToggle?: HeaderFiltersToggleProps;
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

export function Header({
  selectedYear, availableYears, defaultYear, onYearChange, filtersToggle,
}: HeaderProps) {
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
  //
  // An open filter panel holds it revealed. The panel is a fixed overlay
  // hanging off this header's bottom edge, so a header that hid out from under
  // it would leave it floating against nothing. The release is one-directional
  // — see the hook's "Holding it open".
  const { revealed, headerRef } = useSiteHeaderReveal({
    holdRevealed: filtersToggle?.open ?? false,
  });

  return (
    /*
      Sticky with a negative `top`, never fixed: the header stays in flow, so
      document height never changes and the scroll-anchoring loop documented
      in `filterHeaderLayout.ts` has nothing to correct. `z-40` is the top of
      the stack — above the filter panel's `z-30`, the day rail's `z-20` and
      the day titles' `z-10`, all three of which ride down by this header's
      measured height while it is revealed.

      `inert` while parked is not cosmetic. The header is still in the DOM and
      still in flow, so a keyboard reader would tab into it and the browser
      would chase a focused control it cannot scroll into view — the trap
      `filterHeaderLayout.ts` records for the filter card that used to be
      parked the same way.
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
      // `overflow-hidden` while parked, for the same reason the shadow goes:
      // an open dropdown is positioned OUTSIDE the header's border box, so
      // parking the box left the menu behind. Measured in Chromium after
      // opening the "more" menu and scrolling down — header at `bottom: 0` and
      // `inert`, its menu still occupying -4 → 258, a panel over most of the
      // screen at `z-40` that nothing could click. The menu stays OPEN: it
      // belongs to the header, and scrolling back up should find it where the
      // reader left it.
      className={`sticky z-40 bg-white dark:bg-gray-800 ${revealed ? 'shadow-lg' : 'overflow-hidden'}`}
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

          {/*
            One flex child holding the funnel and whichever link cluster the
            breakpoint shows, so the row's `justify-between` still has exactly
            two children — and so the funnel renders ONCE at every width rather
            than being duplicated into both clusters.
          */}
          <div className="flex items-center gap-2">
            {filtersToggle && (
              <button
                type="button"
                ref={filtersToggle.toggleRef}
                // The accessible name is the label, not the icon: FiltersIcon's
                // SVG and its dot are both `aria-hidden`, so this is what a
                // screen reader announces. It is unchanged from the rail's
                // version deliberately — readers have already learned this
                // control, and moving it is enough of a change on its own.
                aria-label="Filters"
                title="Filters"
                aria-expanded={filtersToggle.open}
                aria-controls={filtersToggle.panelId}
                onClick={filtersToggle.onToggle}
                // 44px square, the platform minimum, on the only route to the
                // filters. `inline-flex` + centring because a `min-h` on a
                // plain inline-block button leaves the icon top-aligned in the
                // taller box.
                className="shrink-0 inline-flex min-h-11 min-w-11 items-center justify-center px-2 py-1 rounded-md bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-gray-600"
              >
                <FiltersIcon active={filtersToggle.hasActiveFilters} />
              </button>
            )}

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
      </div>
    </header>
  );
}
