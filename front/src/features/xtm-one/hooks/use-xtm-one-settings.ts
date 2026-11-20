import { useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { useTRPC } from '../../../lib';

export type XtmOneRegistration = inferRouterOutputs<TRPCRouter>['xtmOne']['getSettings']['registration'];

export type XtmOneRegistrationFailure = Exclude<NonNullable<XtmOneRegistration>, 'pending' | 'ok'>;

/** Matches the XTM One registration heartbeat cadence (5 minutes). */
const XTM_ONE_SETTINGS_REFRESH_MS = 5 * 60_000;

/**
 * XTM One connection state shared by the "Ask Ariane" launcher, the CTEM
 * Command Center shortcut, the profile MCP card and the XTM One outage toast.
 * It must stay silent when it fails (backend without the `xtmOne` router,
 * transient outage, ...): no retry storm and no destructive error toast - the
 * gated components simply render nothing, exactly like a deployment without
 * XTM One configured, and the outage toast does not report an outage it cannot
 * itself confirm. Polling on `refetchInterval` is what lets that toast clear
 * on its own once XTM One answers again, without a page reload.
 */
export const useXtmOneSettings = () => {
  const trpc = useTRPC();
  return useQuery(trpc.xtmOne.getSettings.queryOptions(undefined, {
    staleTime: XTM_ONE_SETTINGS_REFRESH_MS,
    refetchInterval: XTM_ONE_SETTINGS_REFRESH_MS,
    retry: false,
    meta: { skipErrorToast: true },
  }));
};
