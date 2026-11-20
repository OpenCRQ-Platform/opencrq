import type { FunctionComponent } from 'react';
import { EmptyValue } from '../../../components/ui/empty-value';
import { cn } from '../../../utils';
import { formatReturnPercent, returnPercentSign } from '../treatment-plan-utils';

interface PlanReturnProps {
  value: number | null,
  /** Priced against a state that has since changed: the figure stays, greyed. */
  expired?: boolean,
  className?: string,
}

export const PlanReturn: FunctionComponent<PlanReturnProps> = ({ value, expired, className }) => {
  if (value === null) {
    return <EmptyValue />;
  }
  const sign = returnPercentSign(value);
  const tone = expired === true
    ? 'text-default-secondary'
    : sign > 0 ? 'text-green-600' : sign < 0 ? 'text-red' : undefined;
  return <span className={cn('whitespace-nowrap', tone, className)}>{formatReturnPercent(value)}</span>;
};
