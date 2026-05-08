import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { Modal } from '../Modal';

// Global cleanup runs from frontend/src/__tests__/setup.ts (afterEach hook).

describe('Modal', () => {
  it('renders content with role=dialog and aria-labelledby', () => {
    render(
      <Modal onClose={() => {}} titleId="t-1">
        <h3 id="t-1">My title</h3>
        <p>body</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 't-1');
    expect(screen.getByText('My title')).toBeInTheDocument();
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} titleId="t-2">
        <h3 id="t-2">Heading</h3>
        <button>OK</button>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on Escape when closeOnEsc=false', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} titleId="t-3" closeOnEsc={false}>
        <h3 id="t-3">Heading</h3>
        <button>OK</button>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('focuses the first focusable child on mount', () => {
    render(
      <Modal onClose={() => {}} titleId="t-4">
        <h3 id="t-4">Heading</h3>
        <input data-testid="first-input" />
        <button>OK</button>
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByTestId('first-input'));
  });

  it('wraps Tab focus from last to first', () => {
    render(
      <Modal onClose={() => {}} titleId="t-5">
        <h3 id="t-5">Heading</h3>
        <input data-testid="first" />
        <button data-testid="last">Last</button>
      </Modal>,
    );
    const first = screen.getByTestId('first');
    const last = screen.getByTestId('last');
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab focus from first to last', () => {
    render(
      <Modal onClose={() => {}} titleId="t-6">
        <h3 id="t-6">Heading</h3>
        <input data-testid="first" />
        <button data-testid="last">Last</button>
      </Modal>,
    );
    const first = screen.getByTestId('first');
    const last = screen.getByTestId('last');
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('restores focus to the previously-focused element on unmount', () => {
    // Render an outer button outside the modal, focus it, then mount the
    // modal. Unmount should return focus to the outer button.
    const Wrapper = ({ open }: { open: boolean }) => (
      <>
        <button data-testid="outside">Outside</button>
        {open && (
          <Modal onClose={() => {}} titleId="t-7">
            <h3 id="t-7">Heading</h3>
            <input />
          </Modal>
        )}
      </>
    );
    const { rerender } = render(<Wrapper open={false} />);
    const outside = screen.getByTestId('outside');
    outside.focus();
    expect(document.activeElement).toBe(outside);

    rerender(<Wrapper open={true} />);
    // First focusable inside modal should now have focus.
    expect(document.activeElement).not.toBe(outside);

    rerender(<Wrapper open={false} />);
    expect(document.activeElement).toBe(outside);
  });

  it('does NOT close on backdrop click by default', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} titleId="t-bd-default">
        <h3 id="t-bd-default">Heading</h3>
        <button>OK</button>
      </Modal>,
    );
    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on backdrop click when closeOnBackdropClick=true', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} titleId="t-bd-on" closeOnBackdropClick>
        <h3 id="t-bd-on">Heading</h3>
        <button>OK</button>
      </Modal>,
    );
    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close when click originates inside the dialog card with closeOnBackdropClick=true', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} titleId="t-bd-inside" closeOnBackdropClick>
        <h3 id="t-bd-inside">Heading</h3>
        <button data-testid="inside">OK</button>
      </Modal>,
    );
    fireEvent.click(screen.getByTestId('inside'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
