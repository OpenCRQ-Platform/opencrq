import { i18n } from '@lingui/core';
import { Trans } from '@lingui/react/macro';
import type { SeverityBand } from '@app/module/client';
import { resolveSeverityBand } from '@app/module/client';
import type { FunctionComponent, ReactNode } from 'react';
import { Fragment } from 'react';
import type { FeedbackFamily } from '../severity-ramp';
import { cn } from '../../../../utils';
import {
  feedbackFigureColor,
  feedbackFillColor,
  feedbackWash,
  severityBandFamily,
  severityBandFillColor,
  severityBandLabel,
  severityBandRange,
} from '../severity-ramp';
import { formatFactor, toFigure } from './score-explanation-utils';

/**
 * What colours a figure: a score's severity band, or a verdict's feedback family, `null` reading
 * neutral.
 */
export type ExplanationTone = { band: SeverityBand } | { feedback: FeedbackFamily | null };

const familyOf = (tone: ExplanationTone): FeedbackFamily | null =>
  ('band' in tone ? severityBandFamily(tone.band) : tone.feedback);

/**
 * The conclusion of one explanation, above the arithmetic that produced it.
 *
 * It carries the band's wash and the band's figure colour, the same pair the panel it was opened
 * from carries, so a reader arriving in the dialog lands on the figure they clicked.
 */
export const ExplanationHero: FunctionComponent<ExplanationTone & {
  figure: ReactNode,
  unit: string,
  reading: ReactNode,
}> = ({ figure, unit, reading, ...tone }) => {
  const family = familyOf(tone);
  return (
    <div
      className="flex items-center gap-4 rounded-sm p-4"
      style={family === null
        ? { border: '1px solid var(--fds-border-elevation-subtle)' }
        : { backgroundImage: feedbackWash(family), backgroundOrigin: 'border-box', border: `1px solid ${feedbackFillColor(family)}` }}
    >
      <span
        className="shrink-0 font-title-xl text-title-xl tabular-nums"
        style={family === null ? undefined : { color: feedbackFigureColor(family) }}
      >
        {figure}
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            'font-content-compact-bold text-content-compact-bold uppercase tracking-[var(--fds-tracking-relaxed)]',
            family === null && 'text-default-secondary',
          )}
          style={family === null ? undefined : { color: feedbackFigureColor(family) }}
        >
          {unit}
        </span>
        <span className="font-content-compact text-content-compact text-default-secondary">{reading}</span>
      </span>
    </div>
  );
};

export const ExplanationSection: FunctionComponent<{ label: string, children: ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-2">
    <span className="font-content-caption text-content-caption uppercase tracking-[var(--fds-tracking-relaxed)] text-default-secondary">
      {label}
    </span>
    {children}
  </div>
);

export const ExplanationProse: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <p className="font-content-compact text-content-compact text-default-secondary">{children}</p>
);

export interface CalcRow {
  /** Names what the expression is, or is absent on a continuation of the row above. */
  label?: ReactNode,
  expression: ReactNode,
  /** Opens a gap above the row, where a derivation moves from its inputs to its result. */
  break?: boolean,
}

/**
 * The arithmetic, laid out as the reader would write it by hand.
 *
 * The two columns are a grid rather than padded text: a formula must not reflow, and spaces in a
 * `pre` align only until a translation changes a label's length. Monospaced and horizontally
 * scrollable on its own, so a long product never widens the dialog.
 */
export const ExplanationCalc: FunctionComponent<{ rows: Array<CalcRow> }> = ({ rows }) => (
  <div className="shrink-0 overflow-x-auto rounded-sm border border-[var(--fds-border-elevation-subtle)] bg-[var(--fds-bg-elevation-default-layer-0)] p-4">
    <div className="grid w-max grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-content-code text-content-code tabular-nums">
      {rows.map((row, index) => (
        <Fragment key={index}>
          <span className={cn('text-default-secondary', row.break === true && 'mt-3')}>{row.label}</span>
          <span className={cn(row.break === true && 'mt-3')}>{row.expression}</span>
        </Fragment>
      ))}
    </div>
  </div>
);

/** A term of a formula, coloured as what it came from rather than as what it is worth. */
export const CalcSource: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <span className="text-[color:var(--fds-color-feedback-info-tertiary)]">{children}</span>
);

export const CalcOperator: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <span className="text-default-secondary">{children}</span>
);

export const CalcResult: FunctionComponent<ExplanationTone & { children: ReactNode }> = ({ children, ...tone }) => {
  const family = familyOf(tone);
  return <span className="font-semibold" style={family === null ? undefined : { color: feedbackFigureColor(family) }}>{children}</span>;
};

export interface ExplanationTerm {
  label: ReactNode,
  /** Where the value came from. Name the setting or the feed, never the table. */
  source?: ReactNode,
  value: ReactNode,
  /** Separates the inputs of a derivation from the steps that combine them. */
  step?: boolean,
  /** The line the derivation was for, which closes it. */
  total?: boolean,
}

export const ExplanationTerms: FunctionComponent<{ terms: Array<ExplanationTerm> }> = ({ terms }) => (
  <table className="w-full border-collapse font-content-compact text-content-compact">
    <tbody>
      {terms.map((term, index) => (
        <tr key={index}>
          <td
            className={cn(
              'py-[6px] pr-3 align-top',
              term.step === true && 'border-t border-dashed border-[var(--fds-border-elevation-subtle)]',
              term.total === true && 'border-t border-[var(--fds-border-elevation-subtle)] font-bold',
            )}
          >
            {term.label}
            {term.source !== undefined && (
              <span className="block text-default-secondary">{term.source}</span>
            )}
          </td>
          <td
            className={cn(
              'py-[6px] pl-3 text-right align-top tabular-nums font-medium whitespace-nowrap',
              term.step === true && 'border-t border-dashed border-[var(--fds-border-elevation-subtle)]',
              term.total === true && 'border-t border-[var(--fds-border-elevation-subtle)] font-bold',
            )}
          >
            {term.value}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

/**
 * A term that is itself computed, opened up where it stands.
 *
 * Set apart from the factor's own arithmetic on purpose: a reader following the top formula should
 * be able to skip the whole block and still have read a complete explanation.
 */
export const ExplanationDerivation: FunctionComponent<{ label: string, children: ReactNode }> = ({ label, children }) => (
  <div className="flex shrink-0 flex-col gap-2 rounded-sm border border-[var(--fds-border-elevation-subtle)] bg-[var(--fds-bg-elevation-default-layer-2)] p-4">
    <span className="font-content-compact-bold text-content-compact-bold">{label}</span>
    {children}
  </div>
);

/** What the figure does not say, which a reader is owed before they act on it. */
export const ExplanationCaveat: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <p className="rounded-sm border-l-[3px] border-[color:var(--fds-color-feedback-alert-primary)] bg-[var(--fds-bg-elevation-default-layer-2)] p-3 font-content-compact text-content-compact">
    {children}
  </p>
);

/**
 * `value` is on the engine's 0 to 1 scale, never a figure out of 100. `figure` overrides the
 * rounded one for a reading published truncated, so the bar agrees with the figure beside it.
 */
export const FactorBar: FunctionComponent<{ label: string, value: number, figure?: number, note?: ReactNode }> = ({ label, value, figure: published, note }) => {
  const figure = published ?? toFigure(value);
  const band = resolveSeverityBand(figure);
  return (
    <div>
      <div className="mb-1 flex justify-between gap-3 font-content-compact text-content-compact">
        <span className="font-semibold">{label}</span>
        <span className="tabular-nums text-default-secondary">
          {formatFactor(value, i18n.locale || 'en')} → {figure} / 100
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--fds-bg-elevation-default-layer-3)]">
        <div
          className="h-full rounded-full"
          style={{ width: `${figure}%`, backgroundColor: severityBandFillColor(band) }}
        />
      </div>
      {note !== undefined && (
        <div className="mt-1 font-content-caption text-content-caption text-default-secondary">{note}</div>
      )}
    </div>
  );
};

export const BandRow: FunctionComponent<{ band: SeverityBand, current: boolean, reading: string }> = ({ band, current, reading }) => (
  <div
    className="flex items-start gap-3 rounded-sm border border-transparent p-2 font-content-compact text-content-compact"
    style={current ? { borderColor: severityBandFillColor(band) } : undefined}
  >
    <span
      className="mt-[6px] h-[9px] w-[9px] shrink-0 rounded-full"
      style={{ backgroundColor: severityBandFillColor(band) }}
    />
    <span className="flex min-w-0 flex-col">
      <span className="flex items-baseline gap-3">
        <span className="min-w-[4.5rem] tabular-nums text-default-secondary">{severityBandRange(band)}</span>
        <span className="font-semibold">{severityBandLabel(band)}</span>
        {current && (
          <span className="font-content-caption text-content-caption uppercase tracking-[var(--fds-tracking-relaxed)] text-default-secondary">
            <Trans>current</Trans>
          </span>
        )}
      </span>
      <span className="font-content-caption text-content-caption text-default-secondary">{reading}</span>
    </span>
  </div>
);
