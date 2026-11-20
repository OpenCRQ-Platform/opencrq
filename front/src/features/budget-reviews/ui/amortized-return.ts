import { t } from '@lingui/core/macro';
import { formatReturnPercent } from '../../treatment-plans/treatment-plan-utils';
import { isAmortized } from '../budget-review-utils';

export const amortizedReturnLabel = (figure: { spent: number, annualSpent: number, amortizedReturnPercent: number | null }): string | null => {
  if (!isAmortized(figure) || figure.amortizedReturnPercent === null) {
    return null;
  }
  const percent = formatReturnPercent(figure.amortizedReturnPercent);
  return t`amortized ${percent}`;
};
