import type { ExceedanceReading } from '@app/module/client';
import { isOutsideTolerance } from '@app/module/client';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';
import type { ExceedanceScale } from '../../dashboard/components/loss-exceedance-chart';
import type { ToleranceChartModel, ToleranceCurveKey, ToleranceReference } from '../budget-review-tolerance-utils';
import { chartSeriesColors, chartVerdictColor } from '../../../components/shared/chart-utils';
import { TooltipHintProvider } from '../../../components/shared/tooltip-hint';
import { useTheme } from '../../../providers/theme-provider';
import { formatDollar } from '../../../utils/format-currency';
import { formatToleranceProbability } from '../../risk-tolerance/risk-tolerance-utils';
import {
  ExceedanceChartFrame,
  formatExceedance,
  ToleranceBreach,
  ToleranceDiamond,
  ToleranceGuides,
  ToleranceReadingDot,
  ToleranceTooltip,
  toleranceVerdictColor,
} from '../../dashboard/components/loss-exceedance-chart';
import { breachSegment } from '../../dashboard/loss-exceedance-utils';
import { readingLabelBaseline } from '../budget-review-tolerance-utils';
import { LegendSwatch } from '../ui/legend-swatch';
import { readAtReferenceLabel, referenceLegend } from '../ui/tolerance-reference';

const WITHOUT_BUILD_DASH = '6 4';
/** A generous average glyph width of the caption font, enough to tell whether a label fits beside its point. */
const LABEL_CHAR_WIDTH = 7;
const LABEL_GAP = 10;
/** Painted under each reading's label, so it stays legible where it crosses a curve, a guide or the diamond. */
const LABEL_HALO = 'var(--fds-bg-elevation-default)';

const readLabel = (key: ToleranceCurveKey, reference: ToleranceReference, reading: ExceedanceReading): string => {
  const probability = formatExceedance(reading);
  return key === 'withoutBuild' ? t`${probability} without the build work` : readAtReferenceLabel(reference, probability);
};

const chartLabel = (model: ToleranceChartModel, reference: ToleranceReference): string | undefined => {
  const [referenceSeries, withoutBuildSeries] = model.series;
  if (model.tolerance === null || referenceSeries.read === null || withoutBuildSeries.read === null) {
    return undefined;
  }
  const atReference = readLabel('reference', reference, referenceSeries.read.reading);
  const withoutBuild = readLabel('withoutBuild', reference, withoutBuildSeries.read.reading);
  const probability = formatToleranceProbability(model.tolerance.maxExceedanceProbability);
  const amount = formatDollar(model.tolerance.annualLoss);
  return t`Probability that the year's loss exceeds each amount: ${atReference}, ${withoutBuild}, tolerance ${probability} at ${amount}`;
};

const ToleranceSwatch: FunctionComponent = () => (
  <span className="inline-flex items-center gap-2 txt-sub-content text-default-secondary">
    <span aria-hidden="true" className="inline-block size-2 rotate-45 bg-current text-default-primary" />
    <Trans>Risk tolerance point</Trans>
  </span>
);

interface BudgetReviewToleranceChartProps {
  model: ToleranceChartModel,
  reference: ToleranceReference,
}

export const BudgetReviewToleranceChart: FunctionComponent<BudgetReviewToleranceChartProps> = ({ model, reference }) => {
  const { effectiveTheme } = useTheme();
  const [referenceColor] = chartSeriesColors(effectiveTheme);
  const colors: Record<ToleranceCurveKey, string> = { reference: referenceColor, withoutBuild: chartVerdictColor(effectiveTheme, 'bad') };
  const { tolerance, series } = model;

  const reads = tolerance === null
    ? []
    : series.flatMap(({ key, curve, read }) => (read === null
      ? []
      : [{ key, curve, read, outside: isOutsideTolerance(read.reading, tolerance) }]));

  const plot = (scale: ExceedanceScale): ReactNode => {
    const { x, y, plotLeft, plotWidth, toPoints } = scale;
    const readX = tolerance === null ? 0 : x(tolerance.annualLoss);
    const roomLeft = readX - plotLeft;
    const roomRight = plotLeft + plotWidth - readX;
    return (
      <>
        {series.map(({ key, curve }) => (
          <polyline
            key={key}
            points={toPoints(curve)}
            fill="none"
            stroke={colors[key]}
            strokeWidth={key === 'reference' ? 2.5 : 2}
            strokeDasharray={key === 'withoutBuild' ? WITHOUT_BUILD_DASH : undefined}
            strokeLinejoin="round"
          />
        ))}
        {tolerance !== null && (
          <>
            {reads.map(({ key, curve }) => <ToleranceBreach key={key} scale={scale} breach={breachSegment(curve, tolerance)} />)}
            <ToleranceGuides scale={scale} tolerance={tolerance} />
            {reads.map(({ key, read, outside }) => <ToleranceReadingDot key={key} scale={scale} tolerance={tolerance} reading={read.reading} outside={outside} />)}
            <ToleranceDiamond scale={scale} tolerance={tolerance} />
          </>
        )}
        {reads.map(({ key, read, outside }) => {
          const label = readLabel(key, reference, read.reading);
          const needed = label.length * LABEL_CHAR_WIDTH + LABEL_GAP;
          const labelOnLeft = read.side === 'above' ? roomRight < needed : roomLeft >= needed;
          return (
            <text
              key={key}
              x={labelOnLeft ? readX - LABEL_GAP : readX + LABEL_GAP}
              y={readingLabelBaseline(read.side, y(read.reading.probability), y(tolerance?.maxExceedanceProbability ?? 0))}
              textAnchor={labelOnLeft ? 'end' : 'start'}
              fill={toleranceVerdictColor(outside)}
              stroke={LABEL_HALO}
              strokeWidth={4}
              strokeLinejoin="round"
              paintOrder="stroke"
              fontWeight={600}
              className="font-content-caption text-content-caption"
            >
              {label}
            </text>
          );
        })}
      </>
    );
  };

  const overlay = (scale: ExceedanceScale): ReactNode => tolerance !== null && (
    <ToleranceTooltip
      scale={scale}
      tolerance={tolerance}
      readings={reads.map(({ key, read, outside }) => ({
        label: key === 'withoutBuild' ? t`Without the period's build work` : referenceLegend(reference),
        reading: read.reading,
        outside,
      }))}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span className="txt-sub-content text-default-secondary"><Trans>Loss exceedance curve</Trans></span>
        <span className="flex flex-wrap items-center gap-5">
          <LegendSwatch color={colors.reference} dashed={false} label={referenceLegend(reference)} />
          <LegendSwatch color={colors.withoutBuild} dashed label={t`Without the period's build work`} />
          {tolerance !== null && <ToleranceSwatch />}
        </span>
      </div>
      <TooltipHintProvider>
        <ExceedanceChartFrame ariaLabel={chartLabel(model, reference)} lossMax={model.lossMax} probabilityMax={model.probabilityMax} plot={plot} overlay={overlay} />
      </TooltipHintProvider>
    </div>
  );
};
