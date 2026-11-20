import type { ChangeEvent } from '@app/module/client';
import type { CategoryView } from './categories';
import { formatDollar, formatFixed, formatFractionAsPercent } from '../../../../utils';
import { EMPTY_VALUE } from '../../../../utils/empty-value';
import { formatThreat } from '../overview/ale-decomposition-utils';

export const formatChangeValue = (
  view: CategoryView,
  item: ChangeEvent['item'],
  format: NonNullable<ChangeEvent['values']>['format'],
  value: number | string | null,
): string => {
  if (value === null) {
    return EMPTY_VALUE;
  }
  if (typeof value === 'string') {
    return view.textValue?.(item, value) ?? value;
  }
  switch (format) {
    case 'frequency':
      return formatThreat(value);
    case 'share':
      return formatFractionAsPercent(value, 1);
    case 'currency':
      return formatDollar(value);
    case 'count':
    case 'text':
    default:
      return formatFixed(value, 0);
  }
};
