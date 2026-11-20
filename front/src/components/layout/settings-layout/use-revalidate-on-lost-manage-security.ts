import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SecurityScope } from './security-scope-utils';
import { useTRPC } from '../../../lib';

/**
 * Replays the security route's `beforeLoad` when the reader loses MANAGE_SECURITY under an open
 * Security page, so the route sends them away instead of leaving a page whose every query is now
 * refused. Reads the raw query: `useHasManageSecurity` answers `false` while loading, which would
 * look like a loss on every mount. Watches the tenant scope only: the platform scope sends no
 * tenant, so the capability request would be refused there.
 */
export const useRevalidateOnLostManageSecurity = (canAccessTenant: boolean, securityScope: SecurityScope): void => {
  const trpc = useTRPC();
  const router = useRouter();
  const watching = canAccessTenant && securityScope === 'tenant';
  const { data: hasManageSecurity } = useQuery(trpc.capabilities.hasManageSecurity.queryOptions(
    undefined,
    { enabled: watching },
  ));

  useEffect(() => {
    if (watching && hasManageSecurity === false) {
      void router.invalidate();
    }
  }, [watching, hasManageSecurity, router]);
};
