/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { TenantProvider } from '../../../providers/tenant-provider';
import { primaryAssetDependenciesListSearchSchema } from '../primary-asset-dependencies-list-search';
import { PrimaryToPrimaryLinksCard } from './primary-to-primary-links-card';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const PRIMARY_ASSET_ID = '019edb28-0011-7000-8000-0000000000a1';

const LINKS = [
  {
    id: '019edb28-0011-7000-8000-0000000000b1',
    direction: 'depends',
    relatedAssetId: '019edb28-0011-7000-8000-0000000000c1',
    relatedAssetName: 'Payment provider',
    strength: 'critical',
    dependencyResourceTypeId: '019edb28-0011-7000-8000-0000000000d1',
    dependencyResourceTypeName: 'Supplier',
  },
  {
    id: '019edb28-0011-7000-8000-0000000000b2',
    direction: 'provides',
    relatedAssetId: '019edb28-0011-7000-8000-0000000000c2',
    relatedAssetName: 'Payroll',
    strength: 'minor',
    dependencyResourceTypeId: null,
    dependencyResourceTypeName: null,
  },
];

const renderCard = () => {
  const rootRoute = createRootRoute({ component: Outlet });
  const assetRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/$tenantId',
    validateSearch: primaryAssetDependenciesListSearchSchema,
    component: (): ReactNode => (
      <TenantProvider tenantId="tenant-1">
        <PrimaryToPrimaryLinksCard primaryAssetId={PRIMARY_ASSET_ID} />
      </TenantProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([assetRoute]),
    history: createMemoryHistory({ initialEntries: ['/tenant-1'] }),
  });
  return renderWithTrpc(<RouterProvider router={router} />, { answers: { 'assetDependencies.getPrimaryToPrimaryLinks': LINKS } });
};

const rowOf = async (assetName: string) => {
  const row = (await screen.findByText(assetName)).closest('tr');
  if (row === null) {
    throw new Error(`no row for ${assetName}`);
  }
  return within(row);
};

describe('PrimaryToPrimaryLinksCard', () => {
  it('should list a link in each direction with the other asset, its strength and what it runs through', async () => {
    renderCard();

    const dependsOn = await rowOf('Payment provider');
    expect(dependsOn.getByText('Depends on')).toBeTruthy();
    expect(dependsOn.getByText('Critical')).toBeTruthy();
    expect(dependsOn.getByText('Supplier')).toBeTruthy();

    const supports = await rowOf('Payroll');
    expect(supports.getByText('Supports')).toBeTruthy();
    expect(supports.getByText('Minor')).toBeTruthy();
  });

  it('should keep only the link without a type once "No type" is picked', async () => {
    renderCard();
    await screen.findByText('Payroll');

    await userEvent.click(screen.getByRole('button', { name: 'Runs through' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'No type' }));

    await waitFor(() => expect(screen.queryByText('Payment provider')).toBeNull());
    expect(screen.getByText('Payroll')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Runs through: No type' })).toBeTruthy();
  });
});
