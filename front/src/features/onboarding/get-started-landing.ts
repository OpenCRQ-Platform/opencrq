import type { OnboardingWizard } from './onboarding-utils';
import { hasSeenGetStarted } from '../../stores/onboarding-seen-collection';
import { shouldOpenGetStarted } from './onboarding-utils';

interface GetStartedLandingInput {
  userId: string,
  tenantId: string,
  readWizard: () => Promise<OnboardingWizard | null>,
}

/**
 * Whether the tenant home sends the reader to Get started. The marker is read first and synchronously, so once it is
 * set the home costs no request; a failing read lets the home render.
 */
export const opensGetStarted = async ({ userId, tenantId, readWizard }: GetStartedLandingInput): Promise<boolean> => {
  const seen = hasSeenGetStarted(userId, tenantId);
  if (seen) {
    return false;
  }
  const wizard = await readWizard().catch(() => null);
  return shouldOpenGetStarted({ seen, wizard });
};
