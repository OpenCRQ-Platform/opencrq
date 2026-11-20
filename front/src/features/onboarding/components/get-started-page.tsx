import { Button, Chip, Paper, Spinner, Text } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Link } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import type { FunctionComponent } from 'react';
import type { OnboardingStep } from '../onboarding-steps';
import type { GetStartedProgress, OnboardingStepStatus, OnboardingWizard, StepProgressCount, StepSync } from '../onboarding-utils';
import { StepProgressRing } from '../../../components/shared/step-progress-ring';
import { cn } from '../../../utils';
import { getConnectors } from '../../integrations';
import { useOnboardingWizard } from '../hooks/use-onboarding-wizard';
import { useImportedCount, useStepProgress, useStepSyncReads } from '../hooks/use-source-reads';
import { GET_STARTED_DONE_LINK, getStepLink } from '../onboarding-links';
import { ONBOARDING_STEPS } from '../onboarding-steps';
import { firstStepKey, getStartedProgress, getStepStatus, isStepDone, stepProgressFraction, stepSync } from '../onboarding-utils';
import { sourceCountLabel, stepProgressCaption } from '../source-labels';
import { SourceProgressLine } from './source-tile';

const STATUS_CHIP: Record<OnboardingStepStatus, { severity: 'low' | 'medium' | 'info' | 'neutral', label: () => string }> = {
  done: { severity: 'low', label: () => t`Already configured` },
  started: { severity: 'medium', label: () => t`Started` },
  todo: { severity: 'info', label: () => t`To do` },
  comingSoon: { severity: 'neutral', label: () => t`Coming soon` },
};

const stepsDoneLabel = ({ completed, started, total }: GetStartedProgress): string => (
  started === 0
    ? t`${completed} of ${total} steps done`
    : plural(started, { one: `${completed} of ${total} steps done · # started`, other: `${completed} of ${total} steps done · # started` })
);

const importedLabel = (name: string, count: string): string => t`${name} · ${count} imported`;

const SyncDetails: FunctionComponent<{ sync: StepSync }> = ({ sync }) => {
  const count = useImportedCount(sync.source);
  const name = getConnectors()[sync.source].name;

  return (
    <>
      <Text as="span" variant="content-caption" className="text-default-secondary">
        {count === undefined ? name : importedLabel(name, sourceCountLabel(sync.source, count))}
      </Text>
      {sync.percent !== null && (
        <span className="min-w-64">
          <SourceProgressLine percent={sync.percent} name={name} />
        </span>
      )}
    </>
  );
};

interface StepRowProps {
  step: OnboardingStep,
  index: number,
  status: OnboardingStepStatus,
  sync: StepSync | null,
  /** How far the step is, known once its read has landed. */
  progress: StepProgressCount | undefined,
}

const StepRow: FunctionComponent<StepRowProps> = ({ step, index, status, sync, progress }) => {
  const chip = STATUS_CHIP[status];
  const caption = status === 'started' && progress !== undefined ? stepProgressCaption(step.key, progress) : null;
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'relative flex size-8 shrink-0 items-center justify-center rounded-full',
          isStepDone(status)
            ? 'bg-feedback-success-secondary-transparency-30 text-feedback-success-primary'
            : 'bg-feedback-neutral-secondary-transparency-30 text-default-secondary',
        )}
      >
        {isStepDone(status) ? <Check className="size-4" /> : <Text as="span" variant="content-compact-bold">{index + 1}</Text>}
        {status === 'started' && sync === null && progress !== undefined && <StepProgressRing fraction={stepProgressFraction(progress)} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <Text as="span" variant="content-base-medium" className={cn('max-w-full truncate', status === 'comingSoon' && 'text-default-secondary')}>
          {step.label()}
        </Text>
        {sync !== null && <SyncDetails sync={sync} />}
        {caption !== null && <Text as="span" variant="content-caption" className="text-default-secondary">{caption}</Text>}
      </span>
      {sync === null
        ? <Chip label={chip.label()} severity={chip.severity} />
        : <Chip label={t`Syncing`} severity="info" startIcon={<Spinner size="sm" tone="inherit" />} />}
    </>
  );
  const rowClassName = 'flex items-center gap-4 px-2 py-3';

  return (
    <li>
      {step.available
        ? (
          <Link {...getStepLink(step.key)} className={cn(rowClassName, 'rounded-sm hover:bg-elevation-highlight')}>
            {content}
          </Link>
        )
        : <div className={rowClassName}>{content}</div>}
    </li>
  );
};

const GetStartedSteps: FunctionComponent<{ wizard: OnboardingWizard }> = ({ wizard }) => {
  const progress = getStartedProgress(wizard);
  const syncReads = useStepSyncReads();
  const counts = useStepProgress(wizard);

  return (
    <div className="flex flex-col gap-6">
      <Paper padding={24} className="flex flex-col gap-2">
        {progress !== undefined && (
          <Text as="p" variant="content-caption" className="text-default-secondary">
            {stepsDoneLabel(progress)}
          </Text>
        )}
        <ol className="flex flex-col divide-y divide-[var(--fds-border-elevation-subtle)]">
          {ONBOARDING_STEPS.map((step, index) => (
            <StepRow key={step.key} step={step} index={index} status={getStepStatus(step, wizard)} sync={stepSync(step.key, syncReads)} progress={counts[step.key]} />
          ))}
        </ol>
      </Paper>
      <div className="flex justify-end">
        <Button asChild>
          {wizard.finished
            ? <Link {...GET_STARTED_DONE_LINK}>{t`What you can do now`}</Link>
            : <Link {...getStepLink(firstStepKey())}>{t`Start`}</Link>}
        </Button>
      </div>
    </div>
  );
};

export const GetStartedPage: FunctionComponent = () => {
  const { data: wizard } = useOnboardingWizard();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Text as="h1" variant="title-xl">{t`Get started`}</Text>
        <Text as="p" variant="content-base" className="text-default-secondary">
          {t`Get a first quantified risk scenario in a few minutes.`}
        </Text>
      </div>
      {wizard !== null && wizard !== undefined && <GetStartedSteps wizard={wizard} />}
    </div>
  );
};
