// @vitest-environment jsdom
/**
 * Component tests for `ArmedConfirmButton`: the uncontrolled form arms on the trigger, disarms on
 * Cancel and once `onConfirm` settles (resolved or rejected), and the controlled form defers to the
 * caller's `armed`.
 * Run: npx vitest run src/components/ArmedConfirmButton.test.tsx
 */

import { describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ArmedConfirmButton } from './ArmedConfirmButton';

const LABELS = { triggerLabel: 'Delete', confirmLabel: 'Confirm Delete', busyLabel: 'Deleting…', variant: 'danger' } as const;

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ArmedConfirmButton (uncontrolled)', () => {
  test('the trigger arms it and Cancel disarms it without confirming', () => {
    const onConfirm = vi.fn();
    render(<ArmedConfirmButton onConfirm={onConfirm} busy={false} {...LABELS} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Confirm Delete')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('stays armed while onConfirm is pending and disarms once it resolves', async () => {
    const d = deferred();
    render(<ArmedConfirmButton onConfirm={() => d.promise} busy={false} {...LABELS} />);
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Confirm Delete'));
    expect(screen.getByText('Confirm Delete')).toBeInTheDocument();
    await act(async () => d.resolve());
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  test('disarms once onConfirm rejects, keeping the error beside the trigger', async () => {
    const d = deferred();
    // The button doesn't swallow the rejection: it still propagates out of the click handler.
    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);
    const { rerender } = render(<ArmedConfirmButton onConfirm={() => d.promise} busy={false} {...LABELS} />);
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Confirm Delete'));
    await act(async () => {
      d.reject(new Error('boom'));
      await d.promise.catch(() => {});
    });
    rerender(<ArmedConfirmButton onConfirm={() => d.promise} busy={false} error="Failed to delete." {...LABELS} />);
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('Failed to delete.')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    process.off('unhandledRejection', onUnhandled);
    expect(onUnhandled).toHaveBeenCalledTimes(1);
  });

  test('a synchronous onConfirm disarms straight away', async () => {
    const onConfirm = vi.fn();
    render(<ArmedConfirmButton onConfirm={onConfirm} busy={false} {...LABELS} />);
    fireEvent.click(screen.getByText('Delete'));
    await act(async () => fireEvent.click(screen.getByText('Confirm Delete')));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  test('busy disables both confirm and Cancel and shows the busy label', () => {
    const { rerender } = render(<ArmedConfirmButton onConfirm={vi.fn()} busy={false} {...LABELS} />);
    fireEvent.click(screen.getByText('Delete'));
    rerender(<ArmedConfirmButton onConfirm={vi.fn()} busy {...LABELS} />);
    expect(screen.getByText('Deleting…')).toBeDisabled();
    expect(screen.getByText('Cancel')).toBeDisabled();
  });
});

describe('ArmedConfirmButton (controlled)', () => {
  test('renders from the caller\'s armed and reports arm/cancel without changing on its own', async () => {
    const onArm = vi.fn();
    const onCancel = vi.fn();
    const props = { onArm, onCancel, onConfirm: vi.fn(async () => {}), busy: false, ...LABELS };
    const { rerender } = render(<ArmedConfirmButton armed={false} {...props} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(onArm).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Delete')).toBeInTheDocument();

    rerender(<ArmedConfirmButton armed {...props} />);
    await act(async () => fireEvent.click(screen.getByText('Confirm Delete')));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Confirm Delete')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Confirm Delete')).toBeInTheDocument();
  });
});
