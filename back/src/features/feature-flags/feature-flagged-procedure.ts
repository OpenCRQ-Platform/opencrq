import type { GatedFeatureFlag } from '@app/utils';
import { TRPCError } from '@trpc/server';
import { trpcInstance } from '../../trpc';
import { isFeatureEnabled } from './feature-flags';

/**
 * Declarative gate for a tRPC endpoint, applied at the router boundary
 * (`protectedProcedure.use(featureFlagged('some-flag'))`) so the procedures built on it cannot
 * forget it.
 */
export const featureFlagged = (flag: GatedFeatureFlag) => trpcInstance.middleware(({ next }) => {
  if (!isFeatureEnabled(flag)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `Feature ${flag} is disabled` });
  }
  return next();
});
