import type { FunctionComponent } from 'react';
import { TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { cvssMetricLabel, cvssValueLabel } from '../../finding-score';

interface CvssVectorCellsProps {
  metrics: Array<{ metric: string, value: string }>,
  /** The published vector, which is what tells a 3.x letter from the 4.0 letter that reuses it. */
  vector: string | null,
}

export const CvssVectorCells: FunctionComponent<CvssVectorCellsProps> = ({ metrics, vector }) => (
  <TooltipHintProvider>
    <div className="flex flex-wrap gap-2">
      {metrics.map(({ metric, value }) => {
        const metricLabel = cvssMetricLabel(metric, vector);
        const valueLabel = cvssValueLabel(metric, value, vector);
        return (
          <TooltipHint key={metric} hint={metricLabel}>
            <span
              aria-label={`${metricLabel}: ${valueLabel}`}
              className="flex items-center gap-1.5 rounded-[var(--fds-radius-sm)] border px-2 py-1 font-content-code text-content-code"
              style={{ borderColor: 'var(--fds-border-elevation-subtle)' }}
            >
              <span aria-hidden="true" className="text-default-secondary">{metric}</span>
              <b aria-hidden="true" className="font-medium">{valueLabel}</b>
            </span>
          </TooltipHint>
        );
      })}
    </div>
  </TooltipHintProvider>
);
