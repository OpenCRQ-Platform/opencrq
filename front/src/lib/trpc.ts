import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { createTRPCClient, httpBatchLink, httpBatchStreamLink, httpLink, httpSubscriptionLink, splitLink } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import { observable } from '@trpc/server/observable';
import { getRequestTenantId } from './tenant-accessor';
import { tenantBatchLink, tenantStampLink } from './tenant-batch-link';

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<TRPCRouter>();

const credentialedFetch: typeof fetch = (url, options) => fetch(url, { ...options, credentials: 'include' });

const httpOptions = (tenantId: string | null) => ({
  url: '/trpc',
  headers: tenantId ? { 'x-tenant-id': tenantId } : {},
  fetch: credentialedFetch,
});

export const trpcClient = createTRPCClient<TRPCRouter>({
  links: [
    tenantStampLink(getRequestTenantId),
    () =>
      ({ next, op }) =>
        observable((observer) =>
          next(op).subscribe({
            next(value) {
              observer.next(value);
            },
            error(err) {
              // Back to the page once signed in again, which XTM One does with no click while its own session is open.
              if (err.data?.code === 'UNAUTHORIZED' && window.location.pathname !== '/login') {
                const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
                window.location.href = `/login?${new URLSearchParams({ redirect: here }).toString()}`;
              }
              observer.error(err);
            },
            complete() {
              observer.complete();
            },
          }),
        ),
    splitLink({
      condition: (op) => op.type === 'subscription',
      true: httpSubscriptionLink({
        url: '/trpc',
        eventSourceOptions: () => ({ withCredentials: true }),
      }),
      false: splitLink({
        // A batch sends its calls in one body, which calls carrying hundreds of rows each would push
        // past the server's body limit: such a call asks for a request of its own.
        condition: (op) => op.context.skipBatch === true,
        true: tenantBatchLink((tenantId) => httpLink(httpOptions(tenantId))),
        false: splitLink({
          condition: (op) => op.type === 'query',
          // Mutations stay unstreamed: a streamed response sends its headers before the procedure
          // runs, and the auth mutations set or clear the session cookie from inside theirs.
          true: tenantBatchLink((tenantId) => httpBatchStreamLink(httpOptions(tenantId))),
          false: tenantBatchLink((tenantId) => httpBatchLink(httpOptions(tenantId))),
        }),
      }),
    }),
  ],
});
