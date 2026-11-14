// @vitest-environment jsdom
/**
 * Component tests for `LaunchOptionsPicker` / `MapPicker` accessible names: the config-set select, the
 * map select and the custom workshop-ID input are each found by label, and the map select keeps the
 * name from a caller's `<label htmlFor>` when `MapPicker` is given an `id`.
 *
 * Run:  npx vitest run src/components/LaunchOptionsPicker.test.tsx
 */

import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LaunchOptionsPicker } from './LaunchOptionsPicker';
import { CUSTOM_MAP_CHOICE, MapPicker } from './MapPicker';

const maps = [{ name: 'de_alpha', workshopId: '111' }];

describe('LaunchOptionsPicker', () => {
  test('names the config-set select, the map select and the custom workshop-ID input', () => {
    render(
      <LaunchOptionsPicker
        configSets={[{ key: 'golden', label: 'Golden' }]}
        configSet="golden"
        onConfigSetChange={vi.fn()}
        maps={maps}
        mapChoice={CUSTOM_MAP_CHOICE}
        onMapChoiceChange={vi.fn()}
        customMapId=""
        onCustomMapIdChange={vi.fn()}
        customMapInvalid={false}
        playout={false}
        onPlayoutChange={vi.fn()}
        friendly={false}
        onFriendlyChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Config set' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Map' })).toBeTruthy();
    expect(screen.getByLabelText('Custom workshop ID or URL')).toBeTruthy();
  });
});

describe('MapPicker', () => {
  test("takes its name from a caller's label when given an id", () => {
    render(
      <>
        <label htmlFor="map-field">Pick the map</label>
        <MapPicker
          id="map-field"
          maps={maps}
          value=""
          onChange={vi.fn()}
          customValue=""
          onCustomChange={vi.fn()}
          customInvalid={false}
        />
      </>,
    );
    expect(screen.getByRole('combobox', { name: 'Pick the map' })).toBeTruthy();
  });
});
