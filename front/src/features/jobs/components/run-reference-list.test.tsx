/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ResolvedReference } from '../run-references-utils';
import { RunReferenceList } from './run-reference-list';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderReferences = (references: Array<ResolvedReference>, onRowClick: () => void) => {
  const rootRoute = createRootRoute({ component: Outlet });
  const scopeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/$tenantId/{-$organizationId}',
    component: (): ReactNode => (
      <I18nProvider i18n={i18n}>
        <div data-testid="row" onClick={onRowClick}>
          <RunReferenceList references={references} />
        </div>
      </I18nProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([scopeRoute]),
    history: createMemoryHistory({ initialEntries: ['/tenant-1'] }),
  });
  return render(<RouterProvider router={router} />);
};

describe('RunReferenceList', () => {
  it('renders an empty value when there are no references', async () => {
    renderReferences([], vi.fn());
    expect(await screen.findByText('-')).toBeDefined();
  });

  it.each([
    [{ kind: 'riskScenario', id: 'scenario-1', label: 'Ransomware' }, '/tenant-1/risk-scenarios/scenario-1'],
    [{ kind: 'serviceAccount', id: 'sa-1', label: 'svc-first' }, '/tenant-1/settings/security/service-accounts/sa-1'],
    [{ kind: 'user', id: 'user-1', label: 'Jamie' }, '/tenant-1/settings/security/users/user-1'],
  ] satisfies Array<[ResolvedReference, string]>)('links %o to its page, in the current tenant, with the full id as its title', async (reference, href) => {
    renderReferences([reference], vi.fn());

    const element = await screen.findByText(reference.label);
    expect(element.tagName).toBe('A');
    expect(element.getAttribute('href')).toBe(href);
    expect(element.getAttribute('title')).toBe(reference.id);
  });

  it('renders a service account whose name is hidden as "Service account", with no link and no id prefix', async () => {
    const reference: ResolvedReference = { kind: 'serviceAccount', id: 'b4d5e6f7-a8b9-4c0d-9e2f-3a4b5c6d7e8f', label: 'b4d5e6f7', nameHidden: true };
    renderReferences([reference], vi.fn());

    const element = await screen.findByText('Service account');
    expect(element.closest('a')).toBeNull();
    expect(screen.queryByText('b4d5e6f7')).toBeNull();
  });

  it('links a service account by its id prefix while its name is still loading', async () => {
    const reference: ResolvedReference = { kind: 'serviceAccount', id: 'b4d5e6f7-a8b9-4c0d-9e2f-3a4b5c6d7e8f', label: 'b4d5e6f7', nameHidden: false };
    renderReferences([reference], vi.fn());

    const element = await screen.findByText('b4d5e6f7');
    expect(element.tagName).toBe('A');
    expect(screen.queryByText('Service account')).toBeNull();
  });

  it('renders a stored file, which has no page, as plain text rather than a link', async () => {
    const reference: ResolvedReference = { kind: 'storedFile', id: 'file-1', label: 'bundle.json' };
    renderReferences([reference], vi.fn());

    const element = await screen.findByText('bundle.json');
    expect(element.tagName).toBe('SPAN');
  });

  it('separates several references with a comma', async () => {
    const references: Array<ResolvedReference> = [
      { kind: 'riskScenario', id: 'scenario-1', label: 'Ransomware' },
      { kind: 'user', id: 'user-1', label: 'Jamie' },
    ];
    renderReferences(references, vi.fn());

    expect(await screen.findByText(',')).toBeDefined();
  });

  it('never lets a click on a reference reach the row it sits in', async () => {
    const onRowClick = vi.fn();
    const reference: ResolvedReference = { kind: 'riskScenario', id: 'scenario-1', label: 'Ransomware' };
    renderReferences([reference], onRowClick);

    fireEvent.click(await screen.findByText('Ransomware'));

    expect(onRowClick).not.toHaveBeenCalled();
  });
});
