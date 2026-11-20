import { useQuery } from '@tanstack/react-query';
import { useUrlListFilters } from '../../hooks';
import { useTRPC } from '../../lib';
import { resolveOptionFilter } from '../../utils';
import { riskScopeListSearchSchema } from './risk-scope-list-search';

/** Disabled, it filters nothing and fetches nothing. */
export const useRiskScopeFilter = (enabled: boolean) => {
  const trpc = useTRPC();
  const { filters, setFilters } = useUrlListFilters(riskScopeListSearchSchema);
  const { data: scopes } = useQuery(trpc.organizations.getOrganizations.queryOptions(undefined, { enabled }));

  return {
    riskScope: enabled ? resolveOptionFilter(filters.riskScope, scopes?.map((scope) => scope.id), 'all') : 'all',
    scopes: scopes ?? [],
    pending: enabled && scopes === undefined && filters.riskScope !== 'all',
    setRiskScope: (riskScope: string) => setFilters({ riskScope: riskScopeListSearchSchema.shape.riskScope.parse(riskScope) }),
  };
};
