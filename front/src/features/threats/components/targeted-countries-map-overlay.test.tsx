/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TargetedCountry } from './targeted-countries-map-utils';
import { TargetedCountriesMapOverlay } from './targeted-countries-map-overlay';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const countries: Array<TargetedCountry> = [
  { countryId: 'country-fr', isoAlpha2: 'FR', name: 'France', status: 'concerns-you' },
  { countryId: 'country-es', isoAlpha2: 'ES', name: 'Spain', status: 'targeted' },
];

const renderOverlay = (selectedCountryId: string | null = null) => {
  const onSelect = vi.fn();
  const onPointCountry = vi.fn();
  render(
    <TargetedCountriesMapOverlay
      countries={countries}
      selectedCountryId={selectedCountryId}
      onSelect={onSelect}
      onPointCountry={onPointCountry}
      pointedLabel={null}
      onZoomIn={vi.fn()}
      onZoomOut={vi.fn()}
    />,
  );
  return { onSelect, onPointCountry };
};

describe('TargetedCountriesMapOverlay', () => {
  it('gives every coloured country a focusable control named after it', () => {
    renderOverlay();

    expect(screen.getByRole('button', { name: 'Spain' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'France (this concerns you)' })).toBeDefined();
  });

  it('points the map at a country while it holds the focus', () => {
    const { onPointCountry } = renderOverlay();
    const spain = screen.getByRole('button', { name: 'Spain' });

    fireEvent.focus(spain);
    fireEvent.blur(spain);

    expect(onPointCountry.mock.calls).toEqual([['country-es'], [null]]);
  });

  it('emits the id of the country selected', () => {
    const { onSelect } = renderOverlay();

    fireEvent.click(screen.getByRole('button', { name: 'Spain' }));

    expect(onSelect).toHaveBeenCalledWith('country-es');
  });

  it('emits no country when the selected one is selected again', () => {
    const { onSelect } = renderOverlay('country-es');
    const spain = screen.getByRole('button', { name: 'Spain' });

    fireEvent.click(spain);

    expect(spain.getAttribute('aria-pressed')).toBe('true');
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('only lists the countries when the map is display only', () => {
    render(
      <TargetedCountriesMapOverlay
        countries={countries}
        selectedCountryId={null}
        onPointCountry={vi.fn()}
        pointedLabel={null}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
      />,
    );

    const list = screen.getByRole('list', { name: 'Targeted countries' });
    expect(list.textContent).toContain('France (this concerns you)');
    expect(screen.queryByRole('button', { name: 'Spain' })).toBeNull();
  });
});
