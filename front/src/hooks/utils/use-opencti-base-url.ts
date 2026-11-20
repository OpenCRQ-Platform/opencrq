import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../lib';

export const useOpenCtiBaseUrl = (): string | null => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.integrations.getConnectorsStatus.queryOptions());
  return data?.opencti?.url ?? null;
};
