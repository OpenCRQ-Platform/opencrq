import type { QueryClient } from '@tanstack/react-query';
import type { TRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';

/**
 * Fills the cache with what the header renders, so that it appears complete with the page instead of
 * filling in after it. Never rejects: a failed read is left to the component that renders it, which
 * asks again under its own options. The edition is not read here: `AuthProvider` mounts the router
 * only once `authStatus` has answered.
 */
export const prefetchHeaderData = async (queryClient: QueryClient, trpc: TRPCOptionsProxy<TRPCRouter>): Promise<void> => {
  // `static` answers from the cache whenever it holds data; the header's own queries keep their refresh cadence.
  const options = { staleTime: 'static', meta: { skipErrorToast: true } } as const;
  await Promise.allSettled([
    queryClient.query(trpc.tenants.getTenants.queryOptions(undefined, options)),
    queryClient.query(trpc.xtmOne.getSettings.queryOptions(undefined, options)),
  ]);
};
