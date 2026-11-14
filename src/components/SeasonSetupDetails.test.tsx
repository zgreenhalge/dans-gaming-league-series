// @vitest-environment jsdom
/**
 * Component tests for `SeasonSetupDetails`: every viewer sees the same start date / map pool / buy-in
 * lines, and only an admin gets the setup `AdminMenu`, whose items open each line's editor in place
 * (saving PATCHes that field and closes the editor; a failed save keeps it open with the route's
 * error; every item is held while one is open or while a save's refresh is pending), leave out the
 * buy-in once it's fixed, expand Mark active… into the go-live confirm (Confirm Go Live, with a Cancel
 * that closes the menu), and drop a failed activation's error once an editor is opened.
 * Run: npx vitest run src/components/SeasonSetupDetails.test.tsx
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeasonSetupDetails } from './SeasonSetupDetails';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

function renderDetails(overrides: { isAdmin?: boolean; buyInEditable?: boolean; seasonStatus?: string } = {}) {
  render(
    <SeasonSetupDetails
      seasonId={9}
      seasonStatus={overrides.seasonStatus ?? 'UPCOMING'}
      isAdmin={overrides.isAdmin ?? true}
      startDate="2026-12-01"
      regular={{ mapPool: null, knownMaps: [], buyInAmount: 20, buyInEditable: overrides.buyInEditable ?? true }}
    />,
  );
}

function stubFetch(status = 200, body: unknown = { ok: true }) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function openMenu() {
  await userEvent.click(screen.getByRole('button', { name: 'Season setup admin actions' }));
}

/** Opens Mark active…, leaving its Confirm Go Live and Cancel showing. */
async function openGoLive() {
  await openMenu();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Mark active…' }));
}

const expectItemsDisabled = (names: string[]) => {
  for (const name of names) expect(screen.getByRole('menuitem', { name })).toBeDisabled();
};

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe('SeasonSetupDetails', () => {
  test('a player sees the setup lines and no admin menu', () => {
    renderDetails({ isAdmin: false });
    expect(screen.getByText(/Starts:/)).toBeInTheDocument();
    expect(screen.getByText(/Maps:/)).toHaveTextContent('TBD');
    expect(screen.getByText(/Buy-in:/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Season setup admin actions' })).toBeNull();
  });

  test('renders nothing once the season is not UPCOMING', () => {
    renderDetails({ seasonStatus: 'ACTIVE' });
    expect(screen.queryByText(/Starts:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Season setup admin actions' })).toBeNull();
  });

  test("Edit start date… opens the editor in the line's place, and Save PATCHes the date", async () => {
    const fetchMock = stubFetch();
    renderDetails();

    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit start date…' }));
    expect(screen.queryByText(/Starts:/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/seasons/9/start-date', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ start_date: '2026-12-01' }),
    }));
    expect(await screen.findByText(/Starts:/)).toBeInTheDocument();
  });

  test("a failed save keeps the editor open with the route's error", async () => {
    stubFetch(400, { error: 'Buy-in is locked.' });
    renderDetails();

    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit buy-in…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save buy-in' }));

    expect(await screen.findByText('Buy-in is locked.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Buy-in/ })).toBeInTheDocument();
  });

  test('leaves out Edit buy-in… once the buy-in is fixed', async () => {
    renderDetails({ buyInEditable: false });
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Edit buy-in…' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Set map pool…' })).toBeInTheDocument();
  });

  test('Mark active… expands into the confirm, which PATCHes the status', async () => {
    const fetchMock = stubFetch();
    renderDetails();

    await openGoLive();
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Go Live' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/seasons/9/status', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ status: 'ACTIVE' }),
    }));
    expect(screen.queryByRole('group')).toBeNull();
  });

  test("Mark active…'s Cancel closes the confirm without a write", async () => {
    const fetchMock = stubFetch();
    renderDetails();

    await openGoLive();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('group')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('while one editor is open, every menu item is disabled, Mark active… included', async () => {
    renderDetails();

    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Set map pool…' }));
    await openMenu();

    expectItemsDisabled(['Edit start date…', 'Edit buy-in…', 'Mark active…']);
  });

  test("after a save, the menu stays held until the page's refresh lands, so an editor can't reopen on the old values", async () => {
    stubFetch();
    // The pending promise stands in for the render work Next's refresh keeps the transition open for.
    let landed!: () => void;
    refresh.mockReturnValue(new Promise<void>((resolve) => (landed = resolve)));
    renderDetails();

    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit start date…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Starts:/);

    await openMenu();
    expectItemsDisabled(['Edit start date…', 'Set map pool…', 'Edit buy-in…', 'Mark active…']);

    landed();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Edit start date…' })).toBeEnabled());
  });

  test("a failed activation's error shows beside the lines and goes once an editor is opened", async () => {
    stubFetch(409, { error: 'Set the map pool first.' });
    renderDetails();

    await openGoLive();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Go Live' }));
    expect(await screen.findByText('Set the map pool first.')).toBeInTheDocument();

    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Set map pool…' }));
    expect(screen.queryByText('Set the map pool first.')).toBeNull();
  });
});
