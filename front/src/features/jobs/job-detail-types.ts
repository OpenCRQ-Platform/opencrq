import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;

/** Everything a job kind's page reads, from the one endpoint that assembles it. */
export type JobKindDetail = RouterOutputs['jobs']['getJobKind'];
