import { useQuery } from '@tanstack/react-query';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import { useTRPC } from '../../lib';

type ThreatDetail = NonNullable<inferRouterOutputs<TRPCRouter>['threats']['getDetail']>;

/**
 * The loader's snapshot only seeds the query: the doorbell invalidates `threats.getDetail`, which
 * no loader replays, so a page reading the snapshot alone would never show a re-ingestion or an
 * attribution target arriving later.
 */
export const useLiveThreatDetail = (initialData: ThreatDetail): ThreatDetail | null => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.threats.getDetail.queryOptions({ id: initialData.analysis.id }, { initialData }));
  return data ?? null;
};
