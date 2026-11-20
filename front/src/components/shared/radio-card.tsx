import { Radio } from '@filigran/design-system';
import type { FunctionComponent } from 'react';
import { useId } from 'react';

interface RadioCardProps {
  value: string,
  title: string,
  description: string,
}

/**
 * One choice of a `RadioGroup` as a card. The card itself is the `<label>` the design system's own
 * `Radio` renders only around its title, so the description and the whole surface select the choice.
 */
export const RadioCard: FunctionComponent<RadioCardProps> = ({ value, title, description }) => {
  const radioId = useId();
  const descriptionId = `${radioId}-description`;
  return (
    <label
      htmlFor={radioId}
      className="flex cursor-pointer flex-col gap-1 rounded-sm border border-elevation-subtle-soft p-4"
    >
      <span className="flex items-center gap-2">
        <Radio id={radioId} value={value} aria-label={title} aria-describedby={descriptionId} />
        <span className="content-base text-input-value">{title}</span>
      </span>
      <span id={descriptionId} className="pl-6 content-compact text-input-helper">{description}</span>
    </label>
  );
};
