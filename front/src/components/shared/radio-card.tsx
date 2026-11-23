import { Radio } from '@filigran/design-system';
import type { FunctionComponent, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '../../utils/cn';

interface RadioCardProps {
  value: string,
  title: string,
  description: string,
  /** A choice that cannot be taken now; `note` says why. */
  disabled?: boolean,
  note?: ReactNode,
}

/**
 * One choice of a `RadioGroup` as a card. The card itself is the `<label>` the design system's own
 * `Radio` renders only around its title, so the description and the whole surface select the choice.
 */
export const RadioCard: FunctionComponent<RadioCardProps> = ({ value, title, description, disabled, note }) => {
  const radioId = useId();
  const descriptionId = `${radioId}-description`;
  return (
    <label
      htmlFor={radioId}
      className={cn(
        'flex flex-col gap-1 rounded-sm border border-elevation-subtle-soft p-4',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
      )}
    >
      <span className="flex items-center gap-2">
        <Radio id={radioId} value={value} disabled={disabled} aria-label={title} aria-describedby={descriptionId} />
        <span className={cn('content-base', disabled ? 'text-default-disabled' : 'text-input-value')}>{title}</span>
      </span>
      <span id={descriptionId} className="flex flex-col gap-1 pl-6 content-compact text-input-helper">
        <span>{description}</span>
        {note}
      </span>
    </label>
  );
};
