import type { OperationLink, TRPCLink } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';

/**
 * Stamps each operation with the tenant it is made for. It must be the first link: the tenant a
 * `runInTenant` binding carries is only readable while the call that started the operation runs.
 */
export const tenantStampLink = <TRouter extends AnyRouter>(getTenantId: () => string | null): TRPCLink<TRouter> =>
  () => ({ op, next }) => next({ ...op, context: { ...op.context, tenantId: getTenantId() } });

/**
 * One batch link per tenant, so the tenant header is fixed per request instead of being read once
 * for a whole batch that may hold operations made for two tenants.
 */
export const tenantBatchLink = <TRouter extends AnyRouter>(createBatchLink: (tenantId: string | null) => TRPCLink<TRouter>): TRPCLink<TRouter> =>
  (runtime) => {
    const byTenant = new Map<string | null, OperationLink<TRouter>>();
    return (opts) => {
      const { tenantId } = opts.op.context;
      const tenant = typeof tenantId === 'string' ? tenantId : null;
      let link = byTenant.get(tenant);
      if (!link) {
        link = createBatchLink(tenant)(runtime);
        byTenant.set(tenant, link);
      }
      return link(opts);
    };
  };
