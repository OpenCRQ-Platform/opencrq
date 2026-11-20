import type { CoverageBucket, StrengthRung } from '@app/module/client';
import { t } from '@lingui/core/macro';
import type { FunctionComponent, ReactElement } from 'react';
import { cn } from '../../../../utils';
import { computeSoloEffectiveness, formatEffectivenessPercent } from '../utils/capability-effectiveness';
import { coverageLabel } from './coverage-label';
import { effectivenessLabel, effectivenessTextClass, isScoredBand } from './effectiveness-badge';
import { strengthLabel } from './strength-label';

export interface DimensionReading {
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
}

interface DimensionCellProps {
  /** `null` for a control never assessed. */
  reading: DimensionReading | null,
}

const NotAssessed = (): ReactElement => (
  <span className="text-muted-foreground">{t`Not assessed`}</span>
);

export const StrengthCell: FunctionComponent<DimensionCellProps> = ({ reading }) =>
  (reading === null ? <NotAssessed /> : <span>{strengthLabel(reading.strengthRung)}</span>);

export const CoverageCell: FunctionComponent<DimensionCellProps> = ({ reading }) =>
  (reading === null ? <NotAssessed /> : <span>{coverageLabel(reading.coverageBucket)}</span>);

export const EffectivenessCell: FunctionComponent<DimensionCellProps> = ({ reading }) => {
  if (reading === null) {
    return <NotAssessed />;
  }
  const { band, score } = computeSoloEffectiveness(reading);
  if (!isScoredBand(band)) {
    return <span className="text-muted-foreground">{effectivenessLabel(band)}</span>;
  }
  return (
    <span className={cn('flex items-baseline gap-1.5', effectivenessTextClass(band))}>
      <span className="font-semibold tabular-nums">{formatEffectivenessPercent(score)}</span>
      <span className="txt-sub-content">{effectivenessLabel(band)}</span>
    </span>
  );
};
