/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AssessmentByline } from './assessment-byline';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

type BylineFields = ComponentProps<typeof AssessmentByline>['assessment'];

const OPENING_ACCOUNT_ID = '019edb28-0011-7000-8000-0000000000a1';
const PUBLISHING_ACCOUNT_ID = '019edb28-0011-7000-8000-0000000000b2';

const assessment = (overrides: Partial<BylineFields>): BylineFields => ({
  frameworkTitle: 'ISO 27001',
  createdAt: '2026-09-15T10:00:00.000Z',
  createdBy: null,
  createdByServiceAccount: null,
  publishedAt: '2026-09-20T10:00:00.000Z',
  publishedBy: null,
  publishedByServiceAccount: null,
  ...overrides,
});

const renderByline = (fields: BylineFields) => {
  const rootRoute = createRootRoute({ component: Outlet });
  const scopeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/$tenantId/{-$organizationId}',
    component: (): ReactNode => (
      <I18nProvider i18n={i18n}>
        <AssessmentByline assessment={fields} />
      </I18nProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([scopeRoute]),
    history: createMemoryHistory({ initialEntries: ['/tenant-1'] }),
  });
  return render(<RouterProvider router={router} />);
};

describe('AssessmentByline', () => {
  it('credits the people who opened and published it, as plain text', async () => {
    const { container } = renderByline(assessment({
      createdBy: { id: '019edb28-0011-7000-8000-0000000000c3', name: 'Jamie Doe', email: 'jamie@example.com' },
      publishedBy: { id: '019edb28-0011-7000-8000-0000000000d4', name: null, email: 'sam@example.com' },
    }));

    expect(await screen.findByText('Jamie Doe')).toBeDefined();
    expect(container.textContent).toMatch(/opened on .* by Jamie Doe · published on .* by sam@example\.com$/);
    expect(container.querySelector('a')).toBeNull();
  });

  it('links each named service account to its own page, the opening one and the publishing one', async () => {
    const { container } = renderByline(assessment({
      createdByServiceAccount: { id: OPENING_ACCOUNT_ID, name: 'Import Bot' },
      publishedByServiceAccount: { id: PUBLISHING_ACCOUNT_ID, name: 'Publish Bot' },
    }));

    const opening = await screen.findByText('Import Bot');
    const publishing = screen.getByText('Publish Bot');
    expect(opening.getAttribute('href')).toBe(`/tenant-1/settings/security/service-accounts/${OPENING_ACCOUNT_ID}`);
    expect(publishing.getAttribute('href')).toBe(`/tenant-1/settings/security/service-accounts/${PUBLISHING_ACCOUNT_ID}`);
    expect(container.textContent).toMatch(/opened on .* by Import Bot · published on .* by Publish Bot$/);
  });

  it('shows "Service account" with no link and no id when the names are hidden from the reader', async () => {
    const { container } = renderByline(assessment({
      createdByServiceAccount: { id: OPENING_ACCOUNT_ID, name: null },
      publishedByServiceAccount: { id: PUBLISHING_ACCOUNT_ID, name: null },
    }));

    expect(await screen.findAllByText('Service account')).toHaveLength(2);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).not.toContain(OPENING_ACCOUNT_ID.slice(0, 8));
  });
});
