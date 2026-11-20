import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../lib';

export const useHasPlatformAccess = () => {
  const trpc = useTRPC();
  const { data: hasPlatformAccess } = useQuery(trpc.platformCapabilities.hasPlatformAccess.queryOptions());
  return hasPlatformAccess ?? false;
};
