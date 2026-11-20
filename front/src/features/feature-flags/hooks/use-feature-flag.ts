// The package's `./feature-flags` entry point, not its barrel: the barrel also re-exports the
// advisory-lock helpers, which pull `drizzle-orm` into the browser bundle.
import type { GatedFeatureFlag } from '@app/utils/feature-flags';
import { isFeatureFlagEnabled } from '@app/utils/feature-flags';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../../lib';

/**
 * Reads the enabled flags off the public bootstrap payload, which `AuthProvider` awaits before
 * anything renders, so this only ever hits the warm query cache. A flag reads as off while that
 * payload is unavailable: an unreleased feature must never flash on before the answer arrives.
 */
export const useFeatureFlag = (flag: GatedFeatureFlag): boolean => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.authStatus.queryOptions());
  return isFeatureFlagEnabled(data?.featureFlags ?? [], flag);
};
