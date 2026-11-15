// @vitest-environment jsdom
/**
 * Component tests for `PanelGate`: a loaded panel renders its children with the data; a failed one
 * renders an alert naming the panel and the error instead.
 * Run: npx vitest run src/components/PanelGate.test.tsx
 */

import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PanelGate } from './PanelGate';

describe('PanelGate', () => {
  test('a loaded panel renders its children with the data', () => {
    render(
      <PanelGate label="players" panel={{ ok: true, data: ['Ann', 'Bo'] }}>
        {(names) => <div>{names.join(' & ')}</div>}
      </PanelGate>,
    );
    expect(screen.getByText('Ann & Bo')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('a failed panel renders an inline error and never calls children', () => {
    render(
      <PanelGate label="players" panel={{ ok: false, error: 'connection reset' }}>
        {() => {
          throw new Error('children must not render');
        }}
      </PanelGate>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load players");
    expect(screen.getByText('connection reset')).toBeInTheDocument();
  });
});
