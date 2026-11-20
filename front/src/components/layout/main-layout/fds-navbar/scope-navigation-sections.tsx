import { useQuery } from '@tanstack/react-query';
import { useMatches, useParams } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { useEffect } from 'react';
// Deep imports: the feature barrel pulls the pages, which pull this layout back in.
import { useOnboardingWizard } from '../../../../features/onboarding/hooks/use-onboarding-wizard';
import { getStartedProgress } from '../../../../features/onboarding/onboarding-utils';
import { afterScopeOpened } from '../../../../features/organizations/scope-memory-utils';
import { updateScopeMemory, useScopeMemory } from '../../../../features/organizations/use-scope-pins';
import { useHasManageSecurity, useHasPlatformAccess } from '../../../../hooks';
import { useTRPC } from '../../../../lib';
import { isPlatformScope } from '../../../../lib/committed-tenant-utils';
import { NavRows } from './nav-items';
import { filterVisibleEntries, getScopeNavigationNodes } from './nav-model';
import { barScopes } from './scope-nav-utils';

export const ScopeNavigationSections: FunctionComponent<{ tenantId: string }> = ({ tenantId }) => {
  const trpc = useTRPC();
  const hasManageSecurity = useHasManageSecurity();
  const hasPlatformAccess = useHasPlatformAccess();
  const { organizationId } = useParams({ strict: false });
  const leafMatch = useMatches().at(-1);
  // The platform scope clears the tenant header, which a tenant-scoped query cannot go without.
  const platform = isPlatformScope(leafMatch?.routeId, leafMatch?.context);
  const { data: scopes } = useQuery(trpc.organizations.getOrganizations.queryOptions(undefined, { enabled: !platform }));
  const { data: unpinnedIds } = useQuery(trpc.organizations.getUnpinnedOrganizationIds.queryOptions(undefined, { enabled: !platform }));
  const { data: onboardingWizard } = useOnboardingWizard(!platform);
  const { key: memoryKey, memory: storedMemory } = useScopeMemory(tenantId);

  const unpinned = new Set(unpinnedIds ?? []);
  const openedScopeId = scopes !== undefined && unpinnedIds !== undefined && scopes.some((scope) => scope.id === organizationId)
    ? organizationId
    : undefined;
  // The address is ahead of the browser storage for one render, and the bar must not wait for it.
  const memory = openedScopeId === undefined ? storedMemory : afterScopeOpened(storedMemory, openedScopeId, unpinned);

  const { lastScopeId, unpinnedScopeId } = memory;

  useEffect(() => {
    if (openedScopeId !== undefined) {
      updateScopeMemory(memoryKey, () => ({ lastScopeId, unpinnedScopeId }));
    }
  }, [memoryKey, openedScopeId, lastScopeId, unpinnedScopeId]);

  const nodes = filterVisibleEntries(getScopeNavigationNodes({
    tenantId,
    hasManageSecurity,
    hasPlatformAccess,
    organizationId,
    scopes: scopes !== undefined && unpinnedIds !== undefined ? barScopes(scopes, unpinned, unpinnedScopeId) : [],
    getStarted: getStartedProgress(onboardingWizard),
  }));

  return <NavRows nodes={nodes} organizationId={organizationId} />;
};
