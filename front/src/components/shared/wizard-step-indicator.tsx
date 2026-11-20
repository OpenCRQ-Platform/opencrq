import { t } from '@lingui/core/macro';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { StepProgressRing } from './step-progress-ring';

interface WizardStepIndicatorStep {
  key: string,
  /** A thunk so the Lingui macro resolves at render time rather than at module load. */
  label: () => string,
}

/** What the indicator hands a step link to spread on its anchor: the circle and the label are its children. */
interface WizardStepLinkProps {
  className: string,
  'aria-current'?: 'step',
  children: ReactNode,
}

/** A step under way: its number stays, inside a ring filled to `fraction` (0 to 1). */
interface WizardStepProgress {
  fraction: number,
  /** For a reader who cannot see the ring, already translated: "Started, 20 of 21". */
  label: string,
}

interface WizardStepIndicatorProps<TStep extends WizardStepIndicatorStep> {
  steps: ReadonlyArray<TStep>,
  currentStep: number,
  /** For a wizard whose steps are not taken in order: a step is checked because it is listed, not because it precedes the current one. */
  completedStepKeys?: ReadonlyArray<string>,
  /** Makes every step a link, for a wizard whose steps open in any order; the caller renders the router link. */
  renderStepLink?: (step: TStep, props: WizardStepLinkProps) => ReactNode,
  /** Steps with a source importing behind them: a ring turns around their circle. */
  syncingStepKeys?: ReadonlyArray<string>,
  /** Steps under way, by key: not checked, they keep their number inside a static ring. A syncing step shows its sync ring instead. */
  stepProgress?: Readonly<Record<string, WizardStepProgress>>,
}

export const WizardStepIndicator = <TStep extends WizardStepIndicatorStep>({
  steps,
  currentStep,
  completedStepKeys,
  renderStepLink,
  syncingStepKeys,
  stepProgress,
}: WizardStepIndicatorProps<TStep>) => {
  const isDone = (step: TStep, index: number): boolean => (
    completedStepKeys === undefined ? index < currentStep : completedStepKeys.includes(step.key)
  );

  return (
    // gap-y is a longhand the design system's own unlayered `.gap-2` would override, so the row gap comes through the arbitrary shorthand.
    <div className="flex flex-wrap items-center gap-[12px_8px]">
      {steps.map((step, index) => {
        const syncing = syncingStepKeys?.includes(step.key) === true;
        const progress = isDone(step, index) || syncing ? undefined : stepProgress?.[step.key];
        const content = (
          <>
            <div
              className={`relative flex h-8 w-8 items-center justify-center rounded-full txt-body2 font-medium ${index === currentStep
                ? 'bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-2 ring-offset-background'
                : isDone(step, index)
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {isDone(step, index) ? <Check className="h-4 w-4" /> : index + 1}
              {progress !== undefined && <StepProgressRing fraction={progress.fraction} />}
              {syncing && (
                // The static ring still tells a reader who asked for no motion that a source imports.
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -inset-[6px] rounded-full border-2 border-[color:var(--fds-color-feedback-info-secondary)] border-t-[color:var(--fds-color-feedback-info-primary)] motion-safe:animate-spin"
                />
              )}
            </div>
            <span
              className={`txt-body2 ${isDone(step, index) || index === currentStep ? 'font-medium text-foreground' : 'text-muted-foreground'
              }`}
            >
              {step.label()}
            </span>
            {syncing && <>{' '}<span className="sr-only">{t`Syncing`}</span></>}
            {progress !== undefined && <>{' '}<span className="sr-only">{progress.label}</span></>}
          </>
        );

        return (
          <div key={step.key} className="flex items-center gap-2">
            {renderStepLink === undefined
              ? <div className="flex items-center gap-2">{content}</div>
              : renderStepLink(step, {
                className: 'flex items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                'aria-current': index === currentStep ? 'step' : undefined,
                children: content,
              })}
            {index < steps.length - 1 && (
              <div
                className={`mx-2 h-px w-8 ${isDone(step, index) ? 'bg-primary' : 'bg-muted'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
