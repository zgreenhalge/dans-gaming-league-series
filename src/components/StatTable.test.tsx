// @vitest-environment jsdom
/**
 * Component tests for the shared stat-table body pieces: frame, row, figure cell, name cell and the
 * pinned player-name cell.
 * Run: npx vitest run src/components/StatTable.test.tsx
 */

import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StatTable, Tr, Td, NameTd, PlayerCell, MapCell, ExpandedTd, FactionTintContext } from './StatTable';
import { CompactTable, CompactTh, CompactTr, CompactTd, CompactNameTd } from './CompactTable';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

describe('StatTable pieces', () => {
  test('rows divide with the tertiary rule, drop the last line, and highlight only when clickable', () => {
    render(
      <StatTable>
        <tbody>
          <Tr data-testid="plain"><Td>1</Td></Tr>
          <Tr data-testid="link" clickable><Td>2</Td></Tr>
        </tbody>
      </StatTable>,
    );
    expect(screen.getByTestId('plain').className).toContain('border-[var(--color-border-tertiary)]');
    expect(screen.getByTestId('plain').className).toContain('last:border-b-0');
    expect(screen.getByTestId('plain').className).not.toContain('lift-row');
    expect(screen.getByTestId('link').className).toContain('lift-row');
  });

  test('Td is a right-aligned mono 12px figure; muted, bold and mono={false} adjust it', () => {
    render(
      <table><tbody><tr>
        <Td>1</Td><Td muted>2</Td><Td bold align="left">3</Td><Td mono={false}>4</Td>
      </tr></tbody></table>,
    );
    expect(screen.getByText('1').className).toMatch(/font-mono.*text-\[12px\].*text-right/);
    expect(screen.getByText('2').className).toContain('text-[var(--color-text-secondary)]');
    expect(screen.getByText('3').className).toContain('font-semibold');
    expect(screen.getByText('3').className).toContain('text-left');
    expect(screen.getByText('4').className).not.toContain('font-mono');
  });

  test('NameTd is the display-font name cell and pins when sticky', () => {
    render(<table><tbody><tr><NameTd sticky>Zach</NameTd></tr></tbody></table>);
    const cell = screen.getByText('Zach');
    expect(cell.className).toContain('font-display');
    expect(cell.className).toContain('text-[14px]');
    expect(cell.className).toContain('sticky-col');
  });

  test('PlayerCell is a pinned name cell linking to the player, with an optional avatar', () => {
    render(<table><tbody><tr><PlayerCell id={7} name="Dan" avatarUrl={null} /></tr></tbody></table>);
    const link = screen.getByRole('link', { name: /Dan/ });
    expect(link).toHaveAttribute('href', '/players/7');
    expect(link.closest('td')?.className).toContain('sticky-col');
  });

  test('the frame is a bordered page-background card; bare drops the border and tinted leaves the background to className', () => {
    const frameOf = (node: React.ReactElement) => {
      const { container, unmount } = render(node);
      const cls = (container.firstElementChild as HTMLElement).className;
      unmount();
      return cls;
    };
    const rows = <tbody><tr><td>x</td></tr></tbody>;
    const framed = frameOf(<StatTable>{rows}</StatTable>);
    expect(framed).toContain('border-[var(--color-border-primary)]');
    expect(framed).toContain('bg-[var(--color-bg-primary)]');
    expect(frameOf(<StatTable bare>{rows}</StatTable>)).not.toContain('border-[var(--color-border-primary)]');
    const tinted = frameOf(<StatTable tinted className="faction-tint">{rows}</StatTable>);
    expect(tinted).not.toContain('bg-[var(--color-bg-primary)]');
    expect(tinted).toContain('faction-tint');
  });

  test('inside a FactionTintContext the frame and rows leave the background to the faction tint', () => {
    const { container } = render(
      <FactionTintContext.Provider value>
        <StatTable><tbody><Tr><td>x</td></Tr></tbody></StatTable>
      </FactionTintContext.Provider>,
    );
    expect((container.firstElementChild as HTMLElement).className).not.toContain('bg-[var(--color-bg-primary)]');
    const row = container.querySelector('tr') as HTMLElement;
    expect(row.className).toContain('faction-tint-row');
    expect(row.className).not.toContain('bg-[var(--color-bg-primary)]');
  });

  test('MapCell links to the map page and shows the stored name in sentence case', () => {
    render(<table><tbody><tr><MapCell map="dust2" /></tr></tbody></table>);
    const link = screen.getByRole('link', { name: 'Dust2' });
    expect(link).toHaveAttribute('href', '/maps/dust2');
  });

  test('a Tr with an href opens it on a plain click and leaves nested links to themselves', () => {
    push.mockClear();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <table><tbody>
        <Tr href="/players/7" data-testid="row">
          <PlayerCell id={7} name="Dan" />
          <Td>12</Td>
        </Tr>
      </tbody></table>,
    );
    const row = screen.getByTestId('row');
    expect(row.className).toContain('lift-row');
    expect(screen.getAllByRole('link')).toHaveLength(1);

    fireEvent.click(screen.getByText('12'));
    expect(push).toHaveBeenCalledWith('/players/7');

    push.mockClear();
    const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '12' } as Selection);
    fireEvent.click(screen.getByText('12'));
    expect(push).not.toHaveBeenCalled();
    selection.mockRestore();

    fireEvent.click(screen.getByText('Dan'));
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('12'), { metaKey: true });
    expect(open).toHaveBeenCalledWith('/players/7', '_blank');
    open.mockClear();
    fireEvent(screen.getByText('12'), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(open).toHaveBeenCalledWith('/players/7', '_blank');
    open.mockRestore();
  });

  test('an accent tints the row and sets the hover accent', () => {
    render(<table><tbody><Tr accent="#f5c542" data-testid="row"><Td>1</Td></Tr></tbody></table>);
    const row = screen.getByTestId('row');
    expect(row.className).toContain('row-tint');
    expect(row.className).not.toContain('lift-row');
    expect(row.className).not.toContain('bg-[var(--color-bg-primary)]');
    expect(row.style.getPropertyValue('--lift-accent')).toBe('#f5c542');
  });

  test('summary and marker rows take their own background instead of the page one', () => {
    render(
      <table><tbody>
        <Tr variant="summary" data-testid="summary"><Td>1</Td></Tr>
        <Tr variant="marker" data-testid="marker"><Td>2</Td></Tr>
      </tbody></table>,
    );
    expect(screen.getByTestId('summary').className).toContain('bg-[var(--color-bg-tertiary)]');
    expect(screen.getByTestId('summary').className).toContain('border-t');
    expect(screen.getByTestId('summary').className).not.toContain('bg-[var(--color-bg-primary)]');
    expect(screen.getByTestId('marker').className).toContain('row-marker');
  });

  test('an expanded panel spans every column of the header row', () => {
    render(
      <table>
        <thead><tr><th>A</th><th colSpan={2}>B</th><th>C</th></tr></thead>
        <tbody><tr><ExpandedTd>detail</ExpandedTd></tr></tbody>
      </table>,
    );
    expect(screen.getByText('detail')).toHaveAttribute('colspan', '4');
  });

  test('PlayerCell pins by default and can opt out', () => {
    render(<table><tbody><tr><PlayerCell id={1} name="Pinned" /><PlayerCell id={2} name="Loose" sticky={false} /></tr></tbody></table>);
    expect(screen.getByText('Pinned').closest('td')?.className).toContain('sticky-col');
    expect(screen.getByText('Loose').closest('td')?.className).not.toContain('sticky-col');
  });

  test('PlayerCell with onToggle adds a keyboard-reachable expand button that does not trigger the row', () => {
    const toggle = vi.fn();
    const rowClick = vi.fn();
    render(<table><tbody><tr onClick={rowClick}><PlayerCell id={1} name="Dan" onToggle={toggle} expanded /></tr></tbody></table>);
    const button = screen.getByRole('button', { name: 'Collapse Dan' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(rowClick).not.toHaveBeenCalled();
  });

  test('a fixed StatTable lays out equal columns and holds its header inside the frame', () => {
    const { container } = render(
      <StatTable fixed header={<div>banner</div>}>
        <tbody><tr><td>x</td></tr></tbody>
      </StatTable>,
    );
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.querySelector('table')?.className).toContain('table-fixed');
    expect(frame.firstElementChild?.textContent).toBe('banner');
  });
});

describe('CompactTable pieces', () => {
  test('headers are the small unbanded label and cells are tight 11px figures', () => {
    render(
      <CompactTable widths={['w-9', 'w-12']}>
        <thead><tr><CompactTh align="right">K</CompactTh><CompactTh>Map</CompactTh></tr></thead>
        <tbody><CompactTr><CompactTd bold>5</CompactTd><CompactNameTd href="/maps/x">Map X</CompactNameTd></CompactTr></tbody>
      </CompactTable>,
    );
    const th = screen.getByRole('columnheader', { name: 'K' });
    expect(th.className).toContain('text-[9px]');
    expect(th.className).not.toContain('bg-[var(--color-bg-secondary)]');
    expect(screen.getByText('5').className).toMatch(/py-1.*font-mono.*text-\[11px\].*font-semibold/);
    expect(screen.getByRole('link', { name: 'Map X' })).toHaveAttribute('href', '/maps/x');
    expect(screen.getByText('5').className).toContain('whitespace-nowrap');
    expect(document.querySelectorAll('col')).toHaveLength(2);
    expect(document.querySelector('table')?.className).toContain('table-fixed');
  });

  test('without widths the table fills its container', () => {
    render(<CompactTable><tbody /></CompactTable>);
    expect(document.querySelector('table')?.className).toContain('w-full');
  });
});
