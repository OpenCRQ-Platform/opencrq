import type { QueryClient } from '@tanstack/react-query';
import type { TRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { useAuth } from '../features';

export interface RouterContext {
  auth: ReturnType<typeof useAuth>,
  queryClient: QueryClient,
  trpc: TRPCOptionsProxy<TRPCRouter>,
}
