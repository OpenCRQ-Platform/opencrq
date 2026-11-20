import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { cn } from '../../../utils';
import { formatDollar } from '../../../utils/format-currency';

interface LossAvoidedSpreadProps {
  figure: { aleReductionP10: number | null, aleReductionP90: number | null } | undefined,
  className?: string,
}

export const LossAvoidedSpread: FunctionComponent<LossAvoidedSpreadProps> = ({ figure, className }) => {
  if (figure === undefined || figure.aleReductionP10 === null || figure.aleReductionP90 === null) {
    return null;
  }
  const low = formatDollar(figure.aleReductionP10);
  const high = formatDollar(figure.aleReductionP90);
  return <span className={cn('txt-sub-content whitespace-nowrap text-default-secondary', className)}><Trans>{low} to {high}</Trans></span>;
};
