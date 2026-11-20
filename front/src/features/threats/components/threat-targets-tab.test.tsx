/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider, stripSearchParams } from '@tanstack/react-router';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Providers from '../../../providers';
import type { TargetedCountriesMapCanvasProps } from './targeted-countries-map-canvas';
import type { ThreatAnalysisDetailData } from './threat-detail-tabs';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { THREAT_LOCATIONS_SECTORS_LIST_SEARCH_DEFAULTS, threatLocationsSectorsListSearchSchema } from '../threat-locations-sectors-list-search';
import { ThreatTargetsTab } from './threat-targets-tab';

// The canvas needs WebGL, which jsdom lacks: a click on it picks France, as a click on the country would.
vi.mock('./targeted-countries-map-canvas', () => ({
  TargetedCountriesMapCanvas: ({ onSelect }: TargetedCountriesMapCanvasProps) => (
    <button type="button" onClick={() => onSelect?.('019a0000-0000-7000-8000-0000000000f1')}>pick France</button>
  ),
}));

// The provider reads the user's theme through its own queries; the tab only needs the effective one.
vi.mock('../../../providers', async (importOriginal) => ({
  ...await importOriginal<typeof Providers>(),
  useTheme: () => ({ effectiveTheme: 'light' }),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const FRANCE_ID = '019a0000-0000-7000-8000-0000000000f1';
const NO_LONGER_TARGETED_ID = '019a0000-0000-7000-8000-0000000000aa';

const location = (index: number, overrides: Partial<ThreatAnalysisDetailData['locations'][number]> = {}): ThreatAnalysisDetailData['locations'][number] => {
  const name = `Place ${String(index).padStart(2, '0')}`;
  return {
    id: `location-${index}`,
    stixId: `location--${index}`,
    name,
    country: name,
    countryId: `019a0000-0000-7000-8000-${String(index).padStart(12, '0')}`,
    countryIsoAlpha2: null,
    matchesOrganization: false,
    openctiStixRelationId: null,
    ...overrides,
  };
};

// France concerns the tenant and comes first, then the 24 places by name: page 2 holds Place 10 to 19.
const LOCATIONS = [
  location(0, { name: 'France', country: 'France', countryId: FRANCE_ID, countryIsoAlpha2: 'FR', matchesOrganization: true }),
  ...Array.from({ length: 24 }, (_, index) => location(index + 1)),
];

const detailWith = (locations: ThreatAnalysisDetailData['locations']): ThreatAnalysisDetailData => ({
  analysis: {
    id: '019a0000-0000-7000-8000-000000000a01',
    stixId: 'intrusion-set--1',
    entityType: 'intrusion-set',
    name: 'APT28',
    description: null,
    mitreGroupId: null,
    confidence: null,
    stixCreated: null,
    firstSeen: null,
    lastSeen: null,
    primaryMotivation: null,
    resourceLevel: null,
    sophistication: null,
    objective: null,
  },
  attributedTo: [],
  attributedFrom: [],
  threatActorTypes: [],
  roles: [],
  origin: { kind: 'stix-import', stixId: 'intrusion-set--1', lastIngestedAt: '2026-01-01T00:00:00Z' },
  activity: { activityScore: 0, lastObservedAt: null, lastObservedVia: null },
  locations,
  sectors: [{ id: 'sector-1', stixId: 'identity--1', name: 'Finance', sectorId: null, matchesOrganization: false, openctiStixRelationId: null }],
  cves: [],
  techniques: [],
  declaredIntent: { primaryMotivations: [], secondaryMotivations: [], goals: [] },
});

const DETAIL = detailWith(LOCATIONS);

const renderTab = (search = '', detail = DETAIL) => {
  const answers = { 'integrations.getConnectorsStatus': { opencti: { url: 'https://opencti.example' } } };
  const rootRoute = createRootRoute({ component: Outlet });
  const tabRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/$tenantId/{-$organizationId}/locations-sectors',
    validateSearch: threatLocationsSectorsListSearchSchema,
    search: { middlewares: [stripSearchParams(THREAT_LOCATIONS_SECTORS_LIST_SEARCH_DEFAULTS)] },
    component: (): ReactNode => <ThreatTargetsTab detail={detail} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([tabRoute]),
    history: createMemoryHistory({ initialEntries: [`/tenant-1/locations-sectors${search}`] }),
  });
  renderWithTrpc(<RouterProvider router={router} />, { answers });
  return router;
};

const searchParams = (router: ReturnType<typeof renderTab>) => new URLSearchParams(router.history.location.href.split('?')[1] ?? '');

const goToPageTwo = async () => {
  const [locationsNext] = await screen.findAllByRole('button', { name: 'Go to next page' });
  fireEvent.click(locationsNext);
  await screen.findByText('Place 10');
};

describe('ThreatTargetsTab', () => {
  it('should keep the locations page across a render that changes none of its rows', async () => {
    const router = renderTab();
    await goToPageTwo();

    await act(() => router.navigate({ to: '.', search: (prev) => ({ ...prev, sectorSearch: 'fin' }), replace: true }));

    expect(screen.getByText('Place 10')).not.toBeNull();
    expect(screen.queryByText('France')).toBeNull();
  });

  it('should page the locations by ten, with no type column', async () => {
    renderTab();

    expect(await screen.findByText('Place 09')).not.toBeNull();
    expect(screen.queryByText('Place 10')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Type' })).toBeNull();
  });

  it('should show no map when the threat targets no known country', async () => {
    renderTab('', detailWith([location(1, { country: null, countryId: null })]));

    expect(await screen.findByText('Place 01')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'pick France' })).toBeNull();
    expect(screen.queryByText('Targeted countries')).toBeNull();
  });

  it('should go back to the first page on a new search', async () => {
    const router = renderTab();
    await goToPageTwo();

    const field = screen.getByPlaceholderText('Search locations...');
    fireEvent.change(field, { target: { value: 'place 0' } });
    fireEvent.blur(field);

    expect(await screen.findByText('Place 01')).not.toBeNull();
    expect(screen.queryByText('Place 10')).toBeNull();
    expect(searchParams(router).get('locationSearch')).toBe('place 0');
  });

  it('should filter on the country picked on the map, from any page, and clear it with the chip', async () => {
    const router = renderTab();
    await goToPageTwo();

    fireEvent.click(await screen.findByRole('button', { name: 'pick France' }));

    expect(await screen.findByText('Country: France')).not.toBeNull();
    expect(screen.getByText('France')).not.toBeNull();
    expect(screen.queryByText('Place 01')).toBeNull();
    expect(searchParams(router).get('country')).toBe(FRANCE_ID);

    fireEvent.click(screen.getByRole('button', { name: 'Remove the country filter' }));

    expect(await screen.findByText('Place 01')).not.toBeNull();
    expect(screen.queryByText('Country: France')).toBeNull();
    expect(searchParams(router).has('country')).toBe(false);
  });

  it('should read the country filter from the address', async () => {
    renderTab(`?country=${FRANCE_ID}`);

    expect(await screen.findByText('Country: France')).not.toBeNull();
    expect(screen.queryByText('Place 01')).toBeNull();
  });

  it('should show every location, and no chip, for a country the threat no longer targets', async () => {
    renderTab(`?country=${NO_LONGER_TARGETED_ID}`);

    expect(await screen.findByText('Place 01')).not.toBeNull();
    expect(screen.getByText('France')).not.toBeNull();
    expect(screen.queryByText(/^Country: /)).toBeNull();
  });

  it('should show no OpenCTI column when no relationship resolves, as for a STIX import', async () => {
    renderTab();

    await screen.findByText('Place 01');
    expect(screen.queryByRole('columnheader', { name: 'OpenCTI' })).toBeNull();
  });

  it('should link a relationship the tenant\'s OpenCTI resolves', async () => {
    renderTab('', detailWith([location(1, { openctiStixRelationId: 'relationship--6f1c1d6e-1e0b-4c5a-9a55-4c8a8f0a1b2c' })]));

    expect(await screen.findByRole('link', { name: 'Open this relationship in OpenCTI' })).not.toBeNull();
  });
});
