import { Chip } from '@filigran/design-system';
import type { ChipSeverity } from '@filigran/design-system';
import type { SeverityBand } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { gaugeGeometry } from './score-gauge-geometry';
import { severityBandFigureColor, severityBandFillColor, severityBandLabel } from './severity-ramp';

/** The scale the finding score is published on, which the arc spans end to end. */
const SCORE_MAX = 100;

const BAND_CHIP_SEVERITY: Record<SeverityBand, ChipSeverity> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

interface GaugeArcProps {
  /** Null draws the track alone, for a reading that has no figure. `share` runs 0 to 100 whatever scale the reading is on. */
  fill: { share: number, color: string } | null,
  size: number,
}

/**
 * The arc alone: a recessed track, and over it the share of the scale the score reaches.
 *
 * `pathLength` restates the arc as a hundred units long, so the dash offset is the share itself and
 * no caller has to know the arc's real length. The box is cropped to the arc's lowest point: the
 * square the geometry centres the arc in has a quarter of empty height under it.
 */
export const GaugeArc: FunctionComponent<GaugeArcProps> = ({ fill, size }) => {
  const { path, strokeWidth, arcBottom } = gaugeGeometry(size);
  return (
    <svg
      aria-hidden
      width={size}
      height={arcBottom}
      viewBox={`0 0 ${size} ${arcBottom}`}
      fill="none"
      className="block"
    >
      <path
        d={path}
        stroke="var(--fds-color-feedback-neutral-secondary-transparency-30)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {fill !== null && (
        <path
          className="gauge-arc-fill"
          d={path}
          pathLength={SCORE_MAX}
          // The dash spans the whole scale and the offset hides what the score does not reach, so
          // one animated length grows the arc from its start. The gap runs past the end of the arc
          // on purpose: a gap of exactly the arc's own length makes the pattern repeat right on the
          // last point, which puts a second round cap there.
          strokeDasharray={`${SCORE_MAX} ${SCORE_MAX + 1}`}
          strokeDashoffset={SCORE_MAX - Math.min(Math.max(fill.share, 0), SCORE_MAX)}
          stroke={fill.color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
};

/** Side of the square the arc is drawn in: wide enough for the figure and its band chip inside. */
const GAUGE_SIZE = 104;

/**
 * A 0 to 100 score as a filled arc: the figure inside it, the band under the figure, and the
 * ends of the scale under the arc.
 *
 * Colour is the band's, on the arc and on the figure alike, so the two never disagree. It is never
 * the only carrier of the level: the chip words it, and the ends state the scale the figure is on.
 * `label` names which score it is, since the arc is hidden from assistive technology.
 */
export const ScoreGauge: FunctionComponent<{
  score: number,
  band: SeverityBand,
  label: string,
}> = ({ score, band, label }) => {
  const { centre, endOffset, arcBottom } = gaugeGeometry(GAUGE_SIZE);
  const bandWord = severityBandLabel(band);
  return (
    <span className="inline-flex shrink-0 flex-col items-center" style={{ width: GAUGE_SIZE }}>
      <span className="relative block" style={{ height: arcBottom }}>
        <GaugeArc fill={{ share: score, color: severityBandFillColor(band) }} size={GAUGE_SIZE} />
        <span
          className="absolute inset-x-0 flex flex-col items-center gap-1"
          style={{ top: centre, transform: 'translateY(-50%)' }}
        >
          <span
            role="img"
            className="font-title-2xl text-title-2xl font-medium leading-[var(--fds-leading-tight)] tracking-title-2xl tabular-nums"
            style={{ color: severityBandFigureColor(band) }}
            aria-label={label}
          >
            {score}
          </span>
          <Chip aria-hidden severity={BAND_CHIP_SEVERITY[band]} label={bandWord} />
        </span>
      </span>
      <span
        aria-hidden
        className="flex justify-between font-content-caption text-content-caption tabular-nums text-default-secondary"
        style={{ width: endOffset * 2 }}
      >
        <span>0</span>
        <span>{SCORE_MAX}</span>
      </span>
    </span>
  );
};

export const EmptyScoreGauge: FunctionComponent<{ label: string }> = ({ label }) => {
  const { centre, endOffset, arcBottom } = gaugeGeometry(GAUGE_SIZE);
  return (
    <span className="inline-flex shrink-0 flex-col items-center" style={{ width: GAUGE_SIZE }}>
      <span className="relative block" style={{ height: arcBottom }}>
        <GaugeArc fill={null} size={GAUGE_SIZE} />
        <span
          role="img"
          className="absolute inset-x-0 text-center font-title-2xl text-title-2xl font-medium leading-[var(--fds-leading-tight)] text-default-secondary"
          style={{ top: centre, transform: 'translateY(-50%)' }}
          aria-label={label}
        >
          {EMPTY_VALUE}
        </span>
      </span>
      <span
        aria-hidden
        className="flex justify-between font-content-caption text-content-caption tabular-nums text-default-secondary"
        style={{ width: endOffset * 2 }}
      >
        <span>0</span>
        <span>{SCORE_MAX}</span>
      </span>
    </span>
  );
};

/** Side that keeps the arc legible, and the figure inside it, in a table cell or a header tile. */
const MARK_GAUGE_SIZE = 40;

/**
 * The same arc, shrunk to hold nothing but the figure: no band chip, no scale ends. It is the score
 * wherever the score is one reading among many, in a table cell or in the header strip of a page.
 */
export const ScoreGaugeMark: FunctionComponent<{
  score: number,
  band: SeverityBand,
  label: string,
}> = ({ score, band, label }) => {
  const { centre, arcBottom } = gaugeGeometry(MARK_GAUGE_SIZE);
  return (
    <span
      className="relative inline-block shrink-0"
      style={{ width: MARK_GAUGE_SIZE, height: arcBottom }}
    >
      <GaugeArc fill={{ share: score, color: severityBandFillColor(band) }} size={MARK_GAUGE_SIZE} />
      <span
        role="img"
        className="absolute inset-x-0 text-center font-content-compact text-content-compact font-medium leading-none tabular-nums"
        style={{ top: centre, transform: 'translateY(-50%)', color: severityBandFigureColor(band) }}
        aria-label={label}
      >
        {score}
      </span>
    </span>
  );
};

export const EmptyScoreGaugeMark: FunctionComponent<{ label: string }> = ({ label }) => {
  const { centre, arcBottom } = gaugeGeometry(MARK_GAUGE_SIZE);
  return (
    <span
      className="relative inline-block shrink-0"
      style={{ width: MARK_GAUGE_SIZE, height: arcBottom }}
    >
      <GaugeArc fill={null} size={MARK_GAUGE_SIZE} />
      <span
        role="img"
        className="absolute inset-x-0 text-center font-content-compact text-content-compact font-medium leading-none text-default-secondary"
        style={{ top: centre, transform: 'translateY(-50%)' }}
        aria-label={label}
      >
        {EMPTY_VALUE}
      </span>
    </span>
  );
};

/** Side between the score's and a tile's, so the score, its two parts and their factors read at three sizes. */
const FACTOR_GAUGE_SIZE = 56;

interface FactorGaugeProps {
  figure: number,
  band: SeverityBand,
  /** States the reading, its scale and its band in words, since the arc itself is hidden. */
  label: string,
}

/**
 * One of the score's two parts in the score's own instrument, one size down, so the parts read as
 * smaller versions of the conclusion above them.
 */
export const FactorGauge: FunctionComponent<FactorGaugeProps> = ({ figure, band, label }) => {
  const { centre, arcBottom } = gaugeGeometry(FACTOR_GAUGE_SIZE);
  return (
    <span
      className="relative inline-block shrink-0"
      style={{ width: FACTOR_GAUGE_SIZE, height: arcBottom }}
    >
      <GaugeArc fill={{ share: figure, color: severityBandFillColor(band) }} size={FACTOR_GAUGE_SIZE} />
      <span
        role="img"
        className="absolute inset-x-0 text-center"
        style={{ top: centre, transform: 'translateY(-50%)' }}
        aria-label={label}
      >
        <span
          className="font-content-code text-[var(--fds-text-5)] font-medium leading-[var(--fds-leading-tight)] tabular-nums"
          style={{ color: severityBandFigureColor(band) }}
        >
          {figure}
        </span>
      </span>
    </span>
  );
};
