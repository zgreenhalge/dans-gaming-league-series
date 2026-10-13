// @vitest-environment jsdom
/**
 * Component tests for `ErrorText`: renders nothing without an error, one element per message for
 * an array, and the element, size and tone modifiers.
 * Run: npx vitest run src/components/ErrorText.test.tsx
 */

import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorText from './ErrorText';

describe('ErrorText', () => {
  test('renders nothing for a missing or empty error', () => {
    for (const error of [null, undefined, '', []]) {
      const { container, unmount } = render(<ErrorText error={error} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  test('a string renders as one mono red line in the chosen element and size', () => {
    render(<ErrorText error="Could not save" as="p" size={12} className="mb-3" />);
    const el = screen.getByText('Could not save');
    expect(el.tagName).toBe('P');
    expect(el).toHaveClass('font-mono', 'text-[12px]', 'text-[var(--color-accent-red-fg)]', 'mb-3');
  });

  test('an array renders one line per message', () => {
    render(<ErrorText error={['First problem', 'Second problem']} />);
    expect(screen.getByText('First problem').tagName).toBe('DIV');
    expect(screen.getByText('Second problem')).toBeInTheDocument();
  });

  test('the onDark tone uses the lighter red and the surrounding font', () => {
    render(<ErrorText error="Failed" tone="onDark" />);
    const el = screen.getByText('Failed');
    expect(el).toHaveClass('text-red-300');
    expect(el).not.toHaveClass('font-mono');
  });
});
