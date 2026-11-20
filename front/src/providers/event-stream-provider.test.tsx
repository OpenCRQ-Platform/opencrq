/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { useQuery } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { cleanup, screen, waitFor } from '@testing-library/react';
import type { FunctionComponent, ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AuthContextType } from '../features/auth/auth-context';
import { AuthContext } from '../features/auth/auth-context';
import { useTRPC } from '../lib/trpc';
import { EventStreamProvider } from './event-stream-provider';
import { createTrpcTestStream, renderWithTrpc } from './trpc-test-harness';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const PINS_PATH = 'organizations.getUnpinnedOrganizationIds';
const TENANTS_PATH = 'tenants.getTenants';

const LOGGED_IN: AuthContextType = {
  status: 'logged-in',
  user: { id: 'user-1', email: 'jamie@example.com', name: null, title: null },
  session: { sessionExpiresAt: null, renewsThroughXtmOne: false },
  logout: async () => {},
};
const LOGGED_OUT: AuthContextType = { status: 'logged-out' };

/** Shows two cached queries, so a doorbell can be seen refreshing one and leaving the other. */
const Page: FunctionComponent = () => {
  const trpc = useTRPC();
  const pins = useQuery(trpc.organizations.getUnpinnedOrganizationIds.queryOptions());
  const tenants = useQuery(trpc.tenants.getTenants.queryOptions());
  return (
    <>
      <p>{`pins: ${pins.data?.join(',') ?? 'loading'}`}</p>
      <p>{`tenants: ${tenants.data?.map((tenant) => tenant.id).join(',') ?? 'loading'}`}</p>
    </>
  );
};

const renderPage = (auth: AuthContextType, answers: Record<string, unknown>) => {
  const rootRoute = createRootRoute({ component: Outlet });
  const tenantRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/$tenantId',
    component: (): ReactNode => (
      <AuthContext.Provider value={auth}>
        <EventStreamProvider><Page /></EventStreamProvider>
      </AuthContext.Provider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([tenantRoute]),
    history: createMemoryHistory({ initialEntries: ['/tenant-1'] }),
  });
  return renderWithTrpc(<RouterProvider router={router} />, { answers });
};

/** An answer that changes with each call, so a refetch is visible on screen. */
const answerSequence = (...values: Array<unknown>) => {
  let calls = 0;
  return () => values[Math.min(calls++, values.length - 1)];
};

describe('EventStreamProvider', () => {
  it('should refetch the queries of the procedures a doorbell names, and only those', async () => {
    const doorbells = createTrpcTestStream();
    const { calls } = renderPage(LOGGED_IN, {
      'events.onDataChanged': doorbells,
      [PINS_PATH]: answerSequence(['scope-1'], ['scope-1', 'scope-2']),
      [TENANTS_PATH]: answerSequence([{ id: 'tenant-1' }], [{ id: 'tenant-1' }, { id: 'tenant-2' }]),
    });
    await screen.findByText('pins: scope-1');
    await screen.findByText('tenants: tenant-1');
    await waitFor(() => expect(calls.some((call) => call.path === 'events.onDataChanged')).toBe(true));

    doorbells.push({ procedures: [PINS_PATH], all: false });

    await screen.findByText('pins: scope-1,scope-2');
    expect(screen.getByText('tenants: tenant-1')).toBeTruthy();
    expect(calls.filter((call) => call.path === TENANTS_PATH)).toHaveLength(1);
  });

  it('should refetch every query on a doorbell standing for every table', async () => {
    const doorbells = createTrpcTestStream();
    renderPage(LOGGED_IN, {
      'events.onDataChanged': doorbells,
      [PINS_PATH]: answerSequence(['scope-1'], ['scope-1', 'scope-2']),
      [TENANTS_PATH]: answerSequence([{ id: 'tenant-1' }], [{ id: 'tenant-1' }, { id: 'tenant-2' }]),
    });
    await screen.findByText('pins: scope-1');
    await screen.findByText('tenants: tenant-1');

    doorbells.push({ procedures: [], all: true });

    await screen.findByText('pins: scope-1,scope-2');
    await screen.findByText('tenants: tenant-1,tenant-2');
  });

  it('should subscribe to the tenant of the page, and not at all while logged out', async () => {
    const loggedIn = renderPage(LOGGED_IN, { 'events.onDataChanged': createTrpcTestStream() });
    await waitFor(() => expect(loggedIn.calls.filter((call) => call.path === 'events.onDataChanged')).toEqual([
      expect.objectContaining({ type: 'subscription', input: { tenantId: 'tenant-1' } }),
    ]));
    cleanup();

    const loggedOut = renderPage(LOGGED_OUT, { 'events.onDataChanged': createTrpcTestStream() });
    await screen.findByText('pins: loading');
    await waitFor(() => expect(loggedOut.calls.some((call) => call.path === PINS_PATH)).toBe(true));
    expect(loggedOut.calls.some((call) => call.path === 'events.onDataChanged')).toBe(false);
  });
});
