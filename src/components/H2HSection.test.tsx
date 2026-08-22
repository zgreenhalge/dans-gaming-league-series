// @vitest-environment jsdom
/**
 * Component tests for `H2HSection.tsx`'s `onPairChange` callback — fired on every explicit
 * selection (a row click, a matrix cell click, a flip button), never on a hover preview, so a parent
 * can mirror the active pair into its own URL state without this component knowing anything about
 * routing. The `a`/`b`/`type` <-> `H2HPair` serialization it's built on is tested directly in
 * `useH2HPairUrlState.test.ts`.
 *
 * Run:  npx vitest run src/components/H2HSection.test.tsx
 */

import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import H2HSection from './H2HSection';
import { h2hDataWithDuo } from '@/lib/test-support/h2hFixtures';

describe('H2HSection — onPairChange', () => {
  test('fires on an explicit row click, with the clicked pair', async () => {
    const onPairChange = vi.fn();
    render(<H2HSection data={h2hDataWithDuo()} onPairChange={onPairChange} />);
    await userEvent.click(screen.getAllByText('Alice & Bob')[0]);

    expect(onPairChange).toHaveBeenCalledWith({ a: 1, b: 2, type: 'partner' });
  });

  test('does not fire on hover', async () => {
    const onPairChange = vi.fn();
    render(<H2HSection data={h2hDataWithDuo()} onPairChange={onPairChange} />);
    await userEvent.hover(screen.getAllByText('Alice & Bob')[0]);

    expect(onPairChange).not.toHaveBeenCalled();
  });
});
