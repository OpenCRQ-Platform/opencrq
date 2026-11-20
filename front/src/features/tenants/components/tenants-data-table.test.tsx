/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { TenantsDataTable } from './tenants-data-table';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const TENANTS = [
  { id: 'tenant-acme', name: 'Acme', memberCount: 3 },
  { id: 'tenant-globex', name: 'Globex', memberCount: 1 },
];

const renderTable = (canCreateTenants: boolean) => {
  const answers = {
    'tenants.getTenantsWithMemberCount': TENANTS,
    'platformCapabilities.hasPlatformCapability': canCreateTenants,
  };
  const rootRoute = createRootRoute({ component: Outlet });
  const scopeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/$tenantId/{-$organizationId}',
    component: (): ReactNode => <TenantsDataTable />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([scopeRoute]),
    history: createMemoryHistory({ initialEntries: ['/tenant-acme'] }),
  });
  return renderWithTrpc(<RouterProvider router={router} />, { answers });
};

const untilQueriesSettle = async ({ queryClient }: { queryClient: { isFetching: () => number } }) => {
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
};

const showLines = async () => {
  fireEvent.click(await screen.findByLabelText('Lines view'));
};

describe('TenantsDataTable, actions by capability', () => {
  it('offers no card menu and no creation without Create Tenants', async () => {
    const rendered = renderTable(false);

    await screen.findByText('Globex');
    await untilQueriesSettle(rendered);
    expect(screen.queryAllByRole('button', { name: 'More actions' })).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Create/ })).toBeNull();
  });

  it('offers Rename and Delete in the card menu with Create Tenants', async () => {
    renderTable(true);

    expect(await screen.findByRole('button', { name: /^Create/ })).toBeTruthy();
    await userEvent.click((await screen.findAllByRole('button', { name: 'More actions' }))[0]);

    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });

  it('opens the rename drawer filled with the tenant name', async () => {
    renderTable(true);

    await userEvent.click((await screen.findAllByRole('button', { name: 'More actions' }))[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText<HTMLInputElement>(/^Name/).value).toBe('Acme');
  });

  it('refuses to create a tenant with a blank name, without a call', async () => {
    const { calls } = renderTable(true);

    await userEvent.click(await screen.findByRole('button', { name: /^Create/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));

    expect(await within(dialog).findByText('Enter a name.')).toBeTruthy();
    expect(calls.filter((call) => call.path === 'tenants.createTenantsTransaction')).toHaveLength(0);
  });

  it('offers row selection for a bulk delete in the list with Create Tenants', async () => {
    renderTable(true);
    await showLines();

    await screen.findByRole('table');
    await screen.findByText('Globex');
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
  });

  it('offers no row selection in the list without Create Tenants', async () => {
    const rendered = renderTable(false);
    await showLines();

    await screen.findByRole('table');
    await screen.findByText('Globex');
    await untilQueriesSettle(rendered);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
