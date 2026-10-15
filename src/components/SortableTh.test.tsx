// @vitest-environment jsdom
/**
 * Component tests for the shared stat-table headers: `SortableTh` (button, aria-sort, reserved arrow
 * slot, sticky) and `Th` (the plain sibling in the same style).
 * Run: npx vitest run src/components/SortableTh.test.tsx
 */

import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SortableTh from './SortableTh';
import Th from './Th';

function inRow(cell: React.ReactNode) {
  return render(
    <table>
      <thead>
        <tr>{cell}</tr>
      </thead>
    </table>,
  );
}

describe('SortableTh', () => {
  test('is a button that calls onSort with its key, and a tooltip title', async () => {
    const onSort = vi.fn();
    inRow(<SortableTh label="ADR" title="Average damage per round" sortKey="adr" state={{ col: 'k', asc: false }} onSort={onSort} />);
    const button = screen.getByRole('button', { name: /ADR/ });
    expect(button).toHaveAttribute('title', 'Average damage per round');
    await userEvent.click(button);
    expect(onSort).toHaveBeenCalledWith('adr');
  });

  test('aria-sort names the sorted column and its direction; others are none', () => {
    const { rerender } = inRow(<SortableTh label="ADR" sortKey="adr" state={{ col: 'adr', asc: false }} onSort={() => {}} />);
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'descending');
    rerender(
      <table><thead><tr><SortableTh label="ADR" sortKey="adr" state={{ col: 'adr', asc: true }} onSort={() => {}} /></tr></thead></table>,
    );
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending');
    rerender(
      <table><thead><tr><SortableTh label="ADR" sortKey="adr" state={{ col: 'k', asc: true }} onSort={() => {}} /></tr></thead></table>,
    );
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'none');
  });

  test('the arrow slot is always rendered, hidden until the column is sorted, so sorting never changes the width', () => {
    const { container, rerender } = inRow(<SortableTh label="ADR" sortKey="adr" state={{ col: 'k', asc: false }} onSort={() => {}} />);
    const slot = () => container.querySelector('button span[aria-hidden]') as HTMLElement;
    expect(slot()).toHaveClass('invisible');
    rerender(
      <table><thead><tr><SortableTh label="ADR" sortKey="adr" state={{ col: 'adr', asc: false }} onSort={() => {}} /></tr></thead></table>,
    );
    expect(slot()).not.toHaveClass('invisible');
    expect(slot()).toHaveTextContent('↓');
  });

  test('the slot sits away from the alignment edge: before the label when right-aligned, after when left-aligned', () => {
    const order = (container: HTMLElement) => Array.from(container.querySelector('button')!.childNodes).map((n) => n.textContent);
    const right = inRow(<SortableTh label="ADR" sortKey="adr" state={{ col: 'adr', asc: true }} onSort={() => {}} align="right" />);
    expect(order(right.container)).toEqual(['↑', 'ADR']);
    right.unmount();
    const left = inRow(<SortableTh label="Player" sortKey="name" state={{ col: 'name', asc: true }} onSort={() => {}} />);
    expect(order(left.container)).toEqual(['Player', '↑']);
  });

  test('sticky pins the cell with the shared class', () => {
    inRow(<SortableTh label="Player" sortKey="name" state={{ col: '', asc: false }} onSort={() => {}} sticky />);
    expect(screen.getByRole('columnheader')).toHaveClass('sticky-col');
  });
});

describe('Th', () => {
  test('matches the sortable header: 10px, 8px padding, tinted band, aligned, optionally sticky', () => {
    inRow(<Th align="right" sticky title="Rounds won">RW</Th>);
    const cell = screen.getByRole('columnheader', { name: 'RW' });
    expect(cell).toHaveClass('text-[10px]', 'p-2', 'text-right', 'sticky-col', 'bg-[var(--color-bg-secondary)]');
    expect(cell).toHaveAttribute('title', 'Rounds won');
    expect(cell).not.toHaveClass('uppercase');
  });
});
