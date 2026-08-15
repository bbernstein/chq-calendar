import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/preact';
import { HeaderMenu } from '../HeaderMenu';

// Global cleanup runs from frontend/src/__tests__/setup.ts (afterEach hook).

const items = [
  { id: 'programs', title: 'Programs', href: 'https://programs.chq.org/' },
  { id: 'captions', title: 'Captions', href: 'https://captions.chq.org/' },
];

afterEach(() => {
  vi.useRealTimers();
});

describe('HeaderMenu', () => {
  it('starts collapsed, with the trigger reporting its state', () => {
    render(<HeaderMenu label="Chautauqua" ariaLabel="Chautauqua links" items={items} />);

    const trigger = screen.getByRole('button', { name: /Chautauqua/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: /Programs/ })).toBeNull();
  });

  it('reveals the items and flips aria-expanded when opened', () => {
    render(<HeaderMenu label="Chautauqua" ariaLabel="Chautauqua links" items={items} />);

    fireEvent.click(screen.getByRole('button', { name: /Chautauqua/ }));

    expect(screen.getByRole('button', { name: /Chautauqua/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: /Programs/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Captions/ })).toBeInTheDocument();
  });

  it('points aria-controls at the container it reveals', () => {
    render(<HeaderMenu label="Chautauqua" ariaLabel="Chautauqua links" items={items} />);
    const trigger = screen.getByRole('button', { name: /Chautauqua/ });
    fireEvent.click(trigger);

    const controls = trigger.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    const container = document.getElementById(controls!);
    expect(container).not.toBeNull();
    expect(container).toContainElement(screen.getByRole('link', { name: /Programs/ }));
  });

  // #219: these are navigation destinations, so they must announce as links
  // and carry the new-tab warning rather than being unlabelled buttons.
  it('renders each item as a new-tab link that announces itself as one', () => {
    render(<HeaderMenu label="Chautauqua" ariaLabel="Chautauqua links" items={items} />);
    fireEvent.click(screen.getByRole('button', { name: /Chautauqua/ }));

    const programs = screen.getByRole('link', { name: 'Programs (opens in a new tab)' });
    expect(programs).toHaveAttribute('href', 'https://programs.chq.org/');
    expect(programs).toHaveAttribute('target', '_blank');
    expect(programs).toHaveAttribute('rel', 'noopener noreferrer');
  });

  // The App Store link is the exception: on iOS it hands off to the App Store
  // app, so forcing a new tab strands an empty one behind it.
  it('leaves a `newTab: false` item in the current tab, with no new-tab warning', () => {
    render(
      <HeaderMenu
        label="More"
        ariaLabel="More links"
        items={[{ id: 'app', title: 'Get the app', href: 'https://apps.apple.com/x', newTab: false }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /More/ }));

    const link = screen.getByRole('link', { name: 'Get the app' });
    expect(link).not.toHaveAttribute('target');
    expect(link).not.toHaveAttribute('rel');
  });

  it('closes on Escape', () => {
    render(<HeaderMenu label="Chautauqua" ariaLabel="Chautauqua links" items={items} />);
    fireEvent.click(screen.getByRole('button', { name: /Chautauqua/ }));

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('link', { name: /Programs/ })).toBeNull();
  });

  it('closes when a click lands outside it', () => {
    render(
      <div>
        <HeaderMenu label="Chautauqua" ariaLabel="Chautauqua links" items={items} />
        <button>elsewhere</button>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Chautauqua/ }));

    fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }));

    expect(screen.queryByRole('link', { name: /Programs/ })).toBeNull();
  });

  // Unmounting an anchor from inside its own click handler can cancel the
  // navigation it just started, so the close has to wait for the next task.
  it('keeps a clicked link mounted until after the click has been handled', () => {
    vi.useFakeTimers();
    render(<HeaderMenu label="Chautauqua" ariaLabel="Chautauqua links" items={items} />);
    fireEvent.click(screen.getByRole('button', { name: /Chautauqua/ }));

    fireEvent.click(screen.getByRole('link', { name: /Programs/ }));
    expect(screen.getByRole('link', { name: /Programs/ })).toBeInTheDocument();

    act(() => { vi.runAllTimers(); });
    expect(screen.queryByRole('link', { name: /Programs/ })).toBeNull();
  });

  it('does not leave a pending close timer behind when unmounted mid-click', () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <HeaderMenu label="Chautauqua" ariaLabel="Chautauqua links" items={items} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Chautauqua/ }));
    fireEvent.click(screen.getByRole('link', { name: /Programs/ }));

    unmount();

    expect(() => act(() => { vi.runAllTimers(); })).not.toThrow();
  });

  it('sets a `setApart` item off from the rest with a separator', () => {
    render(
      <HeaderMenu
        label="More"
        ariaLabel="More links"
        items={[{ id: 'app', title: 'Get the app', href: 'https://apps.apple.com/x', setApart: true }, ...items]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /More/ }));

    expect(screen.getByRole('link', { name: /Get the app/ })).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('renders no separator when nothing is set apart', () => {
    render(<HeaderMenu label="Chautauqua" ariaLabel="Chautauqua links" items={items} />);
    fireEvent.click(screen.getByRole('button', { name: /Chautauqua/ }));

    expect(screen.queryByRole('separator')).toBeNull();
  });
});
