import { Button, Paper, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Link } from '@tanstack/react-router';
import { Lightbulb } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import type { OnboardingStepKey } from '../onboarding-steps';
import { useOnboardingWizard } from '../hooks/use-onboarding-wizard';
import { getNextLink, getStepLink } from '../onboarding-links';
import { ONBOARDING_STEPS } from '../onboarding-steps';
import { previousStepKey } from '../onboarding-utils';
import { OnboardingStepper } from './onboarding-stepper';

interface OnboardingStepLayoutProps {
  stepKey: OnboardingStepKey,
  /** Replaces the step's label as the title of its card, already translated. */
  title?: string,
  /** Sits right of the title, such as an info tooltip. */
  titleAdornment?: ReactNode,
  /** The answer to "Why this step?", already translated. */
  why: string,
  children: ReactNode,
}

export const OnboardingStepLayout: FunctionComponent<OnboardingStepLayoutProps> = ({ stepKey, title, titleAdornment, why, children }) => {
  const { data: wizard } = useOnboardingWizard();
  const currentStep = ONBOARDING_STEPS.findIndex((step) => step.key === stepKey);
  const stepLabel = ONBOARDING_STEPS[currentStep]?.label() ?? '';

  return (
    <div className="flex flex-col gap-8">
      <Text as="h1" variant="title-xl">{t`Get started`}</Text>

      <OnboardingStepper currentStep={currentStep} wizard={wizard} />

      <div className="flex flex-col gap-6">
        <Paper padding={24} className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Text as="h2" variant="title-md">{title ?? stepLabel}</Text>
              {titleAdornment}
            </div>
            <Paper elevation={2} padding={16} className="flex items-start gap-3">
              <Lightbulb className="mt-0.5 size-5 shrink-0 text-[var(--fds-icon-info)]" aria-hidden />
              <div className="flex flex-col gap-1">
                <Text as="h3" variant="content-compact-bold">{t`Why this step?`}</Text>
                <Text as="p" variant="content-compact">{why}</Text>
              </div>
            </Paper>
          </div>
          {children}
        </Paper>

        <div className="flex items-center justify-between border-t pt-4">
          <Button asChild priority="secondary">
            <Link {...getStepLink(previousStepKey(stepKey))}>{t`Back`}</Link>
          </Button>
          <Button asChild>
            <Link {...getNextLink(stepKey, wizard?.finished === true)}>{t`Next`}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
};
