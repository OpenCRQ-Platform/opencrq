/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../utils/actor-utils';
import { ActorName } from './actor-name';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderActor = (actor: Actor) => {
  const rootRoute = createRootRoute({ component: Outlet });
  const scopeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/$tenantId/{-$organizationId}',
    component: (): ReactNode => (
      <I18nProvider i18n={i18n}>
        <ActorName actor={actor} />
      </I18nProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([scopeRoute]),
    history: createMemoryHistory({ initialEntries: ['/tenant-1'] }),
  });
  return render(<RouterProvider router={router} />);
};

describe('ActorName', () => {
  it('renders a user as plain text, without a link', async () => {
    const { container } = renderActor({ kind: 'user', label: 'Jamie Doe' });

    expect(await screen.findByText('Jamie Doe')).toBeDefined();
    expect(container.querySelector('a')).toBeNull();
  });

  it('links a named service account to its page, with the full id as its title', async () => {
    renderActor({ kind: 'serviceAccount', id: 'sa-1', name: 'Sync Bot' });

    const element = await screen.findByText('Sync Bot');
    expect(element.tagName).toBe('A');
    expect(element.getAttribute('href')).toBe('/tenant-1/settings/security/service-accounts/sa-1');
    expect(element.getAttribute('title')).toBe('sa-1');
  });

  it('renders a service account whose name is hidden as the generic label, without a link', async () => {
    const { container } = renderActor({ kind: 'serviceAccount', id: 'sa-1', name: null });

    expect(await screen.findByText('Service account')).toBeDefined();
    expect(container.querySelector('a')).toBeNull();
  });
});
