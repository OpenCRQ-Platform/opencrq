import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../../lib';

/**
 * The tenant's Get started wizard, `null` once it has none. Silent on failure: the menu entry
 * reads it on every page and simply stays out when the answer is missing.
 */
export const useOnboardingWizard = (enabled = true) => {
  const trpc = useTRPC();
  return useQuery(trpc.onboardingWizard.getOnboardingWizard.queryOptions(undefined, {
    enabled,
    retry: false,
    meta: { skipErrorToast: true },
  }));
};
