import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { FilterPanelCaret } from '@/components/filters/FilterPanelCaret';

describe('FilterPanelCaret', () => {
  // D4: "a centred downward caret that closes it on tap." The accessible
  // name is what a screen-reader user acts on, so this is a name-based
  // query, not a class or testid lookup.
  it('is a button named "Hide filters" that calls onClose when tapped', () => {
    const onClose = vi.fn();
    render(<FilterPanelCaret onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide filters' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // jsdom implements no layout, so the actual rendered box (>=44px tall,
  // full panel width) cannot be measured here — that half is Task 6's
  // Playwright pass. This pins the classes that are supposed to produce it:
  // `h-11` is Tailwind's 44px, `w-full` is the panel's full width.
  it('carries the classes for a >=44px, full-width hit area', () => {
    render(<FilterPanelCaret onClose={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Hide filters' });
    expect(button.className).toMatch(/\bh-11\b/);
    expect(button.className).toMatch(/\bw-full\b/);
  });
});
