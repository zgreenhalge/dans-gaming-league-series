// @vitest-environment jsdom
/**
 * Component tests for the shared stat-table body pieces: frame, row, figure cell, name cell and the
 * pinned player-name cell.
 * Run: npx vitest run src/components/StatTable.test.tsx
 */

import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatTable, Tr, Td, NameTd, PlayerCell } from './StatTable';
import Th from './Th';

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

  test('a compact Th is the unbanded small label', () => {
    render(<table><thead><tr><Th compact align="right">K</Th></tr></thead></table>);
    const cell = screen.getByText('K');
    expect(cell.className).toContain('text-[9px]');
    expect(cell.className).not.toContain('bg-[var(--color-bg-secondary)]');
  });
});
