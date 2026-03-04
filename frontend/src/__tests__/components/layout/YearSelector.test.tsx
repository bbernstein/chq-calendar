import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { YearSelector } from '@/components/layout/YearSelector';

describe('YearSelector', () => {
  const defaultProps = {
    selectedYear: 2026,
    availableYears: [2027, 2026, 2025],
    defaultYear: 2026,
    onYearChange: vi.fn(),
  };

  it('renders the selected year with "Season" label', () => {
    const { getByText } = render(<YearSelector {...defaultProps} />);
    expect(getByText(/2026 Season/)).toBeTruthy();
  });

  it('opens dropdown on click', () => {
    const { getByRole, getByText } = render(<YearSelector {...defaultProps} />);
    fireEvent.click(getByRole('button'));
    expect(getByText('2025 Season')).toBeTruthy();
    expect(getByText('2027 Season')).toBeTruthy();
  });

  it('calls onYearChange when a year is selected', () => {
    const onYearChange = vi.fn();
    const { getByRole, getAllByRole } = render(
      <YearSelector {...defaultProps} onYearChange={onYearChange} />
    );
    fireEvent.click(getByRole('button'));
    const menuitems = getAllByRole('menuitem');
    const menuitem2025 = menuitems.find(o => o.textContent?.includes('2025'));
    if (menuitem2025) fireEvent.click(menuitem2025);
    expect(onYearChange).toHaveBeenCalledWith(2025);
  });

  it('closes dropdown after selection', () => {
    const { getByRole, queryByRole } = render(<YearSelector {...defaultProps} />);
    fireEvent.click(getByRole('button'));
    expect(queryByRole('menu')).toBeTruthy();
    const menuitems = document.querySelectorAll('[role="menuitem"]');
    if (menuitems[0]) fireEvent.click(menuitems[0]);
    expect(queryByRole('menu')).toBeNull();
  });

  it('shows "(current)" label next to default year', () => {
    const { getByRole, getByText } = render(<YearSelector {...defaultProps} />);
    fireEvent.click(getByRole('button'));
    expect(getByText(/current/)).toBeTruthy();
  });

  it('does not open dropdown when only one year is available', () => {
    const { getByRole, queryByRole } = render(
      <YearSelector
        selectedYear={2026}
        availableYears={[2026]}
        defaultYear={2026}
        onYearChange={vi.fn()}
      />
    );
    fireEvent.click(getByRole('button'));
    expect(queryByRole('menu')).toBeNull();
  });

  it('closes dropdown on Escape key', () => {
    const { getByRole, queryByRole } = render(<YearSelector {...defaultProps} />);
    fireEvent.click(getByRole('button'));
    expect(queryByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByRole('menu')).toBeNull();
  });

  it('closes dropdown on outside click', () => {
    const { getByRole, queryByRole } = render(<YearSelector {...defaultProps} />);
    fireEvent.click(getByRole('button'));
    expect(queryByRole('menu')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(queryByRole('menu')).toBeNull();
  });

  it('marks the selected year with aria-current', () => {
    const { getByRole, getAllByRole } = render(<YearSelector {...defaultProps} />);
    fireEvent.click(getByRole('button'));
    const menuitems = getAllByRole('menuitem');
    const selected2026 = menuitems.find(o => o.textContent?.includes('2026'));
    expect(selected2026?.getAttribute('aria-current')).toBe('true');
    const unselected2025 = menuitems.find(o => o.textContent?.includes('2025'));
    expect(unselected2025?.getAttribute('aria-current')).toBeNull();
  });

  it('sorts years in descending order', () => {
    const { getByRole, getAllByRole } = render(
      <YearSelector
        selectedYear={2026}
        availableYears={[2025, 2027, 2026]}
        defaultYear={2026}
        onYearChange={vi.fn()}
      />
    );
    fireEvent.click(getByRole('button'));
    const menuitems = getAllByRole('menuitem');
    const years = menuitems.map(o => o.textContent?.replace(/[^0-9]/g, '').slice(0, 4));
    expect(years).toEqual(['2027', '2026', '2025']);
  });
});
