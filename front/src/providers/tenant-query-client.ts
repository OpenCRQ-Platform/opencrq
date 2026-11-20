import type {
  DefaultedQueryObserverOptions,
  DefaultError,
  QueryClientConfig,
  QueryKey,
  QueryObserverOptions,
} from '@tanstack/react-query';
import { hashKey, QueryClient } from '@tanstack/react-query';

export interface TenantScope {
  /** Must be the source the request tenant falls back to, so an entry's hash names the tenant it was fetched for. */
  getTenantId: () => string | null,
  runInTenant: <T>(tenantId: string | null, fn: () => T) => T,
  /**
   * Procedures whose answer never depends on the tenant header. They keep one entry across tenants,
   * since a provider mounted above the router would otherwise meet an empty entry, and render its
   * loading state, the next time it renders after a switch.
   */
  tenantIndependentPaths: ReadonlyArray<ReadonlyArray<string>>,
}

const isIndependent = (independent: ReadonlySet<string>, queryKey: QueryKey): boolean => {
  const [path] = queryKey;
  return Array.isArray(path) && independent.has(path.join('.'));
};

/**
 * A query client whose cache is partitioned by tenant: the tenant travels in a request header rather
 * than in the tRPC key, so it is hashed with the key. Each query's function is bound to the tenant its
 * hash names, so a query left mounted by the previous tenant's page, refetched after the committed
 * tenant moved on, still requests its own tenant and never stores another tenant's answer.
 */
export class TenantQueryClient extends QueryClient {
  readonly #scope: TenantScope;
  readonly #independent: ReadonlySet<string>;

  constructor(config: QueryClientConfig, scope: TenantScope) {
    const independent = new Set(scope.tenantIndependentPaths.map((path) => path.join('.')));
    super({
      ...config,
      defaultOptions: {
        ...config.defaultOptions,
        queries: {
          ...config.defaultOptions?.queries,
          // Exact filters rehash a key with the query's own options, so they need the same partition.
          queryKeyHashFn: (queryKey) => (isIndependent(independent, queryKey) ? hashKey(queryKey) : hashKey([scope.getTenantId(), queryKey])),
        },
      },
    });
    this.#scope = scope;
    this.#independent = independent;
  }

  override defaultQueryOptions<
    TQueryFnData = unknown,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
    TPageParam = never,
  >(
    options: QueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey, TPageParam>
      | DefaultedQueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey>,
  ): DefaultedQueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey> {
    if (options._defaulted || isIndependent(this.#independent, options.queryKey)) {
      return super.defaultQueryOptions(options);
    }
    const tenantId = this.#scope.getTenantId();
    const defaulted = super.defaultQueryOptions({ ...options, queryHash: options.queryHash ?? hashKey([tenantId, options.queryKey]) });
    const { queryFn } = defaulted;
    if (typeof queryFn !== 'function') {
      return defaulted;
    }
    const { runInTenant } = this.#scope;
    return { ...defaulted, queryFn: (context) => runInTenant(tenantId, () => queryFn(context)) };
  }
}
