import { Link } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import type { OnboardingWizard } from '../onboarding-utils';
import { WizardStepIndicator } from '../../../components/shared/wizard-step-indicator';
import { useStepProgress, useStepSyncReads } from '../hooks/use-source-reads';
import { getStepLink } from '../onboarding-links';
import { ONBOARDING_STEPS } from '../onboarding-steps';
import { getCompletedStepKeys, stepProgressFraction, stepSync } from '../onboarding-utils';
import { startedProgressLabel } from '../source-labels';

interface OnboardingStepperProps {
  /** The position of the step on screen, `ONBOARDING_STEPS.length` for the finish screen. */
  currentStep: number,
  wizard: OnboardingWizard | null | undefined,
}

/**
 * The steps as links: a check for a done step, a ring filled to its progress for a started one and a ring
 * around the circle while a source imports behind it (`stepSync`, the overview's own rule).
 */
export const OnboardingStepper: FunctionComponent<OnboardingStepperProps> = ({ currentStep, wizard }) => {
  const syncReads = useStepSyncReads();
  const counts = useStepProgress(wizard);
  const syncingStepKeys = ONBOARDING_STEPS.filter((step) => stepSync(step.key, syncReads) !== null).map((step) => step.key);
  const stepProgress = Object.fromEntries(
    ONBOARDING_STEPS.flatMap((step) => {
      const count = counts[step.key];
      return count === undefined ? [] : [[step.key, { fraction: stepProgressFraction(count), label: startedProgressLabel(count) }]];
    }),
  );

  return (
    <WizardStepIndicator
      steps={ONBOARDING_STEPS}
      currentStep={currentStep}
      completedStepKeys={wizard === null || wizard === undefined ? [] : getCompletedStepKeys(wizard)}
      syncingStepKeys={syncingStepKeys}
      stepProgress={stepProgress}
      renderStepLink={(step, props) => <Link {...getStepLink(step.key)} {...props} />}
    />
  );
};
