import { describe, it, expect, vi, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { SourceEditPanel, type SourceEditPanelProps } from '../SourceEditPanel';

type PreviewFn = SourceEditPanelProps['onPreview'];
type SaveFn = SourceEditPanelProps['onSave'];
type CancelFn = SourceEditPanelProps['onCancel'];

function renderPanel(overrides: {
  onPreview?: Mock | PreviewFn;
  onSave?: Mock | SaveFn;
  onCancel?: Mock | CancelFn;
} = {}) {
  const onPreview: PreviewFn =
    (overrides.onPreview as PreviewFn | undefined) ??
    (vi.fn().mockResolvedValue({ ok: true, summary: 'Validated 3 events.' }) as unknown as PreviewFn);
  const onSave: SaveFn =
    (overrides.onSave as SaveFn | undefined) ??
    (vi.fn().mockResolvedValue(undefined) as unknown as SaveFn);
  const onCancel: CancelFn =
    (overrides.onCancel as CancelFn | undefined) ?? (vi.fn() as unknown as CancelFn);
  render(
    <SourceEditPanel
      currentUrl="https://example.com/feed.json"
      currentType="json"
      onPreview={onPreview}
      onSave={onSave}
      onCancel={onCancel}
    />,
  );
  return { onPreview, onSave, onCancel };
}

describe('SourceEditPanel', () => {
  it('renders prefilled with current URL and sourceType', () => {
    renderPanel();
    const url = screen.getByLabelText('Source URL') as HTMLInputElement;
    expect(url.value).toBe('https://example.com/feed.json');
    const jsonRadio = screen.getByLabelText('JSON') as HTMLInputElement;
    expect(jsonRadio.checked).toBe(true);
  });

  it('Save is disabled initially (no preview yet)', () => {
    renderPanel();
    const save = screen.getByText('Save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('after a passing Preview, Save becomes enabled', async () => {
    renderPanel();
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(screen.getByText('Preview passed')).toBeTruthy());
    const save = screen.getByText('Save') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it('changing the URL after a passing Preview re-disables Save until Preview re-runs', async () => {
    renderPanel();
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(screen.getByText('Preview passed')).toBeTruthy());
    fireEvent.input(screen.getByLabelText('Source URL'), {
      target: { value: 'https://other.example/feed.json' },
    });
    const save = screen.getByText('Save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // Preview again with new value:
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(save.disabled).toBe(false));
  });

  it('changing the sourceType after a passing Preview re-disables Save', async () => {
    renderPanel();
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(screen.getByText('Preview passed')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('HTML'));
    const save = screen.getByText('Save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('preview failure renders the error list and leaves Save disabled', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      ok: false,
      errors: ['feed publisher.id mismatch', 'venue is required'],
    });
    renderPanel({ onPreview });
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(screen.getByText('Preview failed')).toBeTruthy());
    expect(screen.getByText('feed publisher.id mismatch')).toBeTruthy();
    expect(screen.getByText('venue is required')).toBeTruthy();
    const save = screen.getByText('Save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('Save dispatches onSave with the previewed URL/type', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { onPreview } = renderPanel({ onSave });
    fireEvent.input(screen.getByLabelText('Source URL'), {
      target: { value: 'https://new.example/feed.json' },
    });
    fireEvent.click(screen.getByLabelText('HTML'));
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(onPreview).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith('https://new.example/feed.json', 'html'),
    );
  });

  it('Save error from rejected onSave promise is rendered', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Server is down'));
    renderPanel({ onSave });
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(screen.getByText('Preview passed')).toBeTruthy());
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByText('Server is down')).toBeTruthy());
  });

  it('Cancel calls onCancel', () => {
    const { onCancel } = renderPanel();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('Preview button shows "Previewing…" while pending', async () => {
    let resolvePreview: (v: { ok: true; summary: string }) => void = () => {};
    const onPreview = vi.fn(
      () =>
        new Promise<{ ok: true; summary: string }>(resolve => {
          resolvePreview = resolve;
        }),
    );
    renderPanel({ onPreview });
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(screen.getByText('Previewing…')).toBeTruthy());
    resolvePreview({ ok: true, summary: 'Validated 1 event.' });
    await waitFor(() => expect(screen.queryByText('Previewing…')).toBeNull());
  });
});
