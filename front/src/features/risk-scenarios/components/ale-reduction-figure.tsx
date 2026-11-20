import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { formatDollar, formatFractionAsPercent } from '../../../utils';
import { aleShare } from '../cve-gain-utils';

interface AleReductionFigureProps {
  mean: number,
  p10: number | null,
  p90: number | null,
  baselineAle: number | null,
}

export const AleReductionFigure: FunctionComponent<AleReductionFigureProps> = ({ mean, p10, p90, baselineAle }) => {
  const share = aleShare(mean, baselineAle);
  const low = p10 === null ? null : formatDollar(p10);
  const high = p90 === null ? null : formatDollar(p90);
  const spread = low !== null && high !== null ? t`p10 ${low} to p90 ${high}` : t`Band not computed`;
  return (
    <div className="flex flex-col">
      <span className="text-green-600">
        -{formatDollar(mean)}{share !== null && ` (${formatFractionAsPercent(share, 1)})`}
      </span>
      <span className="txt-mini text-muted-foreground">{spread}</span>
    </div>
  );
};
