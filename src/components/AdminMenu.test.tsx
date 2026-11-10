// @vitest-environment jsdom
/**
 * Component tests for `AdminMenu`: the trigger opens and closes it, Escape and a press outside close
 * it, focus goes to the first item on open and back to the trigger on Escape or a pick, arrow keys move
 * between items, a one-click item fires once, and an item with `content` expands in place of the list.
 *
 * Run:  npx vitest run src/components/AdminMenu.test.tsx
 */

import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminMenu, type AdminMenuItem } from './AdminMenu';

function setup(items: AdminMenuItem[]) {
  render(
    <div>
      <AdminMenu label="Row actions" items={items} />
      <button type="button">Elsewhere</button>
    </div>,
  );
  return screen.getByRole('button', { name: 'Row actions' });
}

describe('AdminMenu', () => {
  test('the trigger opens the menu, focusing its first item, and closes it again', async () => {
    const trigger = setup([{ label: 'One', onSelect: vi.fn() }, { label: 'Two', onSelect: vi.fn() }]);
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus();

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('Escape closes it and puts focus back on the trigger', async () => {
    const trigger = setup([{ label: 'One', onSelect: vi.fn() }]);
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  test('a press outside closes it', async () => {
    const trigger = setup([{ label: 'One', onSelect: vi.fn() }]);
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('tabbing out of it closes it', async () => {
    const trigger = setup([{ label: 'One', onSelect: vi.fn() }]);
    await userEvent.click(trigger);
    await userEvent.tab();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('arrow keys move between enabled items and wrap', async () => {
    const trigger = setup([
      { label: 'One', onSelect: vi.fn() },
      { label: 'Off', onSelect: vi.fn(), disabled: true },
      { label: 'Three', onSelect: vi.fn() },
    ]);
    await userEvent.click(trigger);
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Three' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Three' })).toHaveFocus();
  });

  test('picking a one-click item fires it once, closes the menu and returns focus', async () => {
    const onSelect = vi.fn();
    const trigger = setup([{ label: 'One', onSelect }]);
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'One' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  test('a disabled item does not fire', async () => {
    const onSelect = vi.fn();
    const trigger = setup([{ label: 'One', onSelect, disabled: true }]);
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'One' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('an item with content expands in place of the list, and its close callback closes the menu', async () => {
    const onDone = vi.fn();
    const trigger = setup([
      {
        label: 'Add…',
        content: (close) => (
          <button
            type="button"
            onClick={() => {
              close();
              onDone();
            }}
          >
            Done
          </button>
        ),
      },
    ]);
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add…' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('group', { name: 'Add…' })).toBeInTheDocument();
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(done);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  test('Escape from expanded content closes the menu and returns focus', async () => {
    const trigger = setup([{ label: 'Add…', content: () => <button type="button">Done</button> }]);
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add…' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('group')).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
