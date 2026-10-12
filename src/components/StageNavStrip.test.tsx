// @vitest-environment jsdom
/**
 * Component tests for `StageNavStrip`: a labelled chip row with an optional meta chip, and nothing at
 * all when it has neither. Run: npx vitest run src/components/StageNavStrip.test.tsx
 */

import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StageNavStrip } from './StageNavStrip';
import type { StageNavItem } from '@/lib/stage-views';

const item = (label: string, over: Partial<StageNavItem> = {}): StageNavItem => ({
  chip: label,
  label,
  href: `/x/${label}`,
  played: true,
  current: false,
  ...over,
});

describe('StageNavStrip', () => {
  test('labels the row and marks the current chip', () => {
    render(<StageNavStrip items={[item('1'), item('2', { current: true })]} label="Rounds" />);
    expect(screen.getByRole('navigation', { name: 'Rounds' })).toBeInTheDocument();
    expect(screen.getByText('Rounds')).toBeInTheDocument();
    expect(screen.getByText('2')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '1' })).toHaveAttribute('href', '/x/1');
  });

  test('a meta chip links out and is not one of the stage chips', () => {
    render(<StageNavStrip items={[item('1')]} label="Weeks" meta={{ label: 'Gauntlet →', href: '/seasons/5/rounds/1' }} />);
    expect(screen.getByRole('link', { name: 'Gauntlet →' })).toHaveAttribute('href', '/seasons/5/rounds/1');
  });

  test('a lone stage chip is hidden; the meta chip stands alone, and with neither nothing renders', () => {
    const { container, rerender } = render(
      <StageNavStrip items={[item('Final', { current: true })]} label="Groups" meta={{ label: '← Regular season', href: '/seasons/5' }} />,
    );
    expect(screen.getByRole('link', { name: '← Regular season' })).toBeInTheDocument();
    expect(screen.queryByText('Groups')).toBeNull();
    expect(screen.queryByText('Final')).toBeNull();
    rerender(<StageNavStrip items={[item('Final', { current: true })]} label="Groups" />);
    expect(container).toBeEmptyDOMElement();
  });
});
