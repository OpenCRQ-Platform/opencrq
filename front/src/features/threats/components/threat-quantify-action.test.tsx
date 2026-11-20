/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ThreatQuantifyAction } from './threat-quantify-action';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const OUTCOME_ID = '0190a000-0000-7000-8000-0000000000aa';

const renderAction = () => {
  const rootRoute = createRootRoute({ component: Outlet });
  const scopeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/$tenantId/{-$organizationId}',
    component: (): ReactNode => (
      <I18nProvider i18n={i18n}>
        <ThreatQuantifyAction attackOutcomeId={OUTCOME_ID} outcomeName="Ransomware" />
      </I18nProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([scopeRoute]),
    history: createMemoryHistory({ initialEntries: ['/tenant-1'] }),
  });
  return render(<RouterProvider router={router} />);
};

describe('ThreatQuantifyAction', () => {
  it('opens the risk scenario wizard with the outcome prefilled', async () => {
    renderAction();

    const link = await screen.findByRole('link', { name: 'Quantify risk' });
    expect(link.getAttribute('href')).toBe(`/tenant-1/risk-scenarios/create?attackOutcomeId=${OUTCOME_ID}`);
    // The hint is the design system tooltip, never a native title.
    expect(link.getAttribute('title')).toBeNull();
    act(() => link.focus());
    expect((await screen.findAllByText('Create a risk scenario for Ransomware')).length).toBeGreaterThan(0);
  });
});
