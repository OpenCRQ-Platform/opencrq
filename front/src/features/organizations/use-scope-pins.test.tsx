/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type { QueryClient } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { FunctionComponent } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runInTenant } from '../../lib/tenant-accessor';
import { LoggedUserProvider } from '../../providers/logged-user-provider';
import { TenantQueryClient } from '../../providers/tenant-query-client';
import { TenantProvider } from '../../providers/tenant-provider';
import { FAILED, renderWithTrpc } from '../../providers/trpc-test-harness';
import { scopeMemoryCollection } from '../../stores';
import { updateScopeMemory, useScopePins } from './use-scope-pins';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const TENANT_ID = 'tenant-1';
const SCOPE_ID = 'scope-1';
const OTHER_SCOPE_ID = 'scope-2';

const PinToggle: FunctionComponent = () => {
  const { isPinned, setPinned } = useScopePins();
  return (
    <>
      <p>{isPinned(SCOPE_ID) ? 'pinned' : 'unpinned'}</p>
      <p>{isPinned(OTHER_SCOPE_ID) ? 'other pinned' : 'other unpinned'}</p>
      <button type="button" onClick={() => setPinned(SCOPE_ID, !isPinned(SCOPE_ID))}>toggle</button>
    </>
  );
};

/** A tenant-partitioned client, as the app has: the rollback must find the entry the optimistic write changed. */
const createTenantQueryClient = () => new TenantQueryClient(
  { defaultOptions: { queries: { retry: false } } },
  { getTenantId: () => TENANT_ID, runInTenant, tenantIndependentPaths: [] },
);

/** The scope memory is keyed by user and tenant, and the collection outlives a test: one user per test. */
const renderToggle = (userId: string, answers: Record<string, unknown>) => {
  const memoryKey = `${userId}:${TENANT_ID}`;
  updateScopeMemory(memoryKey, (memory) => ({ ...memory, lastScopeId: SCOPE_ID }));
  const rendered = renderWithTrpc(
    <LoggedUserProvider userId={userId}>
      <TenantProvider tenantId={TENANT_ID}>
        <PinToggle />
      </TenantProvider>
    </LoggedUserProvider>,
    { answers, queryClient: createTenantQueryClient() },
  );
  return { ...rendered, memoryKey };
};

/** The pins shown before the first answer are the default, so a click must wait for the answer to land. */
const unpinnedIdsLoaded = async (queryClient: QueryClient) => {
  await waitFor(() => expect(queryClient.getQueriesData({ queryKey: [['organizations', 'getUnpinnedOrganizationIds']] })[0]?.[1]).toBeDefined());
};

const deferred = () => {
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<null>((_resolve, fail) => {
    reject = fail;
  });
  return { promise, reject };
};

describe('useScopePins', () => {
  it('should put the pin back when the server refuses the change', async () => {
    const { calls, memoryKey, queryClient } = renderToggle('user-refused', {
      'organizations.getUnpinnedOrganizationIds': [],
      'organizations.setOrganizationPinned': FAILED,
    });
    await unpinnedIdsLoaded(queryClient);

    fireEvent.click(screen.getByText('toggle'));

    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({
      path: 'organizations.setOrganizationPinned',
      input: { id: SCOPE_ID, pinned: false },
    })));
    await waitFor(() => expect(scopeMemoryCollection.get(memoryKey)?.unpinnedScopeId ?? null).toBeNull());
    expect(screen.getByText('pinned')).toBeTruthy();
  });

  it('should show the change at once, then undo it, and the scope memory with it, when the server refuses', async () => {
    const refusal = deferred();
    const { memoryKey, queryClient } = renderToggle('user-pending', {
      'organizations.getUnpinnedOrganizationIds': [OTHER_SCOPE_ID],
      'organizations.setOrganizationPinned': refusal.promise,
    });
    await screen.findByText('other unpinned');
    expect(screen.getByText('pinned')).toBeTruthy();
    await unpinnedIdsLoaded(queryClient);

    fireEvent.click(screen.getByText('toggle'));

    await screen.findByText('unpinned');
    expect(scopeMemoryCollection.get(memoryKey)?.unpinnedScopeId).toBe(SCOPE_ID);

    refusal.reject(new Error('refused'));

    await screen.findByText('pinned');
    expect(screen.getByText('other unpinned')).toBeTruthy();
    expect(scopeMemoryCollection.get(memoryKey)?.unpinnedScopeId ?? null).toBeNull();
  });

  it('should keep the change when the server accepts it', async () => {
    const { calls, queryClient } = renderToggle('user-accepted', {
      'organizations.getUnpinnedOrganizationIds': [],
      'organizations.setOrganizationPinned': null,
    });
    await unpinnedIdsLoaded(queryClient);

    fireEvent.click(screen.getByText('toggle'));

    await screen.findByText('unpinned');
    await waitFor(() => expect(calls.some((call) => call.path === 'organizations.setOrganizationPinned')).toBe(true));
    expect(screen.getByText('unpinned')).toBeTruthy();
  });
});
