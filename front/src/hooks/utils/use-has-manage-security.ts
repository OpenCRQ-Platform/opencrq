import { useMatches } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { isPlatformScope } from '../../lib/committed-tenant-utils';
import { useTRPC } from '../../lib';

export const useHasManageSecurity = () => {
  const trpc = useTRPC();
  const matches = useMatches();
  // A capability is granted inside a tenant: on the platform scope there is nothing to ask, and
  // asking anyway costs a rejected request — the transport carries no tenant there either way.
  const leafMatch = matches.at(-1);
  const onPlatformSurface = isPlatformScope(leafMatch?.routeId, leafMatch?.context);
  const { data: hasManageSecurity } = useQuery(trpc.capabilities.hasManageSecurity.queryOptions(
    undefined,
    { enabled: !onPlatformSurface },
  ));
  return hasManageSecurity ?? false;
};
