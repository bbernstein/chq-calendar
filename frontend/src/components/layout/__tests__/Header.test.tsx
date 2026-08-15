import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import { Header } from '../Header';
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
