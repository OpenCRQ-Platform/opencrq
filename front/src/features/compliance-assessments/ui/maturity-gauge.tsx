import type { FunctionComponent } from 'react';
import { tileTonePaint } from '../../../components/shared';
import { cn } from '../../../utils/cn';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { formatFixed } from '../../../utils/format-number';
import { GaugeArc, gaugeGeometry } from '../../finding-score';
import { MATURITY_SCALE_MAX, maturitySeverity } from '../compliance-assessments-utils';

const GAUGE_SIZE = 104;

/** `label` names the reading, since the arc is hidden from assistive technology. A null mean draws the track alone. */
export const MaturityGauge: FunctionComponent<{ meanLevel: number | null, label: string }> = ({ meanLevel, label }) => {
  const { centre, endOffset, arcBottom } = gaugeGeometry(GAUGE_SIZE);
  const paint = meanLevel === null ? null : tileTonePaint(maturitySeverity(meanLevel));
  return (
    <span className="inline-flex shrink-0 flex-col items-center" style={{ width: GAUGE_SIZE }}>
      <span className="relative block" style={{ height: arcBottom }}>
        <GaugeArc
          fill={meanLevel === null || paint === null ? null : { share: (meanLevel / MATURITY_SCALE_MAX) * 100, color: paint.glyph }}
          size={GAUGE_SIZE}
        />
        <span
          role="img"
          className={cn(
            'absolute inset-x-0 text-center font-title-2xl text-title-2xl font-medium leading-[var(--fds-leading-tight)] tracking-title-2xl tabular-nums',
            paint === null && 'text-default-secondary',
          )}
          style={{ top: centre, transform: 'translateY(-50%)', ...(paint === null ? {} : { color: paint.text }) }}
          aria-label={label}
        >
          {meanLevel === null ? EMPTY_VALUE : formatFixed(meanLevel, 1)}
        </span>
      </span>
      <span
        aria-hidden
        className="flex justify-between font-content-caption text-content-caption tabular-nums text-default-secondary"
        style={{ width: endOffset * 2 }}
      >
        <span>0</span>
        <span>{MATURITY_SCALE_MAX}</span>
      </span>
    </span>
  );
};
