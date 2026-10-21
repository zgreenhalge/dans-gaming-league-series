// @vitest-environment jsdom
/**
 * Component tests for `RatingCircle.tsx`: the value shows, and `dimmedReason` fades the circle and
 * joins its tooltip without ever printing a missing title.
 *
 * Run:  npx vitest run src/components/RatingCircle.test.tsx
 */

import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import RatingCircle from './RatingCircle';

const colors = { colorStart: 'white', colorEnd: 'green' };

describe('RatingCircle', () => {
  test('shows its value at full strength by default', () => {
    render(<RatingCircle value={72} {...colors} title="tip" />);
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByTitle('tip')).not.toHaveClass('opacity-50');
  });

  test('a dimmedReason fades the circle and joins the tooltip', () => {
    render(<RatingCircle value={72} {...colors} title="tip" dimmedReason="Uneven record" />);
    expect(screen.getByTitle('tip · Uneven record')).toHaveClass('opacity-50');
  });

  test('a dimmedReason without a title becomes the whole tooltip', () => {
    render(<RatingCircle value={72} {...colors} dimmedReason="Uneven record" />);
    expect(screen.getByTitle('Uneven record')).toHaveClass('opacity-50');
  });
});
