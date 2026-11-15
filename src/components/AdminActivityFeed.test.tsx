// @vitest-environment jsdom
/**
 * Component tests for `AdminActivityFeed`'s per-source failure handling: a failed jobs or ops-errors
 * read shows its own inline error while the other source still renders, and a failed history read
 * errors only the History view.
 * Run: npx vitest run src/components/AdminActivityFeed.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createNextNavigationMock, resetNextNavigationMock } from '@/lib/test-support/mockNextNavigation';
import { AdminActivityFeed } from './AdminActivityFeed';
import type { OpsErrorItem } from './OpsErrorList';

vi.mock('next/navigation', () => createNextNavigationMock());

beforeEach(() => resetNextNavigationMock());

const opsError: OpsErrorItem = {
  id: 1,
  entityType: 'system',
  entityId: 0,
  operation: 'ehog_recompute',
  message: 'recompute exploded',
  occurredAt: new Date().toISOString(),
  label: 'EHOG Recompute',
};

const noop = () => {};

describe('AdminActivityFeed', () => {
  test('a failed jobs read shows an inline error and still renders the ops errors', async () => {
    render(
      <AdminActivityFeed
        jobs={{ ok: false, error: 'jobs table unreadable', label: 'background jobs' }}
        opsErrors={{ ok: true, data: [opsError] }}
        opsErrorHistory={{ ok: true, data: [] }}
        onJump={noop}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load background jobs");
    expect(screen.getByText('jobs table unreadable')).toBeInTheDocument();
    expect(await screen.findByText('recompute exploded')).toBeInTheDocument();
  });

  test('a failed ops-errors read shows its own inline error', () => {
    render(
      <AdminActivityFeed
        jobs={{ ok: true, data: [] }}
        opsErrors={{ ok: false, error: 'ops read failed', label: 'ops errors' }}
        opsErrorHistory={{ ok: true, data: [] }}
        onJump={noop}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load ops errors");
  });

  test('a failed history read errors only the History view', async () => {
    render(
      <AdminActivityFeed
        jobs={{ ok: true, data: [] }}
        opsErrors={{ ok: true, data: [] }}
        opsErrorHistory={{ ok: false, error: 'history failed', label: 'failure history' }}
        onJump={noop}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load failure history");
  });
});
