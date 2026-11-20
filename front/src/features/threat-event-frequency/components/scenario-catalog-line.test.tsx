/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TefCatalog, TefRead } from '../threat-event-frequency-utils';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { ScenarioCatalogLine } from './scenario-catalog-line';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const FINANCE_ID = '019e0000-0000-7000-8000-000000000001';
const USA_ID = '019e0000-0000-7000-8000-000000000003';
const RANSOMWARE_ID = '019e0000-0000-7000-8000-0000000000a1';
const SCOPE = { id: '019e0000-0000-7000-8000-0000000000b1', name: 'US subsidiary', sectorId: FINANCE_ID, countryId: USA_ID, employeeCount: 6200, revenueBand: '100m_1b' };

const CATALOG: TefCatalog = {
  id: 'opencrq-open-data',
  version: '1.0.0',
  builtOn: '2026-11-08',
  publisher: 'Filigran',
  sources: [],
  sizeClasses: ['0-9', '10-49', '50-249', '250-999', '1000-4999', '5000+'],
  outcomes: [{ id: RANSOMWARE_ID, name: 'Ransomware' }],
  sectors: [{ id: FINANCE_ID, name: 'Finance', measured: true }],
  countries: [{ id: USA_ID, name: 'United States of America', isoAlpha3: 'USA', readAs: 'US' }],
  revenueBands: [],
};

/** Ransomware on the scope's profile: 0.4 attempts a year, read for a size the surveys do not publish. */
const READ: TefRead = {
  catalogue: { id: CATALOG.id, version: CATALOG.version },
  countryIsoAlpha3: 'USA',
  sectorName: 'Finance',
  sizeSource: 'employee_count',
  country: 'US',
  sector: 'Finance',
  sizeClasses: [{ sizeClass: '5000+', weight: 1 }],
  low: 0.072,
  likely: 0.4,
  high: 1.3,
  notMeasured: ['size'],
  sources: [],
};

const renderLine = (tefMode: 'auto' | 'manual', likely: number | null) => {
  const rootRoute = createRootRoute({
    component: (): ReactNode => (
      <ScenarioCatalogLine organizationId={SCOPE.id} attackOutcomeId={RANSOMWARE_ID} tefMode={tefMode} likely={likely} autoRead={tefMode === 'auto' ? READ : null} />
    ),
  });
  return renderWithTrpc(
    <RouterProvider router={createRouter({ routeTree: rootRoute, history: createMemoryHistory() })} />,
    {
      answers: {
        'crqIndicators.getTefCatalog': CATALOG,
        'organizations.getOrganization': SCOPE,
        'crqIndicators.getTefCatalogReading': { outcomes: [{ attackOutcomeId: RANSOMWARE_ID, name: 'Ransomware', read: READ }], total: { low: 0.072, likely: 0.4, high: 1.3 } },
      },
    },
  );
};

describe('ScenarioCatalogLine', () => {
  it('should name the outcome and the profile an auto estimate reads, a size not measured in the alert tone', async () => {
    const { calls } = renderLine('auto', 0.4);

    expect(await screen.findByText('Ransomware')).toBeTruthy();
    expect(screen.getByText('United States of America')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^6,200 employees\. Size not published by the surveys/ })).toBeTruthy();
    expect(calls.some((call) => call.path === 'crqIndicators.getTefCatalogReading')).toBe(false);
  });

  it('should give a typed value the catalogue\'s value, its range and the ratio to it', async () => {
    renderLine('manual', 1);

    expect(await screen.findByText('×2.5 the catalog')).toBeTruthy();
    expect(screen.getByText('0.072 to 1.3')).toBeTruthy();
  });

  it('should give no ratio to a typed value equal to the catalogue\'s', async () => {
    renderLine('manual', 0.4);

    expect(await screen.findByText('0.4')).toBeTruthy();
    expect(screen.queryByText(/the catalog$/)).toBeNull();
  });
});
