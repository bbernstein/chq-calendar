import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/preact';
import { Header } from '../Header';
import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';
import { quickLinks, inAppLinks, externalLinks } from '@/lib/quickLinks';
import { APP_STORE_URL } from '@/lib/constants';

// Global cleanup runs from frontend/src/__tests__/setup.ts (afterEach hook).

const defaultProps = {
  selectedYear: 2026,
  availableYears: [2026],
  defaultYear: 2026,
  onYearChange: () => {},
};

// Both the desktop row and the mobile menu are always in the DOM under jsdom
// — Tailwind's `hidden lg:flex` / `lg:hidden` are CSS, not conditional
// rendering — so queries have to be scoped to one or the other.
const desktop = () => within(screen.getByTestId('header-desktop'));
const mobile = () => within(screen.getByTestId('header-mobile'));

vi.mock('@/lib/iosPromo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/iosPromo')>()),
  isAppPromoAvailable: vi.fn(() => false),
}));

const { isAppPromoAvailable } = await import('@/lib/iosPromo');
const promoAvailable = (available: boolean) => {
  vi.mocked(isAppPromoAvailable).mockReturnValue(available);
};

afterEach(() => {
  vi.restoreAllMocks();
  promoAvailable(false);
});

describe('Header desktop layout', () => {
  // #228: the desktop row wrapped to a second line between roughly 1024px and
  // 1150px. jsdom computes no layout, so the guard is structural: the row must
  // not be allowed to wrap, and it must hold few enough controls not to need to.
  it('does not permit the control row to wrap', () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByTestId('header-desktop').className).not.toContain('flex-wrap');
  });

  it('shows only the in-app routes and one menu trigger as direct controls', () => {
    render(<Header {...defaultProps} />);

    const controls = desktop().getAllByRole('link').map((el) => el.textContent?.trim());
    expect(controls).toEqual(['Guide', 'Feedback']);
    expect(desktop().getByRole('button', { name: /Chautauqua/ })).toBeInTheDocument();
  });

  it.each(inAppLinks)('links directly to $title', (link) => {
    render(<Header {...defaultProps} />);

    const anchor = desktop().getByRole('link', { name: `${link.title} (opens in a new tab)` });
    expect(anchor).toHaveAttribute('href', link.webPath ?? link.url);
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('keeps the external Chautauqua destinations out of the row until opened', () => {
    render(<Header {...defaultProps} />);

    for (const link of externalLinks) {
      expect(desktop().queryByRole('link', { name: new RegExp(link.title) })).toBeNull();
    }
  });

  it.each(externalLinks)('reveals $title inside the Chautauqua menu', (link) => {
    render(<Header {...defaultProps} />);

    fireEvent.click(desktop().getByRole('button', { name: /Chautauqua/ }));

    const anchor = desktop().getByRole('link', { name: `${link.title} (opens in a new tab)` });
    expect(anchor).toHaveAttribute('href', link.url);
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('Header mobile menu', () => {
  it.each(quickLinks)('lists $title in the More menu', (link) => {
    render(<Header {...defaultProps} />);

    fireEvent.click(mobile().getByRole('button', { name: /More/ }));

    const anchor = mobile().getByRole('link', { name: `${link.title} (opens in a new tab)` });
    expect(anchor).toHaveAttribute('href', link.webPath ?? link.url);
  });

  it('keeps the menu collapsed until the trigger is used', () => {
    render(<Header {...defaultProps} />);

    expect(mobile().queryAllByRole('link')).toHaveLength(0);
    expect(mobile().getByRole('button', { name: /More/ })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Header app promo', () => {
  it('omits "Get the app" on devices that cannot run it', () => {
    render(<Header {...defaultProps} />);

    fireEvent.click(desktop().getByRole('button', { name: /Chautauqua/ }));
    fireEvent.click(mobile().getByRole('button', { name: /More/ }));

    expect(screen.queryByRole('link', { name: /Get the app/ })).toBeNull();
  });

  it('offers "Get the app" at the top of both menus on eligible devices', () => {
    promoAvailable(true);
    render(<Header {...defaultProps} />);

    // Scoped to the revealed panel, not the whole cluster: on desktop the
    // Guide and Feedback anchors sit outside the menu and precede it.
    const openPanel = (trigger: HTMLElement) => {
      fireEvent.click(trigger);
      const panel = document.getElementById(trigger.getAttribute('aria-controls')!);
      expect(panel).not.toBeNull();
      return within(panel!);
    };

    const panels = [
      openPanel(desktop().getByRole('button', { name: /Chautauqua/ })),
      openPanel(mobile().getByRole('button', { name: /More/ })),
    ];

    for (const panel of panels) {
      const links = panel.getAllByRole('link');
      expect(links[0]).toHaveTextContent('Get the app');
      expect(links[0]).toHaveAttribute('href', APP_STORE_URL);
      // Set apart from the links below it — it is neither an app route nor a
      // Chautauqua resource.
      expect(panel.getByRole('separator')).toBeInTheDocument();
    }
  });
});

describe('Header season pill', () => {
  // #228: when the right-hand controls grew, the left cluster compressed and
  // "2026 Season" broke between the two words.
  it('never breaks the season label mid-phrase', () => {
    render(<Header {...defaultProps} />);

    expect(screen.getByRole('button', { name: /2026 Season/ }).className).toContain('whitespace-nowrap');
  });

  // The pill is what must hold its width; the title absorbs the squeeze
  // instead. Pinning the whole cluster at its natural width just moves the
  // failure from a broken pill to a header that overflows below ~350px.
  it('holds the season pill at its natural width', () => {
    render(<Header {...defaultProps} />);

    const pill = screen.getByRole('button', { name: /2026 Season/ });
    expect(pill.parentElement?.className).toContain('shrink-0');
  });

  it('lets the title truncate rather than push the header wider than the screen', () => {
    render(<Header {...defaultProps} />);

    expect(screen.getByRole('heading', { level: 1 }).className).toContain('truncate');
    expect(screen.getByTestId('header-identity').className).not.toContain('shrink-0');
  });
});

/**
 * The site header's reveal on scroll up (#272).
 *
 * The header is the only route to the "more" menu and the year selector, and
 * below the fold it used to be unreachable without scrolling the whole
 * document back to the top. What these pin is the composition that fixes it —
 * and, just as importantly, the composition that keeps the fix from
 * reintroducing the scroll-anchoring loop `filterHeaderLayout.ts` documents at
 * length.
 */

const siteHeader = () => document.querySelector('header') as HTMLElement;

/**
 * A scroll the READER made: the gesture that drives it, then the scroll it
 * produces.
 *
 * The wheel is not decoration. A bare `scroll` event is ignored on purpose —
 * see `useSiteHeaderReveal`, where a scroll with no gesture behind it is how
 * the browser's own anchoring corrections announce themselves, and hiding the
 * header on one of those was a measured bug.
 */
const scrollTo = (y: number) => act(() => {
  // The wheel carries a `deltaY`, as a real one always does. Without it this
  // is a horizontal wheel — the day rail scrolls sideways — which the hook is
  // right to ignore.
  window.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: y - window.scrollY }));
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
  window.dispatchEvent(new Event('scroll'));
});

const renderHeader = () => {
  installResizeObserverMock();
  return render(<Header {...defaultProps} availableYears={[2025, 2026]} />);
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty('--site-header-offset');
  document.documentElement.style.removeProperty('--site-header-h');
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
});

describe('Header — reveal on scroll up', () => {
  // The header rides up by exactly its own height and pins there, which
  // parks it just above the viewport. When the offset is restored the same
  // `top` puts it flush at 0 — one expression, both states.
  it('parks itself above the viewport by its own height', () => {
    renderHeader();
    expect(siteHeader().style.top)
      .toBe('calc(var(--site-header-offset, 0px) - var(--site-header-h, 0px))');
  });

  // This is the constraint that the whole approach turns on. Collapsing a
  // header by taking it OUT of flow changes document height above the reader;
  // scroll anchoring corrects for it, and the page becomes impossible to
  // scroll slowly — 40 wheel ticks advanced the page 0px in both Chromium and
  // WebKit. A sticky header never leaves flow, so document height is constant
  // by construction and there is nothing for scroll anchoring to undo.
  it('is sticky, so it never leaves the document flow', () => {
    renderHeader();
    expect(siteHeader().className).toContain('sticky');
    expect(siteHeader().className).not.toContain('fixed');
    expect(siteHeader().className).not.toContain('absolute');
  });

  // Above the filter/rail container's own `z-30`, or the revealed header
  // paints behind the rail it is supposed to be sitting on top of.
  it('stacks above the sticky filter header', () => {
    renderHeader();
    expect(siteHeader().className).toContain('z-40');
  });

  it('publishes its measured height for the rail to ride down by', () => {
    renderHeader();
    expect(document.documentElement.style.getPropertyValue('--site-header-h')).not.toBe('');
  });

  // A parked header is still in the DOM and still in flow, so it is
  // Tab-reachable. Without `inert` the browser would try to scroll a focused
  // control back into view — which it cannot do for a pinned sticky element,
  // so it chases the position instead. The identical trap is documented for
  // the filter card in `filterHeaderLayout.ts`.
  it('is inert and hidden from screen readers once parked', () => {
    renderHeader();
    expect(siteHeader().hasAttribute('inert')).toBe(false);

    scrollTo(1_000);
    expect(siteHeader().hasAttribute('inert')).toBe(true);
    expect(siteHeader().getAttribute('aria-hidden')).toBe('true');
  });

  it('is reachable again the moment it is revealed', () => {
    renderHeader();
    scrollTo(1_000);
    scrollTo(900);
    expect(siteHeader().hasAttribute('inert')).toBe(false);
    expect(siteHeader().hasAttribute('aria-hidden')).toBe(false);
  });

  // "The revealed header must carry the app title, the year selector, and the
  // 'more' menu — i.e. the whole existing header, not a reduced version."
  // Nothing in this change may quietly trade the reveal for a slimmer bar.
  it('carries the whole header, not a reduced version, when revealed', () => {
    renderHeader();
    scrollTo(1_000);
    scrollTo(900);

    expect(screen.getByText('CHQ Calendar')).toBeTruthy();
    // The season pill and the "more" menu are the two features the issue
    // names as unreachable; a reveal that dropped either would be no fix.
    expect(screen.getByRole('button', { name: /2026/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
  });
});
