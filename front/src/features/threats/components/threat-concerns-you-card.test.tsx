/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  Link: ({ children }: { children: ReactNode }) => <a href="/locations-sectors">{children}</a>,
}));

// The map needs WebGL, which jsdom lacks; whether the card draws it is what is under test.
vi.mock('./targeted-countries-map', () => ({
  TargetedCountriesMap: ({ height }: { height?: number }) => <p data-height={height}>World map</p>,
}));

const { ThreatConcernsYouCard } = await import('./threat-concerns-you-card');

const FRANCE = { country: 'France', countryId: 'c-fr', countryIsoAlpha2: 'FR', matchesOrganization: true };
const EUROPE = { country: null, countryId: null, countryIsoAlpha2: null, matchesOrganization: false };
const FINANCE = { id: 's1', name: 'Finance', matchesOrganization: true };

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

describe('ThreatConcernsYouCard', () => {
  it('draws the map and links to every location and sector', () => {
    render(<ThreatConcernsYouCard locations={[FRANCE, EUROPE]} sectors={[FINANCE]} />);

    expect(screen.getByText('World map').getAttribute('data-height')).toBe('280');
    expect(screen.getByRole('link', { name: 'See the 3 locations and sectors' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Targeted sectors' }).textContent).toBe('Finance(this concerns you)');
  });

  it('says the threat targets no location, with no map and no link', () => {
    render(<ThreatConcernsYouCard locations={[]} sectors={[]} />);

    expect(screen.getByText('No location targeted.')).toBeTruthy();
    expect(screen.getByText('No sector targeted.')).toBeTruthy();
    expect(screen.queryByText('World map')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('draws no map when no targeted location is a known country', () => {
    render(<ThreatConcernsYouCard locations={[EUROPE]} sectors={[]} />);

    expect(screen.getByText('None of the locations this threat targets is a known country.')).toBeTruthy();
    expect(screen.queryByText('World map')).toBeNull();
    expect(screen.getByRole('link', { name: 'See the 1 location or sector' })).toBeTruthy();
  });
});
