import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { PublisherForm } from '../../../app/admin/publishers/PublisherForm';
import type { PublisherRecord } from '@/lib/adminPublisherApi';

function makePublisher(overrides: Partial<PublisherRecord> = {}): PublisherRecord {
  return {
    id: 'test-publisher',
    name: 'Test Publisher',
    contactEmail: 'test@example.com',
    sourceUrl: 'https://example.com/events.json',
    sourceType: 'json',
    trustLevel: 'auto',
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('PublisherForm — create mode', () => {
  it('renders all fields with empty defaults and trustLevel=review', () => {
    render(<PublisherForm onCancel={vi.fn()} onSubmit={vi.fn()} />);

    const idInput = screen.getByLabelText(/^ID/i) as HTMLInputElement;
    expect(idInput.value).toBe('');
    expect(idInput.disabled).toBe(false);

    const trustSelect = screen.getByLabelText(/trust level/i) as HTMLSelectElement;
    expect(trustSelect.value).toBe('review');

    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
  });

  it('calls onSubmit with correct CreatePublisherInput shape', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PublisherForm onCancel={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.input(screen.getByLabelText(/^ID/i), { target: { value: 'my-pub' } });
    fireEvent.input(screen.getByLabelText(/^Name/i), { target: { value: 'My Publisher' } });
    fireEvent.input(screen.getByLabelText(/Contact Email/i), {
      target: { value: 'contact@example.com' },
    });
    fireEvent.input(screen.getByLabelText(/Source URL/i), {
      target: { value: 'https://example.com/feed.json' },
    });

    fireEvent.submit(screen.getByRole('button', { name: 'Create' }).closest('form')!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const arg = onSubmit.mock.calls[0][0];
    expect(arg.id).toBe('my-pub');
    expect(arg.name).toBe('My Publisher');
    expect(arg.contactEmail).toBe('contact@example.com');
    expect(arg.sourceUrl).toBe('https://example.com/feed.json');
    expect(arg.sourceType).toBe('json');
    expect(arg.trustLevel).toBe('review');
  });
});

describe('PublisherForm — edit mode', () => {
  it('renders with initial values and id input is disabled', () => {
    const publisher = makePublisher();
    render(<PublisherForm initial={publisher} onCancel={vi.fn()} onSubmit={vi.fn()} />);

    const idInput = screen.getByLabelText(/^ID/i) as HTMLInputElement;
    expect(idInput.value).toBe('test-publisher');
    expect(idInput.disabled).toBe(true);

    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('calls onSubmit with patch fields (no id)', async () => {
    const publisher = makePublisher();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PublisherForm initial={publisher} onCancel={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.input(screen.getByLabelText(/^Name/i), { target: { value: 'Updated Name' } });

    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const arg = onSubmit.mock.calls[0][0];
    expect(arg.name).toBe('Updated Name');
    // Patch shape should NOT include id
    expect(arg.id).toBeUndefined();
  });
});

describe('PublisherForm — cancel', () => {
  it('calls onCancel when Cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<PublisherForm onCancel={onCancel} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('PublisherForm — submit error', () => {
  it('renders error message and keeps form open on submit failure', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Network failure'));
    render(<PublisherForm onCancel={vi.fn()} onSubmit={onSubmit} />);

    // Fill required fields so the form can actually submit
    fireEvent.input(screen.getByLabelText(/^ID/i), { target: { value: 'x' } });
    fireEvent.input(screen.getByLabelText(/^Name/i), { target: { value: 'X' } });
    fireEvent.input(screen.getByLabelText(/Contact Email/i), {
      target: { value: 'x@x.com' },
    });
    fireEvent.input(screen.getByLabelText(/Source URL/i), {
      target: { value: 'https://x.com' },
    });

    fireEvent.submit(screen.getByRole('button', { name: 'Create' }).closest('form')!);

    await waitFor(() => expect(screen.getByText('Network failure')).toBeTruthy());

    // Form must still be present
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
  });
});
