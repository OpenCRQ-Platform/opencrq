import { skipToken, useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import type { ResolvedPosture } from '../types/capability';
import { useTRPC } from '../../../../lib';

export interface ScopePosture {
  organizationId: string | undefined,
  postures: Array<ResolvedPosture> | undefined,
  /** Inside a scope whose posture has not arrived, loading or failed: the tenant's values must not stand in for it. */
  isAwaitingScope: boolean,
}

/** Outside any scope no query is issued, so every surface reading it stays on the tenant declaration. */
export const useScopePosture = (): ScopePosture => {
  const trpc = useTRPC();
  const { organizationId } = useParams({ strict: false });
  const { data } = useQuery(trpc.controlCapabilities.getResolvedControlPosture.queryOptions(
    organizationId === undefined ? skipToken : { organizationId },
  ));
  const postures = organizationId === undefined ? undefined : data;
  return {
    organizationId,
    postures,
    isAwaitingScope: organizationId !== undefined && postures === undefined,
  };
};

interface CapabilityScopePosture {
  organizationId: string | undefined,
  posture: ResolvedPosture | undefined,
  isAwaitingScope: boolean,
}

export const useCapabilityScopePosture = (capabilityId: string): CapabilityScopePosture => {
  const { organizationId, postures, isAwaitingScope } = useScopePosture();
  return {
    organizationId,
    posture: postures?.find((entry) => entry.capabilityId === capabilityId),
    isAwaitingScope,
  };
};
