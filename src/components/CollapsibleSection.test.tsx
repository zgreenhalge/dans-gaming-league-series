// @vitest-environment jsdom
/**
 * Component tests for `CollapsibleSection` and its two-segment `StageBar`: open by default; with an
 * href the caret toggles and the title links; without one the whole bar toggles.
 * Run: npx vitest run src/components/CollapsibleSection.test.tsx
 */

import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollapsibleSection } from './CollapsibleSection';

describe('CollapsibleSection', () => {
  test('with an href, the caret toggles the body and the title links to the page', async () => {
    render(
      <CollapsibleSection title="Group 1" detail="Elimination" href="/seasons/5/groups/9">
        <p>scorecard</p>
      </CollapsibleSection>,
    );
    const caret = screen.getByRole('button', { name: 'Collapse Group 1' });
    expect(caret).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('scorecard')).toBeInTheDocument();
    expect(screen.getByText('Elimination')).toBeInTheDocument();

    const title = screen.getByRole('link', { name: /Group 1/ });
    expect(title).toHaveAttribute('href', '/seasons/5/groups/9');
    await userEvent.click(title);
    expect(screen.getByText('scorecard')).toBeInTheDocument();

    await userEvent.click(caret);
    expect(screen.queryByText('scorecard')).toBeNull();
    expect(screen.getByRole('button', { name: 'Expand Group 1' })).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Expand Group 1' }));
    expect(screen.getByText('scorecard')).toBeInTheDocument();
  });

  test('without an href the whole bar is the toggle and nothing links', async () => {
    render(
      <CollapsibleSection title="Group 1">
        <p>scorecard</p>
      </CollapsibleSection>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Group 1/ }));
    expect(screen.queryByText('scorecard')).toBeNull();
  });
  test('controlled: the open prop decides, and the caret calls onToggle instead of toggling itself', async () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <CollapsibleSection title="Week 3" href="/seasons/5/weeks/31" open={false} onToggle={onToggle}>
        <p>matches</p>
      </CollapsibleSection>,
    );
    expect(screen.queryByText('matches')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Expand Week 3' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('matches')).toBeNull();
    rerender(
      <CollapsibleSection title="Week 3" href="/seasons/5/weeks/31" open onToggle={onToggle}>
        <p>matches</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText('matches')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse Week 3' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('renders the anchor id and trailing content in the bar', () => {
    const { container } = render(
      <CollapsibleSection title="Week 3" id="week-31" trailing={<span>Bye: Dee</span>}>
        <p>matches</p>
      </CollapsibleSection>,
    );
    expect(container.querySelector('#week-31')).not.toBeNull();
    expect(screen.getByText('Bye: Dee')).toBeInTheDocument();
  });
});
