/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { cleanup, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { FileStorageDataTable } from './file-storage-data-table';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const NAMED_ACCOUNT_ID = '019edb28-0011-7000-8000-0000000000a1';
const HIDDEN_ACCOUNT_ID = '019edb28-0011-7000-8000-0000000000b2';

const storedFile = (originalName: string, uploader: { email?: string, serviceAccountId?: string, serviceAccountName?: string }) => ({
  id: `file-${originalName}`,
  originalName,
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  createdAt: '2026-09-15T10:00:00.000Z',
  createdByEmail: uploader.email ?? null,
  createdByServiceAccountId: uploader.serviceAccountId ?? null,
  createdByServiceAccountName: uploader.serviceAccountName ?? null,
});

const FILES = [
  storedFile('by-person.pdf', { email: 'jamie@example.com' }),
  storedFile('by-named-account.pdf', { serviceAccountId: NAMED_ACCOUNT_ID, serviceAccountName: 'Import Bot' }),
  storedFile('by-hidden-account.pdf', { serviceAccountId: HIDDEN_ACCOUNT_ID }),
];

const renderTable = () => {
  const answers = {
    'fileStorage.list': FILES,
    'fileStorage.getSettings': { enabled: false },
  };
  const rootRoute = createRootRoute({ component: Outlet });
  const scopeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/$tenantId/{-$organizationId}',
    component: (): ReactNode => <FileStorageDataTable />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([scopeRoute]),
    history: createMemoryHistory({ initialEntries: ['/tenant-1'] }),
  });
  return renderWithTrpc(<RouterProvider router={router} />, { answers });
};

const rowOf = async (fileName: string) => {
  const row = (await screen.findByText(fileName)).closest('tr');
  if (row === null) {
    throw new Error(`no row for ${fileName}`);
  }
  return within(row);
};

describe('FileStorageDataTable, Uploaded By', () => {
  it('names a person as plain text', async () => {
    renderTable();

    const row = await rowOf('by-person.pdf');
    expect(row.getByText('jamie@example.com').closest('a')).toBeNull();
  });

  it('links a named service account to its own page', async () => {
    renderTable();

    const row = await rowOf('by-named-account.pdf');
    expect(row.getByText('Import Bot').getAttribute('href')).toBe(`/tenant-1/settings/security/service-accounts/${NAMED_ACCOUNT_ID}`);
  });

  it('shows "Service account" with no link and no id when the name is hidden from the reader', async () => {
    renderTable();

    const row = await rowOf('by-hidden-account.pdf');
    expect(row.getByText('Service account').closest('a')).toBeNull();
    expect(row.queryByText(new RegExp(HIDDEN_ACCOUNT_ID.slice(0, 8)))).toBeNull();
  });
});
