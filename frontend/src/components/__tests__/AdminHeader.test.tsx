import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { AdminHeader } from '../admin/AdminHeader';

// Global cleanup runs from frontend/src/__tests__/setup.ts (afterEach hook).

describe('AdminHeader', () => {
  it('renders the title and the "← Admin" back link', () => {
    render(<AdminHeader title="Feedback Management" user={null} onLogout={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Feedback Management' })).toBeInTheDocument();
    const back = screen.getByRole('link', { name: 'Back to Admin' });
    expect(back).toHaveAttribute('href', '/admin/');
    expect(back).toHaveTextContent('← Admin');
  });

  it('renders the optional sibling link when provided', () => {
    render(
      <AdminHeader
        title="Publishers Management"
        siblingLink={{ href: '/admin/publisher-events/', label: 'Publisher events →' }}
        user={null}
        onLogout={() => {}}
      />,
    );
    const link = screen.getByRole('link', { name: 'Publisher events →' });
    expect(link).toHaveAttribute('href', '/admin/publisher-events/');
  });

  it('omits the sibling link when not provided', () => {
    render(<AdminHeader title="Feedback Management" user={null} onLogout={() => {}} />);
    // Only the "← Admin" link should be present.
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName('Back to Admin');
  });

  it('uses ariaLabel override on the sibling link when provided', () => {
    render(
      <AdminHeader
        title="Publisher Events"
        siblingLink={{
          href: '/admin/publishers/',
          label: '← Publishers',
          ariaLabel: 'Go to Publisher Management',
        }}
        user={null}
        onLogout={() => {}}
      />,
    );
    expect(
      screen.getByRole('link', { name: 'Go to Publisher Management' }),
    ).toHaveAttribute('href', '/admin/publishers/');
  });

  it('renders the email and logout button when user is non-null', () => {
    render(
      <AdminHeader
        title="Feedback Management"
        user={{ email: 'someone@example.com' }}
        onLogout={() => {}}
      />,
    );
    expect(screen.getByText('someone@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
  });

  it('omits the email/logout block when user is null', () => {
    render(<AdminHeader title="Feedback Management" user={null} onLogout={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument();
  });

  it('calls onLogout when the logout button is clicked', () => {
    const onLogout = vi.fn();
    render(
      <AdminHeader
        title="Feedback Management"
        user={{ email: 'a@b.com' }}
        onLogout={onLogout}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('renders children between the dev-mode pill and the email/logout pair', () => {
    render(
      <AdminHeader
        title="Feedback Management"
        user={{ email: 'a@b.com' }}
        onLogout={() => {}}
      >
        <div data-testid="extras">12 items</div>
      </AdminHeader>,
    );
    const extras = screen.getByTestId('extras');
    expect(extras).toBeInTheDocument();
    // Extras must precede the email span in document order so the
    // visual ordering (dev pill → extras → email → logout) is preserved.
    const email = screen.getByText('a@b.com');
    expect(extras.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('applies break-words (not break-all) to the email span', () => {
    render(
      <AdminHeader
        title="Feedback Management"
        user={{ email: 'someone@example.com' }}
        onLogout={() => {}}
      />,
    );
    const email = screen.getByText('someone@example.com');
    expect(email.className).toMatch(/\bbreak-words\b/);
    expect(email.className).not.toMatch(/\bbreak-all\b/);
  });
});
