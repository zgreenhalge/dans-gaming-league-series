// @vitest-environment jsdom
/**
 * Component tests for `UpcomingGamesPanel.tsx`: the Upcoming block (title links to the
 * current week / round, rows show the day-of-week + day beside the time and a countdown) and the
 * To Be Scheduled block (title and an "All games →" link both go to the Schedule tab; its rows carry
 * no status text of their own). Either block is omitted when empty. Scrim nights join the Upcoming
 * Games block in time order, showing their seats, whether they're full, and the viewer's signup.
 *
 * Run:  npx vitest run src/components/UpcomingGamesPanel.test.tsx
 */

import { describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { UpcomingGamesPanel } from './UpcomingGamesPanel';
import type { ScrimSignupEntry, UpcomingGameRow, UpcomingScrimNight } from '@/lib/queries';

function game(overrides: Partial<UpcomingGameRow> & { id: number }): UpcomingGameRow {
  return {
    match_number: overrides.id,
    scheduled_at: null,
    skins_pick: null,
    shirts_pick: null,
    is_feature_match: false,
    shirts: [{ player_id: 1, player_name: 'Alice' }, { player_id: 2, player_name: 'Bob' }],
    skins: [{ player_id: 3, player_name: 'Carol' }, { player_id: 4, player_name: 'Dave' }],
    ...overrides,
  };
}

const SCHEDULED_AT = '2099-10-22T20:00:00Z';

function scrim(id: number, startsAt: string, signups: [number, 'definite' | 'maybe'][]): UpcomingScrimNight {
  return {
    night: { id, startsAt },
    started: false,
    checkInOpen: false,
    signups: signups.map(([player_id, commitment]): ScrimSignupEntry => ({
      player_id,
      player_name: `P${player_id}`,
      steam_avatar_url: null,
      commitment,
      signed_up_at: '2099-01-01T00:00:00Z',
      checked_in_at: null,
    })),
  };
}
const HEADING_HREF = '/seasons/4/weeks/12';
const SCHEDULE_HREF = '/seasons/4?tab=schedule';

function renderPanel(props: Partial<React.ComponentProps<typeof UpcomingGamesPanel>> = {}) {
  return render(
    <UpcomingGamesPanel
      scheduled={[game({ id: 19, scheduled_at: SCHEDULED_AT })]}
      unscheduled={[game({ id: 22 })]}
      headingHref={HEADING_HREF}
      scheduleHref={SCHEDULE_HREF}
      currentPlayerId={null}
      {...props}
    />,
  );
}

describe('UpcomingGamesPanel', () => {
  test('the Upcoming title links to the heading target and has no "All games" link', () => {
    renderPanel();
    expect(screen.getByRole('link', { name: /^Upcoming$/ })).toHaveAttribute('href', HEADING_HREF);
    // Only the To Be Scheduled block carries one.
    expect(screen.getAllByRole('link', { name: 'All games →' })).toHaveLength(1);
  });

  test('the To Be Scheduled title and its "All games →" link both go to the Schedule tab', () => {
    renderPanel();
    expect(screen.getByRole('link', { name: 'To Be Scheduled' })).toHaveAttribute('href', SCHEDULE_HREF);
    expect(screen.getByRole('link', { name: 'All games →' })).toHaveAttribute('href', SCHEDULE_HREF);
  });

  test('an unscheduled row repeats no "To Be Scheduled" text — the title says it once', () => {
    renderPanel();
    expect(screen.getAllByText('To Be Scheduled')).toHaveLength(1);
    const row = screen.getByRole('link', { name: /Match 22/ });
    expect(row).toHaveAttribute('href', '/matches/22');
    expect(within(row).queryByText('To Be Scheduled')).toBeNull();
  });

  test('a scheduled row shows the weekday and day beside the time, and links to the match', () => {
    renderPanel();
    const row = screen.getByRole('link', { name: /Match 19/ });
    expect(row).toHaveAttribute('href', '/matches/19');
    const at = new Date(SCHEDULED_AT);
    expect(within(row).getByText(at.toLocaleString('en-US', { weekday: 'short' }))).toBeInTheDocument();
    expect(within(row).getByText(at.toLocaleString('en-US', { day: 'numeric' }))).toBeInTheDocument();
    expect(within(row).getByText(at.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' }))).toBeInTheDocument();
  });

  test('a scheduled row counts down to its start', () => {
    renderPanel();
    expect(within(screen.getByRole('link', { name: /Match 19/ })).getByText(/^in /)).toBeInTheDocument();
  });

  test('the current player\'s name is highlighted', () => {
    const { container } = renderPanel({ currentPlayerId: 1 });
    expect(container.querySelectorAll('.player-name-me')).toHaveLength(2);
    expect(container.querySelector('.player-name-me')).toHaveTextContent('Alice');
  });

  test('an empty block is omitted; with both empty nothing renders', () => {
    const { container, rerender } = renderPanel({ unscheduled: [] });
    expect(screen.queryByRole('link', { name: 'To Be Scheduled' })).toBeNull();
    expect(screen.getByRole('link', { name: /^Upcoming$/ })).toBeInTheDocument();

    rerender(
      <UpcomingGamesPanel
        scheduled={[]}
        unscheduled={[game({ id: 22 })]}
        headingHref={HEADING_HREF}
        scheduleHref={SCHEDULE_HREF}
        currentPlayerId={null}
      />,
    );
    expect(screen.queryByRole('link', { name: /^Upcoming$/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'To Be Scheduled' })).toBeInTheDocument();

    rerender(
      <UpcomingGamesPanel scheduled={[]} unscheduled={[]} headingHref={HEADING_HREF} scheduleHref={SCHEDULE_HREF} currentPlayerId={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('scrim nights join Upcoming in time order, linking to their night pages', () => {
    renderPanel({
      scrims: [
        scrim(7, '2099-10-23T00:00:00Z', [[1, 'definite'], [2, 'definite'], [3, 'definite'], [4, 'definite']]),
        scrim(8, '2099-10-21T00:00:00Z', [[1, 'definite'], [5, 'maybe']]),
      ],
    });
    const links = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(links.filter((h) => h === '/scrims/8' || h === '/matches/19' || h === '/scrims/7')).toEqual(['/scrims/8', '/matches/19', '/scrims/7']);
    expect(screen.getByText('Scrim night · on')).toBeInTheDocument();
    expect(screen.getByText('4 in')).toBeInTheDocument();
    expect(screen.getByText('1 in · 1 maybe')).toBeInTheDocument();
  });

  test("a signed-in viewer sees their own scrim signup, or Join; a signed-out viewer sees neither", () => {
    const nights = [
      scrim(7, '2099-10-23T00:00:00Z', [[1, 'definite']]),
      scrim(8, '2099-10-24T00:00:00Z', [[1, 'maybe']]),
      scrim(9, '2099-10-25T00:00:00Z', [[2, 'definite']]),
    ];
    const { rerender } = renderPanel({ scrims: nights, currentPlayerId: 1 });
    expect(screen.getByText('You’re in')).toBeInTheDocument();
    expect(screen.getByText('Maybe')).toBeInTheDocument();
    expect(screen.getByText('Join')).toBeInTheDocument();
    rerender(
      <UpcomingGamesPanel scheduled={[]} unscheduled={[]} scrims={nights} headingHref="/scrims" scheduleHref="/scrims" currentPlayerId={null} />,
    );
    expect(screen.queryByText('Join')).toBeNull();
    expect(screen.queryByText('You’re in')).toBeNull();
  });

  test('with no season games, scrim nights alone still render the panel', () => {
    render(
      <UpcomingGamesPanel scheduled={[]} unscheduled={[]} scrims={[scrim(7, '2099-10-23T00:00:00Z', [[1, 'definite']])]} headingHref="/scrims" scheduleHref="/scrims" currentPlayerId={null} />,
    );
    expect(screen.getByRole('link', { name: /^Upcoming$/ })).toHaveAttribute('href', '/scrims');
    expect(screen.queryByRole('link', { name: 'To Be Scheduled' })).toBeNull();
  });
});
