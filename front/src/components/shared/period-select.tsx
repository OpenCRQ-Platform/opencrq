import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { PeriodWindowId } from './period-window';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { isPeriodWindow, PERIOD_WINDOWS } from './period-window';

const windowLabel = (id: PeriodWindowId): string => {
  switch (id) {
    case '90d': return t`90 days`;
    case '6m': return t`6 months`;
    case '12m': return t`12 months`;
  }
};

interface PeriodSelectProps {
  value: PeriodWindowId,
  onChange: (next: PeriodWindowId) => void,
  /** Names what the window narrows, when the page holds more than one select. */
  ariaLabel?: string,
}

export const PeriodSelect: FunctionComponent<PeriodSelectProps> = ({ value, onChange, ariaLabel }) => (
  <Select
    value={value}
    onValueChange={(next) => {
      if (isPeriodWindow(next)) {
        onChange(next);
      }
    }}
  >
    <SelectTrigger className="w-32" aria-label={ariaLabel ?? t`Time window`}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {PERIOD_WINDOWS.map((option) => (
        <SelectItem key={option} value={option}>{windowLabel(option)}</SelectItem>
      ))}
    </SelectContent>
  </Select>
);
