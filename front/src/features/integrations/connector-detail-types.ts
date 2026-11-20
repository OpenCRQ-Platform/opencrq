import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;

/** Everything a connector's page reads, from the one endpoint that assembles it. */
export type ConnectorDetail = RouterOutputs['connectors']['getConnector'];

/** A job-backed connector's cadence, its default when none is saved. */
export type ConnectorSchedule = NonNullable<RouterOutputs['connectors']['getSchedule']>;
