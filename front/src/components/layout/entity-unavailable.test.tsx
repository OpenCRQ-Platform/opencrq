/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, linkOptions, Outlet, RouterProvider } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EntityUnavailable } from './entity-unavailable';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const TITLE = 'Asset unavailable';
const DESCRIPTION = 'This asset has been deleted or is no longer accessible.';
const LIST_LABEL = 'See all assets';

const renderUnavailable = (initialEntries: Array<string>) => {
  const rootRoute = createRootRoute({ component: Outlet });
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/$tenantId/{-$organizationId}/risk-scenarios',
    component: (): ReactNode => <p>List page</p>,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId',
    component: (): ReactNode => (
      <EntityUnavailable
        title={TITLE}
        description={DESCRIPTION}
        listLabel={LIST_LABEL}
        listLink={linkOptions({ from: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId', to: '..' })}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries }),
  });
  render(<I18nProvider i18n={i18n}><RouterProvider router={router} /></I18nProvider>);
  return router;
};

describe('EntityUnavailable', () => {
  it('shows the title as the level 1 heading and the description', async () => {
    renderUnavailable(['/t1/risk-scenarios/i1']);

    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(TITLE);
    expect(screen.getByText(DESCRIPTION)).toBeTruthy();
  });

  it('links to the list with the params of the current route', async () => {
    renderUnavailable(['/t1/risk-scenarios/i1']);

    const link = await screen.findByRole('link', { name: LIST_LABEL });
    expect(link.getAttribute('href')).toBe('/t1/risk-scenarios');
  });

  it('offers no Go Back when the page was opened directly', async () => {
    renderUnavailable(['/t1/risk-scenarios/i1']);

    await screen.findByRole('link', { name: LIST_LABEL });
    expect(screen.queryByRole('button', { name: 'Go Back' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
  });

  it('offers Go Back after an internal navigation, and it returns to the previous page', async () => {
    const router = renderUnavailable(['/t1/risk-scenarios']);
    await screen.findByText('List page');

    await act(async () => {
      await router.navigate({ to: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId', params: { tenantId: 't1', riskScenarioId: 'i1' } });
    });

    const back = await screen.findByRole('button', { name: 'Go Back' });
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();

    fireEvent.click(back);

    await waitFor(() => expect(router.state.location.pathname).toBe('/t1/risk-scenarios'));
  });
});
