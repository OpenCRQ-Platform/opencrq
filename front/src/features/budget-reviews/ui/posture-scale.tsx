import { Trans } from '@lingui/react/macro';
import type { ScaleStep } from '../budget-review-utils';
import { cn } from '../../../utils';
import { scaleSteps } from '../budget-review-utils';

const STEP_CLASS: Record<ScaleStep, string> = {
  kept: 'bg-[var(--fds-text-default-secondary)]',
  gained: 'bg-[var(--fds-color-filigran-brand-primary)]',
  lost: 'bg-[var(--fds-color-feedback-error-primary)]',
  empty: cn('bg-[var(--fds-text-default-secondary)]', 'opacity-25'),
};

interface PostureScaleProps<T extends string> {
  /** Lowest first. */
  levels: ReadonlyArray<T>,
  start: T,
  /** Absent for a level read at one date: it shows as held, with no move to state. */
  end?: T,
  label: (level: T) => string,
}

/** A posture dimension as steps, the period's gain in the accent colour and a loss in the error one. */
export const PostureScale = <T extends string>({ levels, start, end, label }: PostureScaleProps<T>) => {
  const startLabel = label(start);
  const endLabel = end === undefined ? startLabel : label(end);
  const to = end ?? start;
  const moved = end !== undefined && end !== start;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span aria-hidden="true" className="inline-flex shrink-0 gap-0.5">
        {scaleSteps(levels, start, to).map((step, index) => (
          <span key={levels[index + 1]} className={cn('h-1.5 w-5 rounded-[2px]', STEP_CLASS[step])} />
        ))}
      </span>
      <span className="txt-sub-content whitespace-nowrap text-default-secondary">
        {end === undefined && <span className="text-default-primary">{startLabel}</span>}
        {end !== undefined && !moved && <Trans>{startLabel}, unchanged</Trans>}
        {moved && <Trans>{startLabel} → <strong className="font-medium text-default-primary">{endLabel}</strong></Trans>}
      </span>
    </span>
  );
};
