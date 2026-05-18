/// <reference types="vitest/globals" />
import { render, screen, fireEvent, act } from '@testing-library/preact';
import { WeekBadge } from '@/components/calendar/WeekBadge';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';

const themes: Record<number, WeekTheme> = {
  1: { number: 1, title: 'Icons and Instigators', description: '', startDate: '2026-06-27', endDate: '2026-07-04' },
  2: { number: 2, title: 'Breaking the News', description: '', startDate: '2026-07-04', endDate: '2026-07-11' },
  4: { number: 4, title: 'Wasted', description: '', startDate: '2026-07-18', endDate: '2026-07-25' },
};

describe('WeekBadge', () => {
  it('renders "Week 4" for a single-week day', () => {
    render(<WeekBadge weekNumbers={[4]} themes={themes} />);
    expect(screen.getByText('Week 4')).toBeInTheDocument();
  });

  it('renders "Week 1/2" for a Saturday spanning two weeks', () => {
    render(<WeekBadge weekNumbers={[1, 2]} themes={themes} />);
    expect(screen.getByText('Week 1/2')).toBeInTheDocument();
  });

  it('renders nothing when weekNumbers is empty', () => {
    const { container } = render(<WeekBadge weekNumbers={[]} themes={themes} />);
    expect(container.textContent).toBe('');
  });

  it('exposes the theme(s) via the title attribute on hover', () => {
    render(<WeekBadge weekNumbers={[1, 2]} themes={themes} />);
    const label = screen.getByText('Week 1/2');
    const title = label.getAttribute('title') ?? '';
    expect(title).toContain('Icons and Instigators');
    expect(title).toContain('Breaking the News');
  });

  it('opens a popover listing both themes when clicked on a Saturday', () => {
    render(<WeekBadge weekNumbers={[1, 2]} themes={themes} />);
    fireEvent.click(screen.getByText('Week 1/2'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Icons and Instigators');
    expect(dialog).toHaveTextContent('Breaking the News');
  });

  it('opens a popover with only the one theme when clicked on a non-Saturday', () => {
    render(<WeekBadge weekNumbers={[4]} themes={themes} />);
    fireEvent.click(screen.getByText('Week 4'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Wasted');
    expect(dialog).not.toHaveTextContent('Icons and Instigators');
  });

  it('opens the popover when Enter is pressed and themes are loaded', () => {
    render(<WeekBadge weekNumbers={[4]} themes={themes} />);
    const label = screen.getByText('Week 4');
    label.focus();
    fireEvent.keyDown(label, { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens the popover when Space is pressed and themes are loaded', () => {
    render(<WeekBadge weekNumbers={[4]} themes={themes} />);
    const label = screen.getByText('Week 4');
    label.focus();
    fireEvent.keyDown(label, { key: ' ' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes the popover when the badge itself is clicked again', () => {
    render(<WeekBadge weekNumbers={[4]} themes={themes} />);
    const label = screen.getByText('Week 4');
    fireEvent.click(label);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.mouseDown(label);
    fireEvent.click(label);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the popover open across the synthetic click that follows a long-press touch', () => {
    vi.useFakeTimers();
    try {
      render(<WeekBadge weekNumbers={[4]} themes={themes} />);
      const label = screen.getByText('Week 4');

      fireEvent.touchStart(label);
      act(() => { vi.advanceTimersByTime(600); });
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      fireEvent.touchEnd(label);
      fireEvent.click(label);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not behave as a clickable button when no themes are loaded', () => {
    render(<WeekBadge weekNumbers={[4]} themes={{}} />);
    fireEvent.click(screen.getByText('Week 4'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
