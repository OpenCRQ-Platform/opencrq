/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FindingHeaderPanel } from './finding-header-panel';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

type HeaderProps = ComponentProps<typeof FindingHeaderPanel>;

const PENDING: HeaderProps = {
  tenantId: 'tenant-1',
  cveId: 'CVE-2026-9999999',
  cveTitle: null,
  score: null,
  band: null,
  pendingVector: true,
  nvdRecordMissing: false,
  supportingAssetId: '019edb28-0011-7000-8000-0000000000a1',
  assetName: { name: 'ACME-BKP-01', derivedName: null },
  assetCategoryId: 'host',
  state: 'applicable',
  stateOrigin: null,
  dismissalType: null,
  stateDuration: null,
  otherImpactedAssetCount: 0,
  sources: [],
  actions: null,
};

const renderHeader = (props: HeaderProps) => {
  const rootRoute = createRootRoute({ component: Outlet });
  const scopeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/$tenantId/{-$organizationId}',
    component: (): ReactNode => (
      <I18nProvider i18n={i18n}>
        <FindingHeaderPanel {...props} />
      </I18nProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([scopeRoute]),
    history: createMemoryHistory({ initialEntries: ['/tenant-1'] }),
  });
  return render(<RouterProvider router={router} />);
};

describe('FindingHeaderPanel score tile', () => {
  it('should say NVD holds no usable record in place of the pending vector once a pass found none', async () => {
    renderHeader({ ...PENDING, nvdRecordMissing: true });

    expect(await screen.findByText('No usable NVD record')).toBeTruthy();
    expect(screen.queryByText('Pending vector')).toBeNull();
  });

  it('should show the pending vector while NVD was not found lacking', async () => {
    renderHeader(PENDING);

    expect(await screen.findByText('Pending vector')).toBeTruthy();
    expect(screen.queryByText('No usable NVD record')).toBeNull();
  });

  it('should show the score of a finding another source scored, whatever NVD holds', async () => {
    renderHeader({ ...PENDING, pendingVector: false, nvdRecordMissing: true, score: 42, band: 'medium' });

    expect(await screen.findByText('Finding score')).toBeTruthy();
    expect(screen.queryByText('No usable NVD record')).toBeNull();
  });
});
