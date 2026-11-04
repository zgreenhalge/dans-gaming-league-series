// @vitest-environment jsdom
/**
 * Component tests for `RankChange`: an up move in green, a down move in red, nothing for no move.
 * Run: npx vitest run src/components/RankChange.test.tsx
 */

import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RankChange } from './RankChange';

describe('RankChange', () => {
  test('an up move reads ▲n in green', () => {
    render(<RankChange change={2} />);
    const el = screen.getByLabelText('up 2 since last week');
    expect(el).toHaveTextContent('▲2');
    expect(el.style.color).toBe('var(--color-accent-green-fg)');
  });

  test('a down move reads ▼n in red', () => {
    render(<RankChange change={-1} />);
    const el = screen.getByLabelText('down 1 since last week');
    expect(el).toHaveTextContent('▼1');
    expect(el.style.color).toBe('var(--color-accent-red-fg)');
  });

  test('no move, or no data, renders nothing', () => {
    for (const change of [0, undefined]) {
      const { container, unmount } = render(<RankChange change={change} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
