import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { EditableField } from '../EditableField';

describe('EditableField', () => {
  it('renders the display value with a pencil edit button', () => {
    render(<EditableField label="Name" value="Alice" onSave={vi.fn()} />);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByLabelText('Edit Name')).toBeTruthy();
  });

  it('renders an em-dash placeholder when value is empty', () => {
    render(<EditableField label="Org" value="" allowEmpty onSave={vi.fn()} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('clicking pencil swaps to an input prefilled with current value', () => {
    render(<EditableField label="Name" value="Alice" onSave={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Edit Name'));
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(input.value).toBe('Alice');
  });

  it('Save calls onSave with trimmed draft value', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableField label="Name" value="Alice" onSave={onSave} />);
    fireEvent.click(screen.getByLabelText('Edit Name'));
    fireEvent.input(screen.getByLabelText('Name'), {
      target: { value: '  Bob  ' },
    });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Bob'));
  });

  it('disables Save and Cancel while saving (button shows "Saving…")', async () => {
    let resolveSave: () => void = () => {};
    const onSave = vi.fn(
      () => new Promise<void>(resolve => { resolveSave = resolve; }),
    );
    render(<EditableField label="Name" value="Alice" onSave={onSave} />);
    fireEvent.click(screen.getByLabelText('Edit Name'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByText('Saving…')).toBeTruthy());
    const saveBtn = screen.getByText('Saving…') as HTMLButtonElement;
    const cancelBtn = screen.getByText('Cancel') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    expect(cancelBtn.disabled).toBe(true);
    resolveSave();
    await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull());
  });

  it('renders error from rejected onSave promise and stays in edit mode', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Server says no'));
    render(<EditableField label="Name" value="Alice" onSave={onSave} />);
    fireEvent.click(screen.getByLabelText('Edit Name'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByText('Server says no')).toBeTruthy());
    // Still editing — input remains visible.
    expect(screen.getByLabelText('Name')).toBeTruthy();
  });

  it('Cancel restores display mode without calling onSave', () => {
    const onSave = vi.fn();
    render(<EditableField label="Name" value="Alice" onSave={onSave} />);
    fireEvent.click(screen.getByLabelText('Edit Name'));
    fireEvent.input(screen.getByLabelText('Name'), {
      target: { value: 'Different' },
    });
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('allowEmpty=true passes empty value through to onSave', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableField label="Org" value="Acme" allowEmpty onSave={onSave} />);
    fireEvent.click(screen.getByLabelText('Edit Org'));
    fireEvent.input(screen.getByLabelText('Org'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(''));
  });

  it('empty value with allowEmpty=false shows inline error and does NOT call onSave', async () => {
    const onSave = vi.fn();
    render(<EditableField label="Name" value="Alice" onSave={onSave} />);
    fireEvent.click(screen.getByLabelText('Edit Name'));
    fireEvent.input(screen.getByLabelText('Name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(screen.getByText(/cannot be empty/i)).toBeTruthy(),
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it('value over maxLength shows inline error and does NOT call onSave', async () => {
    const onSave = vi.fn();
    render(
      <EditableField
        label="Name"
        value="A"
        maxLength={5}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByLabelText('Edit Name'));
    fireEvent.input(screen.getByLabelText('Name'), {
      target: { value: 'TooLong' },
    });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(screen.getByText(/Maximum length is 5/i)).toBeTruthy(),
    );
    expect(onSave).not.toHaveBeenCalled();
  });
});
