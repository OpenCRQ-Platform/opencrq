import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;

export type ThreatSourceKind = NonNullable<RouterOutputs['threats']['getDetail']>['origin']['kind'];

/** Dates arrive as strings: the route loader serialises what `getDetail` returns. */
export interface ThreatOrigin {
  kind: ThreatSourceKind,
  stixId: string,
  lastIngestedAt: string,
}
