import { QueryClient } from '@tanstack/react-query';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { describe, expect, it } from 'vitest';
import type { TrpcAnswers } from '../../providers/trpc-test-harness';
import { runInTenant } from '../../lib/tenant-accessor';
import { Route as AuthRoute } from '../../routes/_auth/route';
import { TenantQueryClient } from '../../providers/tenant-query-client';
import { createTrpcTestClient, FAILED } from '../../providers/trpc-test-harness';
import { TENANT_INDEPENDENT_PATHS } from '../../providers/trpc-provider';
import { prefetchHeaderData } from './header-prefetch';

const TENANTS = [{ id: '019e0000-0000-7000-8000-0000000000a1', name: 'Default' }];
const SETTINGS = { configured: true, url: 'https://xtm-one.example.com', entitlementRefusal: null, registration: null };

const ANSWERS: TrpcAnswers = {
  'tenants.getTenants': TENANTS,
  'xtmOne.getSettings': SETTINGS,
};

// Like the app's client, this one sets no default `retry`, so a retry the prefetch asked for would show in `calls`.
const setup = (answers: TrpcAnswers = ANSWERS) => {
  const queryClient = new QueryClient();
  const { trpcClient, calls } = createTrpcTestClient(answers);
  const trpc = createTRPCOptionsProxy<TRPCRouter>({ client: trpcClient, queryClient });
  return { queryClient, trpc, calls };
};

describe('prefetchHeaderData', () => {
  it('should leave the tenants and the XTM One settings in the cache', async () => {
    const { queryClient, trpc } = setup();

    await prefetchHeaderData(queryClient, trpc);

    expect(queryClient.getQueryData(trpc.tenants.getTenants.queryKey())).toEqual(TENANTS);
    expect(queryClient.getQueryData(trpc.xtmOne.getSettings.queryKey())).toEqual(SETTINGS);
  });

  it('should resolve when a read fails, asking for it once and keeping the other', async () => {
    const { queryClient, trpc, calls } = setup({ ...ANSWERS, 'xtmOne.getSettings': FAILED });

    await expect(prefetchHeaderData(queryClient, trpc)).resolves.toBeUndefined();

    expect(calls.filter(({ path }) => path === 'xtmOne.getSettings')).toHaveLength(1);
    expect(queryClient.getQueryData(trpc.tenants.getTenants.queryKey())).toEqual(TENANTS);
  });

  it('should leave a failed read to the component that renders it, with no error toast of its own', async () => {
    const { queryClient, trpc } = setup({ ...ANSWERS, 'xtmOne.getSettings': FAILED });

    await prefetchHeaderData(queryClient, trpc);

    const failed = queryClient.getQueryCache().find({ queryKey: trpc.xtmOne.getSettings.queryKey() });
    expect(failed?.state.status).toBe('error');
    expect(failed?.meta?.skipErrorToast).toBe(true);
  });

  it('should ask for nothing again once the cache holds both reads', async () => {
    const { queryClient, trpc, calls } = setup();
    await prefetchHeaderData(queryClient, trpc);
    const asked = calls.length;

    await prefetchHeaderData(queryClient, trpc);

    expect(calls).toHaveLength(asked);
  });
});

describe('the _auth route loader', () => {
  it('should leave the header\'s reads where a tenant page looks for them, though it runs before the tenant is committed', async () => {
    const tenant = { current: null as string | null };
    const queryClient = new TenantQueryClient({}, {
      getTenantId: () => tenant.current,
      runInTenant,
      tenantIndependentPaths: TENANT_INDEPENDENT_PATHS,
    });
    const { trpcClient } = createTrpcTestClient(ANSWERS);
    const trpc = createTRPCOptionsProxy<TRPCRouter>({ client: trpcClient, queryClient });

    const { loader } = AuthRoute.options;
    if (typeof loader !== 'function') {
      throw new Error('The _auth route has no loader function.');
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the loader reads only these two entries of its context
    await loader({ context: { queryClient, trpc } } as unknown as Parameters<typeof loader>[0]);
    tenant.current = TENANTS[0].id;

    expect(queryClient.getQueryData(trpc.tenants.getTenants.queryKey())).toEqual(TENANTS);
    expect(queryClient.getQueryData(trpc.xtmOne.getSettings.queryKey())).toEqual(SETTINGS);
  });
});
