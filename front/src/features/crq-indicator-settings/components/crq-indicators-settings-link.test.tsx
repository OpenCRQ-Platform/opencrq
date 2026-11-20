/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NEVER, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { CrqIndicatorsSettingsLink } from './crq-indicators-settings-link';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderLink = (hasManageSecurity: unknown, link: ReactNode = <CrqIndicatorsSettingsLink>CRQ indicators</CrqIndicatorsSettingsLink>) => {
  const rootRoute = createRootRoute({ component: Outlet });
  const scopeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/$tenantId/{-$organizationId}', component: () => link });
  const router = createRouter({ routeTree: rootRoute.addChildren([scopeRoute]), history: createMemoryHistory({ initialEntries: ['/tenant-1'] }) });
  return renderWithTrpc(<RouterProvider router={router} />, { answers: { 'capabilities.hasManageSecurity': hasManageSecurity } });
};

describe('CrqIndicatorsSettingsLink', () => {
  it('should link to the CRQ indicators settings for a security manager', async () => {
    renderLink(true);

    const link = await screen.findByRole('link', { name: 'CRQ indicators' });
    expect(link.getAttribute('href')).toBe('/tenant-1/settings/engine/crq-indicators');
  });

  it('should render the words as plain text for a member without the capability', async () => {
    const { calls, queryClient } = renderLink(false);

    await waitFor(() => expect(calls.some((call) => call.path === 'capabilities.hasManageSecurity')).toBe(true));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(await screen.findByText('CRQ indicators')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('should render the words as plain text while the capability is loading', async () => {
    renderLink(NEVER);

    expect(await screen.findByText('CRQ indicators')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('should forward the click handler to the link', async () => {
    const onClick = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    renderLink(true, <CrqIndicatorsSettingsLink onClick={onClick}>CRQ indicators</CrqIndicatorsSettingsLink>);

    fireEvent.click(await screen.findByRole('link', { name: 'CRQ indicators' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
