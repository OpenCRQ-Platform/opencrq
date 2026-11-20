/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import { NEVER, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { CweDetailPage } from './cwe-detail-page';

type CweDetail = inferRouterOutputs<TRPCRouter>['cwe']['get'];

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const CWE_ID = 'CWE-287';
const SHIPPED_ID = '019edb28-0011-7000-8000-000000000001';
const ADDED_ID = '019edb28-0011-7000-8000-000000000002';
const REMOVED_ID = '019edb28-0011-7000-8000-000000000003';

const SHIPPED_NAME = 'Valid Accounts';
const ADDED_NAME = 'Phishing';
const REMOVED_NAME = 'Brute Force';

const CWE: CweDetail = {
  externalId: CWE_ID,
  name: 'Improper Authentication',
  description: 'The product does not prove the identity of an actor.',
  overrideCount: 2,
  techniques: [
    {
      techniqueId: SHIPPED_ID,
      externalId: 'T1078',
      name: SHIPPED_NAME,
      state: 'shipped',
      justifications: [{ kind: 'consequence', ref: 'Gain Privileges', name: null }],
    },
    { techniqueId: ADDED_ID, externalId: 'T1566', name: ADDED_NAME, state: 'added', justifications: [] },
    { techniqueId: REMOVED_ID, externalId: 'T1110', name: REMOVED_NAME, state: 'removed', justifications: [] },
  ],
};

const renderCweDetailPage = (hasManageSecurity: boolean | typeof NEVER) => {
  const rootRoute = createRootRoute({});
  const tenantRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '$tenantId',
    component: (): ReactNode => <CweDetailPage cweId={CWE_ID} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([tenantRoute]),
    history: createMemoryHistory({ initialEntries: ['/tenant-1'] }),
  });
  const utils = renderWithTrpc(<RouterProvider router={router} />, {
    answers: { 'cwe.get': CWE, 'capabilities.hasManageSecurity': hasManageSecurity },
  });
  return utils;
};

const expectTechniquesListed = async () => {
  expect(await screen.findByText(SHIPPED_NAME)).toBeDefined();
  expect(screen.getByText(ADDED_NAME)).toBeDefined();
  expect(screen.getByText(REMOVED_NAME)).toBeDefined();
};

const expectNoEditControls = () => {
  expect(screen.queryByRole('button', { name: 'Add technique' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
};

describe('CweDetailPage', () => {
  it('lists the techniques with no edit control for a member without MANAGE_SECURITY', async () => {
    const { queryClient } = renderCweDetailPage(false);

    await expectTechniquesListed();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));

    expectNoEditControls();
  });

  it('lists the techniques with no edit control while the capability is loading', async () => {
    const { queryClient, calls } = renderCweDetailPage(NEVER);

    await expectTechniquesListed();

    expectNoEditControls();
    await waitFor(() => expect(calls.map((call) => call.path)).toContain('capabilities.hasManageSecurity'));
    expect(queryClient.isFetching()).toBeGreaterThan(0);
  });

  it('keeps every edit control for a member with MANAGE_SECURITY', async () => {
    const { calls } = renderCweDetailPage(true);

    await expectTechniquesListed();
    expect(await screen.findByRole('button', { name: 'Add technique' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Restore' })).toHaveLength(1);

    const shippedRow = screen.getByText(SHIPPED_NAME).closest('tr')!;
    fireEvent.click(within(shippedRow).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({
      path: 'cwe.removeTechnique',
      type: 'mutation',
      input: { cweId: CWE_ID, techniqueId: SHIPPED_ID },
    })));
  });
});
