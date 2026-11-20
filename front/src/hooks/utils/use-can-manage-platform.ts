import { PlatformCapability_ManageUsers } from '@app/module/client';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../lib';

/**
 * Whether the user administers the platform (MANAGE_USERS), the capability the backend asks for to
 * read the instance id and to install or remove a Filigran license. `false` until it is known.
 */
export const useCanManagePlatform = (): boolean => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.platformCapabilities.hasPlatformCapability.queryOptions(
    { capabilityId: PlatformCapability_ManageUsers },
    { retry: false, meta: { skipErrorToast: true } },
  ));
  return data === true;
};
