// @vitest-environment jsdom
/**
 * Component tests for `MatchServerPanel`'s starting state: a viewer who cannot call the status route
 * (`canManage` false) still sees the server state the page rendered with, and never a connect string.
 * Run: npx vitest run src/components/MatchServerPanel.test.tsx
 */

import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MatchServerPanel from './MatchServerPanel';

vi.mock('./useRealtimeChanges', () => ({ useRealtimeChanges: () => {} }));

describe('MatchServerPanel initialState', () => {
  test('a non-manager sees a provisioning server immediately', () => {
    render(<MatchServerPanel matchId={7} canManage={false} initialState="provisioning" />);
    expect(screen.getByText('Starting server…')).toBeInTheDocument();
    expect(screen.queryByText('No server running for this match.')).toBeNull();
  });

  test('a non-manager sees a live server, with no connect string', () => {
    render(<MatchServerPanel matchId={7} canManage={false} initialState="live" />);
    expect(screen.getByText('Server is live.')).toBeInTheDocument();
    expect(screen.queryByText(/connect /)).toBeNull();
  });

  test('defaults to idle', () => {
    render(<MatchServerPanel matchId={7} canManage={false} />);
    expect(screen.getByText('No server running for this match.')).toBeInTheDocument();
  });
});
