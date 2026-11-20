import { Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import type { FunctionComponent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { ExceedancePoint, ExceedanceReading, RiskToleranceLike } from '@app/module/client';
import { TooltipHintProvider } from '../../../components/shared/tooltip-hint';
import { formatDollar } from '../../../utils';
import { formatProbability, formatToleranceProbability } from '../../risk-tolerance/risk-tolerance-utils';
import { niceTicks, PROBABILITY_TICK_STEP } from '../loss-exceedance-utils';

const MIN_HEIGHT = 240;
const MARGIN = { top: 16, right: 36, bottom: 44, left: 52 };
const CURVE_COLOR = 'var(--fds-color-feedback-warning-primary)';
const ALE_COLOR = 'var(--fds-color-filigran-brand-primary)';
const OUTSIDE_COLOR = 'var(--fds-color-feedback-error-primary)';
const WITHIN_COLOR = 'var(--fds-color-feedback-success-primary)';
const DIAMOND = 11;

export interface LossExceedanceThreshold {
  tolerance: RiskToleranceLike,
  reading: ExceedanceReading,
  outside: boolean,
  breach: ReadonlyArray<ExceedancePoint>,
}

interface LossExceedanceChartProps {
  curve: ReadonlyArray<ExceedancePoint>,
  aleMean: number,
  threshold: LossExceedanceThreshold | null,
}

export const formatExceedance = (reading: ExceedanceReading): string => (reading.beyondTail
  ? i18n._({ id: 'Below {probability}', message: 'Below {probability}', values: { probability: formatProbability(reading.probability) } })
  : formatProbability(reading.probability));

export interface ExceedanceScale {
  x: (loss: number) => number,
  y: (probability: number) => number,
  baseline: number,
  plotLeft: number,
  plotTop: number,
  plotWidth: number,
  toPoints: (points: ReadonlyArray<ExceedancePoint>) => string,
}

interface ExceedanceChartFrameProps {
  ariaLabel?: string,
  /** The largest loss and probability the axes must reach: both are rounded up to a tick. */
  lossMax: number,
  probabilityMax: number,
  /** Drawn inside the SVG, over the grid and the axes. */
  plot: (scale: ExceedanceScale) => ReactNode,
  /** Positioned HTML over the SVG, such as a hover target. */
  overlay?: (scale: ExceedanceScale) => ReactNode,
}

/** Annual loss in dollars on x, probability of exceeding it on y, sized to its container's width. */
export const ExceedanceChartFrame: FunctionComponent<ExceedanceChartFrameProps> = ({ ariaLabel, lossMax, probabilityMax, plot, overlay }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: MIN_HEIGHT });
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    let frame: number | null = null;
    const measure = (): void => {
      frame = null;
      setSize({ width: container.clientWidth, height: Math.max(container.clientHeight, MIN_HEIGHT) });
    };
    measure();
    const observer = new ResizeObserver(() => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(measure);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);

  const { width, height } = size;
  const xTicks = niceTicks(lossMax, 5);
  const yTicks = niceTicks(probabilityMax, 4, PROBABILITY_TICK_STEP);
  const xMax = xTicks[xTicks.length - 1];
  const yMax = yTicks[yTicks.length - 1];
  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 0);
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const x = (loss: number): number => MARGIN.left + (loss / xMax) * plotWidth;
  const y = (probability: number): number => MARGIN.top + (1 - probability / yMax) * plotHeight;
  const baseline = y(0);
  const scale: ExceedanceScale = {
    x,
    y,
    baseline,
    plotLeft: MARGIN.left,
    plotTop: MARGIN.top,
    plotWidth,
    toPoints: (points) => points.map((point) => `${x(point.loss)},${y(point.probability)}`).join(' '),
  };

  return (
    <div ref={containerRef} className="relative w-full grow" style={{ minHeight: MIN_HEIGHT }}>
      {width > 0 && (
        <svg
          className="absolute inset-0"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={ariaLabel ?? t`Probability that the year's loss exceeds each amount`}
        >
          <g className="text-default-secondary" stroke="currentColor" strokeOpacity={0.2}>
            {yTicks.map((tick) => <line key={tick} x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(tick)} y2={y(tick)} />)}
          </g>
          <g className="text-default-secondary font-content-caption text-content-caption" fill="currentColor">
            {yTicks.map((tick) => <text key={tick} x={MARGIN.left - 8} y={y(tick) + 4} textAnchor="end">{formatProbability(tick)}</text>)}
            {xTicks.map((tick) => <text key={tick} x={x(tick)} y={baseline + 18} textAnchor="middle">{tick === 0 ? '0' : formatDollar(tick)}</text>)}
            <text x={MARGIN.left + plotWidth / 2} y={height - 6} textAnchor="middle">{t`Annual loss`}</text>
          </g>
          {plot(scale)}
        </svg>
      )}
      {width > 0 && overlay?.(scale)}
    </div>
  );
};

export const toleranceVerdictColor = (outside: boolean): string => (outside ? OUTSIDE_COLOR : WITHIN_COLOR);

/** Both guides cross the whole plot, so a curve can be read against the amount and the probability anywhere. */
export const ToleranceGuides: FunctionComponent<{ scale: ExceedanceScale, tolerance: RiskToleranceLike }> = ({ scale, tolerance }) => {
  const { x, y, baseline, plotLeft, plotTop, plotWidth } = scale;
  return (
    <g className="text-default-primary" stroke="currentColor" strokeOpacity={0.6} strokeDasharray="3 4">
      <line x1={plotLeft} x2={plotLeft + plotWidth} y1={y(tolerance.maxExceedanceProbability)} y2={y(tolerance.maxExceedanceProbability)} />
      <line x1={x(tolerance.annualLoss)} x2={x(tolerance.annualLoss)} y1={baseline} y2={plotTop} />
    </g>
  );
};

/** The stretch of a curve above the tolerance, from the threshold amount to where it falls back to the maximum probability. */
export const ToleranceBreach: FunctionComponent<{ scale: ExceedanceScale, breach: ReadonlyArray<ExceedancePoint> }> = ({ scale, breach }) => (breach.length > 1
  ? <polyline points={scale.toPoints(breach)} fill="none" stroke={OUTSIDE_COLOR} strokeWidth={3} strokeLinejoin="round" />
  : null);

/** A curve's reading at the threshold amount, coloured by whether it sits outside the tolerance. */
export const ToleranceReadingDot: FunctionComponent<{ scale: ExceedanceScale, tolerance: RiskToleranceLike, reading: ExceedanceReading, outside: boolean }> = ({
  scale,
  tolerance,
  reading,
  outside,
}) => (
  <circle
    cx={scale.x(tolerance.annualLoss)}
    cy={scale.y(reading.probability)}
    r={5}
    fill={toleranceVerdictColor(outside)}
    stroke="var(--fds-bg-elevation-default)"
    strokeWidth={2}
  />
);

export interface ToleranceTooltipReading {
  label: string,
  reading: ExceedanceReading,
  outside: boolean,
}

/** A hover and focus target over the tolerance point, stating the tolerance and each curve's reading at it. */
export const ToleranceTooltip: FunctionComponent<{ scale: ExceedanceScale, tolerance: RiskToleranceLike, readings: ReadonlyArray<ToleranceTooltipReading> }> = ({
  scale,
  tolerance,
  readings,
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        aria-label={t`Risk tolerance point`}
        className="absolute size-6 -translate-x-1/2 -translate-y-1/2 cursor-help rounded-full bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-ring"
        style={{ left: scale.x(tolerance.annualLoss), top: scale.y(tolerance.maxExceedanceProbability) }}
      />
    </TooltipTrigger>
    <TooltipContent className="flex flex-col gap-1 p-[10px_12px]">
      <span className="grid grid-cols-[auto_auto] justify-between gap-x-4">
        <span className="text-default-secondary">{t`Threshold amount`}</span>
        <span className="text-right tabular-nums">{formatDollar(tolerance.annualLoss)}</span>
      </span>
      <span className="grid grid-cols-[auto_auto] justify-between gap-x-4">
        <span className="text-default-secondary">{t`Maximum probability`}</span>
        <span className="text-right tabular-nums">{formatToleranceProbability(tolerance.maxExceedanceProbability)}</span>
      </span>
      {readings.map(({ label, reading, outside }) => (
        <span key={label} className="grid grid-cols-[auto_auto] justify-between gap-x-4">
          <span className="text-default-secondary">{label}</span>
          <span className="text-right font-semibold tabular-nums" style={{ color: toleranceVerdictColor(outside) }}>
            {formatExceedance(reading)}
          </span>
        </span>
      ))}
    </TooltipContent>
  </Tooltip>
);

export const ToleranceDiamond: FunctionComponent<{ scale: ExceedanceScale, tolerance: RiskToleranceLike }> = ({ scale, tolerance }) => {
  const cx = scale.x(tolerance.annualLoss);
  const cy = scale.y(tolerance.maxExceedanceProbability);
  return (
    <rect
      x={cx - DIAMOND / 2}
      y={cy - DIAMOND / 2}
      width={DIAMOND}
      height={DIAMOND}
      transform={`rotate(45 ${cx} ${cy})`}
      className="text-default-primary"
      fill="currentColor"
      stroke="var(--fds-bg-elevation-default)"
      strokeWidth={2}
    />
  );
};

export const LossExceedanceChart: FunctionComponent<LossExceedanceChartProps> = ({ curve, aleMean, threshold }) => {
  const lastLoss = curve[curve.length - 1].loss;

  const plot = (scale: ExceedanceScale): ReactNode => {
    const { x, baseline, plotLeft, plotTop, plotWidth, toPoints } = scale;
    const curvePoints = toPoints(curve);
    const aleLabel = i18n._({ id: 'ALE {amount}', message: 'ALE {amount}', values: { amount: formatDollar(aleMean) } });
    const aleX = x(aleMean);
    const aleLabelOnLeft = aleX > plotLeft + plotWidth * 0.75;
    return (
      <>
        <polygon points={`${curvePoints} ${x(lastLoss)},${baseline} ${x(0)},${baseline}`} fill={CURVE_COLOR} fillOpacity={0.12} />
        <polyline points={curvePoints} fill="none" stroke={CURVE_COLOR} strokeWidth={2} strokeLinejoin="round" />
        <line x1={aleX} x2={aleX} y1={plotTop} y2={baseline} stroke={ALE_COLOR} strokeDasharray="4 4" />
        <text
          x={aleLabelOnLeft ? aleX - 6 : aleX + 6}
          y={plotTop + 12}
          textAnchor={aleLabelOnLeft ? 'end' : 'start'}
          fill={ALE_COLOR}
          className="font-content-caption text-content-caption"
        >
          {aleLabel}
        </text>
        {threshold !== null && (
          <>
            <ToleranceBreach scale={scale} breach={threshold.breach} />
            <ToleranceGuides scale={scale} tolerance={threshold.tolerance} />
            <ToleranceReadingDot scale={scale} tolerance={threshold.tolerance} reading={threshold.reading} outside={threshold.outside} />
            <ToleranceDiamond scale={scale} tolerance={threshold.tolerance} />
          </>
        )}
      </>
    );
  };

  const overlay = (scale: ExceedanceScale): ReactNode => threshold !== null && (
    <ToleranceTooltip
      scale={scale}
      tolerance={threshold.tolerance}
      readings={[{ label: t`Scenario's probability of exceeding it`, reading: threshold.reading, outside: threshold.outside }]}
    />
  );

  return (
    <TooltipHintProvider>
      <ExceedanceChartFrame
        lossMax={Math.max(lastLoss, aleMean, threshold?.tolerance.annualLoss ?? 0)}
        probabilityMax={Math.max(curve[0].probability, threshold?.tolerance.maxExceedanceProbability ?? 0)}
        plot={plot}
        overlay={overlay}
      />
    </TooltipHintProvider>
  );
};
