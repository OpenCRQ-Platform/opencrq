import { useToast } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { MutationCache, QueryCache, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { FunctionComponent, ReactNode } from 'react';
import { useState } from 'react';
import { getCommittedTenantId, i18n, runInTenant, trpcClient, TRPCProvider } from '../lib';
import { clientReportQueue } from '../stores';
import '../lib/mutation-meta';
import { TenantQueryClient } from './tenant-query-client';

const keys = createTRPCOptionsProxy<TRPCRouter>({
  client: trpcClient,
  queryClient: () => {
    throw new Error('This proxy only builds query keys: it has no QueryClient.');
  },
});

export const TENANT_INDEPENDENT_PATHS = [
  keys.authStatus.pathKey()[0],
  keys.isLoggedIn.pathKey()[0],
  keys.users.getUserLocale.pathKey()[0],
  keys.users.getUserTheme.pathKey()[0],
  keys.tenants.getTenants.pathKey()[0],
  keys.tenants.getTenant.pathKey()[0],
  keys.xtmOne.getSettings.pathKey()[0],
];

interface TrpcProviderProps {
  children: ReactNode,
}

export const TrpcProvider: FunctionComponent<TrpcProviderProps> = ({ children }) => {
  const { toast } = useToast();
  const [queryClient] = useState(() => new TenantQueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        clientReportQueue.reportClientError(error, 'transport');
        if (!query.meta?.skipErrorToast) {
          toast({
            title: t`Error`,
            description: error.message,
            variant: 'destructive',
            duration: 2000,
          });
        }
      },
      onSuccess: () => {
        void clientReportQueue.flush();
      },
    }),
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _context, mutation) => {
        clientReportQueue.flush();
        if (!mutation.meta?.skipSuccessToast) {
          toast({
            title: t`Success`,
            description: mutation.meta?.successMessage
              ? i18n._(mutation.meta.successMessage)
              : t`Operation completed successfully.`,
            duration: 2000,
          });
        }
      },
      onError: (error, _variables, _context, mutation) => {
        clientReportQueue.reportClientError(error, 'transport');
        if (!mutation.meta?.skipErrorToast) {
          toast({
            title: t`Error`,
            description: error.message,
            variant: 'destructive',
            duration: 2000,
          });
        }
      },
    }),
  }, {
    getTenantId: getCommittedTenantId,
    runInTenant,
    tenantIndependentPaths: TENANT_INDEPENDENT_PATHS,
  }));
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
};
