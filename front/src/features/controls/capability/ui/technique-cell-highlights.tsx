import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { CapabilityFunction } from '@app/module/client';
import { FlaskConical, PenLine } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ControlTechniqueTestReading, CoveredTechniqueTestReading, TechniqueTestOutcome } from '../types/validation';
import type { CellBar, HighlightedTechnique } from '../../../../components/shared/ttp-matrix-cell';
import type { EfficacyVerdict } from '../utils/engine-efficacy-utils';
import type { TestedUncoveredReading } from '../utils/control-technique-readings-utils';
import { CellBars } from '../../../../components/shared/ttp-matrix-cell';
import { cn } from '../../../../utils';
import { feedbackFigureColor, feedbackFillColor } from '../../../finding-score';
import { efficacyFigureColor } from '../components/engine-efficacy-cells';
import { formatEnginePercent } from '../utils/engine-efficacy-utils';
import { FUNCTION_COLOR } from '../utils/technique-matrix-utils';
import { verdictOfTechnique } from '../utils/control-technique-readings-utils';
import { openAevResultLine } from './test-result-text';

const BAR_ICON_SIZE = 11;
const DECLARED_BAR_COLOR = 'var(--fds-text-default-secondary)';
const CONFIRMED_BAR_COLOR = 'var(--fds-color-filigran-brand-primary)';

type Origin = Array<{ label: string, value: string }>;

/** What a cell needs from the matrix it sits in. */
export interface CellContext {
  capabilityFunction: CapabilityFunction,
  /** Whether an active edge ties the technique to the control. */
  isLinked: (techniqueId: string) => boolean,
  /** Opens the efficacy's explanation for the technique. */
  onExplain: (techniqueId: string) => void,
}

const declaredBar = (reading: CoveredTechniqueTestReading): CellBar => {
  const declared = formatEnginePercent(reading.declared);
  return {
    ratio: reading.declared,
    fillColor: DECLARED_BAR_COLOR,
    figureColor: DECLARED_BAR_COLOR,
    figure: declared,
    label: t`Declared ${declared}`,
    icon: <PenLine size={BAR_ICON_SIZE} />,
    name: t({ message: 'Declared', context: 'engine efficacy' }),
  };
};

const resultBar = (reading: ControlTechniqueTestReading, ratio: number): CellBar => {
  const isLowered = verdictOfTechnique(reading) === 'lowered';
  // A result the engine does not count keeps the declaration's neutral tone, never the covered ones.
  const color = reading.covered ? CONFIRMED_BAR_COLOR : DECLARED_BAR_COLOR;
  const rate = formatEnginePercent(ratio);
  return {
    ratio,
    fillColor: isLowered ? feedbackFillColor('warning') : color,
    figureColor: (reading.covered ? efficacyFigureColor(reading) : undefined) ?? color,
    figure: rate,
    label: t`OpenAEV ${rate}`,
    icon: <FlaskConical size={BAR_ICON_SIZE} />,
    name: t`OpenAEV`,
  };
};

const coveredVerdictLabel = (verdict: Exclude<EfficacyVerdict, 'untested'>): string =>
  (verdict === 'lowered' ? t`Covered · lowered by the tests` : t`Covered · confirmed by the tests`);

/**
 * A tested cell's tooltip: the verdict in its tone, the engine efficacy where the engine reads one,
 * the cell's bars named, and the tests behind the result.
 */
const TestedCellTooltip = ({ verdict, verdictColor, efficacy, efficacyColor, bars, result, origin }: {
  verdict: string,
  verdictColor: string,
  efficacy?: string,
  efficacyColor?: string,
  bars: Array<CellBar>,
  result: string,
  origin?: string,
}): ReactNode => (
  <>
    <span className="flex items-center gap-1.5 txt-sub-content font-medium" style={{ color: verdictColor }}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: verdictColor }} />
      {verdict}
    </span>
    {efficacy !== undefined && (
      <span className="flex items-baseline gap-2">
        <span className="txt-title font-medium leading-none tabular-nums" style={efficacyColor === undefined ? undefined : { color: efficacyColor }}>{efficacy}</span>
        <span className="txt-sub-content text-muted-foreground"><Trans>Engine efficacy</Trans></span>
      </span>
    )}
    <CellBars bars={bars} named />
    <span className="txt-sub-content text-muted-foreground">{result}</span>
    {origin !== undefined && <span className="txt-sub-content text-muted-foreground">{origin}</span>}
  </>
);

/** What a tested cell carries, said once above the matrix. */
export const MatrixLegend = (): ReactNode => (
  <div className="flex flex-wrap items-center gap-3.5 txt-sub-content text-muted-foreground">
    <span className="flex items-center gap-1.5">
      <span aria-hidden="true" className="txt-subtitle2 leading-none text-default-primary">%</span>
      <Trans>Engine efficacy, on the tested techniques</Trans>
    </span>
    <span className="flex items-center gap-1.5">
      <PenLine aria-hidden size={BAR_ICON_SIZE} />
      <Trans context="engine efficacy">Declared</Trans>
    </span>
    <span className="flex items-center gap-1.5">
      <FlaskConical aria-hidden size={BAR_ICON_SIZE} />
      <Trans>OpenAEV result</Trans>
    </span>
  </div>
);

const explainOnClick = (techniqueId: string, { onExplain }: CellContext): HighlightedTechnique['renderLink'] => ({ className, children }) => (
  <button type="button" className={cn(className, 'text-left')} onClick={() => onExplain(techniqueId)}>
    {children}
  </button>
);

// The cell hue is already the function's, which tells the reader whether they are looking at
// prevention or detection. What the tests did to the declaration rides the figure, the bars and
// the tooltip, never a recolouring.
const pricedHighlight = (
  base: HighlightedTechnique,
  origin: Origin,
  reading: ControlTechniqueTestReading & CoveredTechniqueTestReading & { tested: TechniqueTestOutcome },
  context: CellContext,
): HighlightedTechnique => {
  const verdict = verdictOfTechnique(reading) === 'lowered' ? 'lowered' : 'confirmed';
  const efficacy = formatEnginePercent(reading.efficacy);
  const bars = [declaredBar(reading), resultBar(reading, reading.tested.rate)];
  const originLine = origin.map((entry) => `${entry.label}: ${entry.value}`).join(' · ');
  const result = openAevResultLine(context.capabilityFunction, reading.tested);
  return {
    ...base,
    categoryLabel: coveredVerdictLabel(verdict),
    tooltipExtra: [
      ...origin,
      { label: t`Engine efficacy`, value: efficacy },
      { label: t({ message: 'Declared', context: 'engine efficacy' }), value: formatEnginePercent(reading.declared) },
      { label: t`OpenAEV`, value: result },
    ],
    tooltipContent: (
      <TestedCellTooltip
        verdict={verdict === 'lowered'
          ? t({ message: 'Lowered by the tests', context: 'technique filter' })
          : t({ message: 'Confirmed by the tests', context: 'technique filter' })}
        verdictColor={verdict === 'lowered' ? feedbackFigureColor('warning') : feedbackFigureColor('success')}
        efficacy={efficacy}
        efficacyColor={efficacyFigureColor(reading)}
        bars={bars}
        result={result}
        origin={originLine === '' ? undefined : originLine}
      />
    ),
    tooltipHint: t`Click for the calculation`,
    marker: efficacy,
    markerColor: efficacyFigureColor(reading),
    bars,
    keepsHue: true,
    renderLink: explainOnClick(reading.mitreTechniqueId, context),
  };
};

/**
 * A tested technique the engine does not read for the control takes no function hue: a cell with
 * its result alone, dashed, or in the warning tone where nothing links it to the control.
 * `linkedLabel` names why a linked control is not read, "Not covered" by default.
 */
export const uncoveredHighlight = (reading: TestedUncoveredReading, context: CellContext, linkedLabel?: string): HighlightedTechnique => {
  const isUnlinked = !context.isLinked(reading.mitreTechniqueId);
  const unlinkedLabel = t`Tested, not declared`;
  const result = openAevResultLine(context.capabilityFunction, reading.tested);
  return {
    id: reading.mitreTechniqueId,
    color: FUNCTION_COLOR[context.capabilityFunction],
    categoryLabel: isUnlinked ? unlinkedLabel : linkedLabel ?? t`Not covered · tested`,
    tooltipExtra: [{ label: t`OpenAEV`, value: result }],
    tooltipContent: (
      <TestedCellTooltip
        verdict={isUnlinked ? unlinkedLabel : linkedLabel ?? t`Not covered by this control`}
        verdictColor={isUnlinked ? feedbackFigureColor('warning') : DECLARED_BAR_COLOR}
        bars={[resultBar(reading, reading.tested.rate)]}
        result={result}
      />
    ),
    tooltipHint: isUnlinked ? t`Click to see the tests and link the technique` : t`Click for what was tested`,
    // The cell drops an accent it is outlined with, so the warning takes the dashes' place.
    ...(isUnlinked ? { accent: feedbackFillColor('warning') } : { outlined: true }),
    bars: [resultBar(reading, reading.tested.rate)],
    renderLink: explainOnClick(reading.mitreTechniqueId, context),
  };
};

/** A covered technique's cell, read through its reading when it has one; `reading` is omitted where results are not shown. */
export const coveredHighlight = (
  techniqueId: string,
  origin: Origin,
  reading: ControlTechniqueTestReading | undefined,
  context: CellContext,
): HighlightedTechnique => {
  const base: HighlightedTechnique = {
    id: techniqueId,
    color: FUNCTION_COLOR[context.capabilityFunction],
    categoryLabel: t`Covered`,
    tooltipExtra: origin.length === 0 ? undefined : origin,
  };
  if (reading === undefined) {
    return base;
  }
  if (!reading.covered) {
    return reading.tested === null
      ? { ...base, categoryLabel: t({ message: 'Not covered', context: 'engine efficacy' }), outlined: true }
      : uncoveredHighlight({ ...reading, tested: reading.tested }, context);
  }
  // A covered technique nothing has tested keeps the plain cell, which keeps hundreds of them quiet.
  return reading.tested === null ? base : pricedHighlight(base, origin, { ...reading, tested: reading.tested }, context);
};
