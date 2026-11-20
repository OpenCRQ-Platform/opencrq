/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type { QueryKey } from '@tanstack/react-query';
import { hashKey, QueryClient, QueryObserver, useQuery } from '@tanstack/react-query';
import { cleanup, waitFor } from '@testing-library/react';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getRequestTenantId, runInTenant } from '../lib/tenant-accessor';
import { useTRPC } from '../lib/trpc';
import { TenantQueryClient } from './tenant-query-client';
import { createTrpcTestClient, renderWithTrpc } from './trpc-test-harness';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const scenariosKey: QueryKey = [['controlCapabilities', 'getControlCapabilityRiskScenarios'], { input: { id: 'mfa' }, type: 'query' }];
const tenantsKey: QueryKey = [['tenants', 'getTenants'], { type: 'query' }];

const tenantScopedClient = () => {
  const tenant = { current: 'acme' as string | null };
  const queryClient = new TenantQueryClient({}, {
    getTenantId: () => tenant.current,
    runInTenant,
    tenantIndependentPaths: [['tenants', 'getTenants']],
  });
  return { tenant, queryClient };
};

const deferred = () => {
  let resolve: (value: string) => void = () => {};
  const promise = new Promise<string>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

describe('TenantQueryClient', () => {
  it('should hash the same key apart under two tenants and without one', () => {
    const { tenant, queryClient } = tenantScopedClient();

    const underAcme = queryClient.defaultQueryOptions({ queryKey: scenariosKey }).queryHash;
    tenant.current = 'tarnwick';
    const underTarnwick = queryClient.defaultQueryOptions({ queryKey: scenariosKey }).queryHash;
    tenant.current = null;
    const withoutTenant = queryClient.defaultQueryOptions({ queryKey: scenariosKey }).queryHash;

    expect(new Set([underAcme, underTarnwick, withoutTenant]).size).toBe(3);
  });

  it('should hash a tenant-independent procedure as the default hash does, whatever the tenant', () => {
    const { tenant, queryClient } = tenantScopedClient();

    const underAcme = queryClient.defaultQueryOptions({ queryKey: tenantsKey }).queryHash;
    tenant.current = 'tarnwick';

    expect(queryClient.defaultQueryOptions({ queryKey: tenantsKey }).queryHash).toBe(underAcme);
    expect(underAcme).toBe(hashKey(tenantsKey));
  });

  it('should never show the previous tenant\'s result for the same key', async () => {
    const { tenant, queryClient } = tenantScopedClient();
    await queryClient.query({ queryKey: scenariosKey, queryFn: () => 'acme scenarios' });

    tenant.current = 'tarnwick';
    const observer = new QueryObserver(queryClient, { queryKey: scenariosKey, queryFn: () => new Promise<string>(() => {}) });

    expect(observer.getCurrentResult()).toMatchObject({ data: undefined, status: 'pending' });
  });

  it('should not let a request made for the previous tenant answer the new tenant\'s query', async () => {
    const { tenant, queryClient } = tenantScopedClient();
    const acme = deferred();
    const tarnwick = deferred();
    const acmeFetch = queryClient.query({ queryKey: scenariosKey, queryFn: () => acme.promise });

    tenant.current = 'tarnwick';
    const tarnwickFetch = queryClient.query({ queryKey: scenariosKey, queryFn: () => tarnwick.promise });
    acme.resolve('acme scenarios');
    tarnwick.resolve('tarnwick scenarios');

    await expect(acmeFetch).resolves.toBe('acme scenarios');
    await expect(tarnwickFetch).resolves.toBe('tarnwick scenarios');
    expect(queryClient.getQueryData(scenariosKey)).toBe('tarnwick scenarios');
  });

  it('should request the tenant a query was hashed for when it refetches after the tenant moved on', async () => {
    const { tenant, queryClient } = tenantScopedClient();
    const queryFn = vi.fn(() => Promise.resolve(`${getRequestTenantId()} scenarios`));
    const observer = new QueryObserver(queryClient, { queryKey: scenariosKey, queryFn });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('acme scenarios'));

    tenant.current = 'tarnwick';
    await observer.refetch();

    expect(queryFn).toHaveBeenCalledTimes(2);
    tenant.current = 'acme';
    expect(queryClient.getQueryData(scenariosKey)).toBe('acme scenarios');
    unsubscribe();
  });

  it('should serve a tenant its own cached result when the user comes back to it', async () => {
    const { tenant, queryClient } = tenantScopedClient();
    await queryClient.query({ queryKey: scenariosKey, queryFn: () => 'acme scenarios' });
    tenant.current = 'tarnwick';
    await queryClient.query({ queryKey: scenariosKey, queryFn: () => 'tarnwick scenarios' });

    tenant.current = 'acme';

    expect(queryClient.getQueryData(scenariosKey)).toBe('acme scenarios');
  });

  it('should let a doorbell invalidate every tenant\'s entry by key prefix and refetch only the mounted one', async () => {
    const { tenant, queryClient } = tenantScopedClient();
    await queryClient.query({ queryKey: scenariosKey, queryFn: () => 'acme scenarios' });
    tenant.current = 'tarnwick';
    const queryFn = vi.fn().mockResolvedValue('tarnwick scenarios');
    const observer = new QueryObserver(queryClient, { queryKey: scenariosKey, queryFn });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('tarnwick scenarios'));

    // eslint-disable-next-line no-restricted-syntax -- this test exercises the SSE doorbell's own invalidation against a tenant-partitioned cache
    await queryClient.invalidateQueries({ queryKey: [['controlCapabilities', 'getControlCapabilityRiskScenarios']], refetchType: 'active' });

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryCache().findAll({ queryKey: [['controlCapabilities']] }).map((query) => query.state.isInvalidated))
      .toEqual([true, false]);
    unsubscribe();
  });
});

describe('TenantQueryClient under the tRPC options', () => {
  const ScopedQuery = ({ tenant }: { tenant: string }) => {
    const trpc = useTRPC();
    useQuery(trpc.organizations.getOrganizations.queryOptions());
    return createElement('span', null, tenant);
  };
  const IndependentQuery = ({ tenant }: { tenant: string }) => {
    const trpc = useTRPC();
    useQuery(trpc.tenants.getTenants.queryOptions());
    return createElement('span', null, tenant);
  };

  const setup = () => {
    const tenant = { current: 'acme' as string | null };
    const keys = createTRPCOptionsProxy<TRPCRouter>({ client: createTrpcTestClient().trpcClient, queryClient: new QueryClient() });
    const queryClient = new TenantQueryClient({ defaultOptions: { queries: { retry: false } } }, {
      getTenantId: () => tenant.current,
      runInTenant,
      tenantIndependentPaths: [keys.tenants.getTenants.pathKey()[0]],
    });
    return { tenant, keys, queryClient };
  };

  it('should keep one cache entry and one request per tenant for a tenant-scoped procedure', async () => {
    const { tenant, keys, queryClient } = setup();
    const answers = { 'organizations.getOrganizations': [] };
    const { calls, rerender } = renderWithTrpc(createElement(ScopedQuery, { key: 'acme', tenant: 'acme' }), { answers, queryClient });
    await waitFor(() => expect(calls).toHaveLength(1));

    tenant.current = 'tarnwick';
    rerender(createElement(ScopedQuery, { key: 'tarnwick', tenant: 'tarnwick' }));
    await waitFor(() => expect(calls).toHaveLength(2));

    expect(calls.map((call) => call.tenantId)).toEqual(['acme', 'tarnwick']);
    expect(queryClient.getQueryCache().findAll({ queryKey: keys.organizations.getOrganizations.pathKey() })).toHaveLength(2);
  });

  it('should keep one cache entry for a tenant-independent procedure across tenants', async () => {
    const { tenant, keys, queryClient } = setup();
    const answers = { 'tenants.getTenants': [] };
    const { calls, rerender } = renderWithTrpc(createElement(IndependentQuery, { key: 'acme', tenant: 'acme' }), { answers, queryClient });
    await waitFor(() => expect(calls).toHaveLength(1));

    tenant.current = 'tarnwick';
    rerender(createElement(IndependentQuery, { key: 'tarnwick', tenant: 'tarnwick' }));
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));

    expect(queryClient.getQueryCache().findAll({ queryKey: keys.tenants.getTenants.pathKey() })).toHaveLength(1);
  });
});
