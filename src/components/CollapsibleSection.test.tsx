// @vitest-environment jsdom
/**
 * Component tests for `CollapsibleSection`: open by default, the title bar toggles its body, and
 * an Open link appears only when given a href. Run: npx vitest run src/components/CollapsibleSection.test.tsx
 */

import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollapsibleSection } from './CollapsibleSection';

describe('CollapsibleSection', () => {
  test('starts open and the title bar collapses and reopens it', async () => {
    render(
      <CollapsibleSection title="Group 1" detail="Elimination">
        <p>scorecard</p>
      </CollapsibleSection>,
    );
    const bar = screen.getByRole('button', { name: /Group 1/ });
    expect(bar).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('scorecard')).toBeInTheDocument();
    expect(screen.getByText('Elimination')).toBeInTheDocument();
    await userEvent.click(bar);
    expect(bar).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('scorecard')).toBeNull();
    await userEvent.click(bar);
    expect(screen.getByText('scorecard')).toBeInTheDocument();
  });

  test('the Open link only shows with a href', () => {
    const { rerender } = render(<CollapsibleSection title="Group 1" href="/seasons/5/groups/9">x</CollapsibleSection>);
    expect(screen.getByRole('link', { name: /Open/ })).toHaveAttribute('href', '/seasons/5/groups/9');
    rerender(<CollapsibleSection title="Group 1">x</CollapsibleSection>);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
