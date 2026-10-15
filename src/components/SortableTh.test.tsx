// @vitest-environment jsdom
/**
 * Component tests for the shared stat-table headers: `SortableTh` (button, aria-sort, sort arrow,
 * sticky) and `Th` (the plain sibling in the same style).
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

  test('the arrow appears after the label of the sorted column only', () => {
    const { container, rerender } = inRow(<SortableTh label="ADR" sortKey="adr" state={{ col: 'k', asc: false }} onSort={() => {}} />);
    const arrow = () => container.querySelector('button span[aria-hidden]');
    expect(arrow()).toBeNull();
    rerender(
      <table><thead><tr><SortableTh label="ADR" sortKey="adr" state={{ col: 'adr', asc: false }} onSort={() => {}} align="right" /></tr></thead></table>,
    );
    expect(arrow()).toHaveTextContent('↓');
    expect(Array.from(container.querySelector('button')!.childNodes).map((n) => n.textContent)).toEqual(['ADR', '↓']);
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

describe('header labels wrap only at spaces', () => {
  test('each word is unbreakable, with a plain space between words', () => {
    inRow(<Th>Counter-Strafe %</Th>);
    const cell = screen.getByRole('columnheader');
    const words = Array.from(cell.querySelectorAll('span'));
    expect(words.map((w) => w.textContent)).toEqual(['Counter-Strafe', '%']);
    words.forEach((w) => expect(w).toHaveClass('whitespace-nowrap'));
    expect(cell.textContent).toBe('Counter-Strafe %');
  });
});
