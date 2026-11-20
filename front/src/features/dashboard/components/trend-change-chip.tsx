import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Chip } from '@filigran/design-system';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { FunctionComponent } from 'react';
import type { LifelineDirection } from '../../../components/shared';
import { roundPercentPoints } from '@app/utils/decimals';
import { formatAtMost, formatDateWith } from '../../../utils';
import { readChangeChip, toTenthsOfPoints, utcDayToTimestamp } from '../dashboard-utils';

export const formatTrendMonth = (timestamp: number): string =>
  formatDateWith(timestamp, { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Over what a change is measured when the series opens after the window's first day, `undefined` when it covers the window. */
export const changeTitleSince = (firstDate: string | null, windowStart: string): string | undefined =>
  firstDate === null || firstDate <= windowStart
    ? undefined
    : i18n._({ id: 'Change since {month}', message: 'Change since {month}', values: { month: formatTrendMonth(utcDayToTimestamp(firstDate)) } });

export const formatPointsChange = (change: number): string => {
  const points = roundPercentPoints(change, 0);
  return points > 0
    ? i18n._({ id: '+{points} pts', message: '+{points} pts', values: { points } })
    : i18n._({ id: '{points} pts', message: '{points} pts', values: { points } });
};

export const formatTenthsOfPointsChange = (change: number): string => {
  const tenths = toTenthsOfPoints(change);
  const points = formatAtMost(Math.abs(tenths), 1);
  if (tenths === 0) {
    return i18n._({ id: '{points} pts', message: '{points} pts', values: { points } });
  }
  return tenths > 0
    ? i18n._({ id: '+{points} pts', message: '+{points} pts', values: { points } })
    : i18n._({ id: '−{points} pts', message: '−{points} pts', values: { points } });
};

const CHANGE_SEVERITY: Record<LifelineDirection, 'critical' | 'low' | 'neutral'> = {
  up: 'critical',
  down: 'low',
  flat: 'neutral',
};

interface TrendChangeChipProps {
  reading: { change: number | null, direction: LifelineDirection },
  formatChange: (change: number) => string,
  /** What the change is measured over; a year when omitted. */
  title?: string,
}

export const TrendChangeChip: FunctionComponent<TrendChangeChipProps> = ({ reading, formatChange, title }) => {
  if (reading.change === null) {
    return null;
  }
  const chip = readChangeChip({ change: reading.change, direction: reading.direction }, formatChange);
  const Arrow = chip.sign > 0 ? ArrowUp : ArrowDown;
  return (
    <Chip
      label={chip.label}
      severity={CHANGE_SEVERITY[chip.direction]}
      startIcon={chip.sign === 0 ? undefined : <Arrow className="h-4 w-4" />}
      title={title ?? t`Change over 12 months`}
      className="tabular-nums"
    />
  );
};
