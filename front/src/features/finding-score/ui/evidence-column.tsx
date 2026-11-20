import { Icon, Paper } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { resolveSeverityBand } from '@app/module/client';
import { Coins, Radar, Shield } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import type { ColumnAccent } from './column-vocabulary';
import { cn } from '../../../utils';
import { columnQuestion, columnTitle } from './column-vocabulary';
import { ScoreGaugeMark } from './score-gauge';
import { severityBandFillColor, severityBandLabel, severityBandWash } from './severity-ramp';

/** Threat intelligence wears the OpenCTI product mark: that is where its signals come from. */
const COLUMN_ICON: Record<ColumnAccent, ReactNode> = {
  reachability: <Radar aria-hidden className="h-3.5 w-3.5 shrink-0 text-default-secondary" />,
  threat: <Icon name="custom/opencti" aria-hidden className="h-3.5 w-3.5 shrink-0 text-default-secondary" />,
  controls: <Shield aria-hidden className="h-3.5 w-3.5 shrink-0 text-default-secondary" />,
  potentialImpact: <Coins aria-hidden className="h-3.5 w-3.5 shrink-0 text-default-secondary" />,
};

interface EvidenceRowProps {
  label: ReactNode,
  children: ReactNode,
  /** The row states something this finding cannot carry, so it is drawn dimmed rather than dropped. */
  absent?: boolean,
}

export const EvidenceRow: FunctionComponent<EvidenceRowProps> = ({ label, children, absent }) => (
  <div className={`grid grid-cols-[1fr_auto] items-baseline gap-2 py-[0.15rem] ${absent === true ? 'opacity-50' : ''}`}>
    <span className="txt-sub-content text-muted-foreground">{label}</span>
    <span className="txt-sub-content text-right">{children}</span>
  </div>
);

/** Heads a labelled sub-block of a panel, set apart from the rows above it. */
export const EvidenceGroupDivider: FunctionComponent<{ label: string }> = ({ label }) => (
  <span className="mt-2 mb-1 block border-t border-dashed border-[var(--fds-border-elevation-subtle)] pt-1 font-content-code text-content-caption uppercase tracking-[var(--fds-tracking-relaxed)] text-muted-foreground">
    {label}
  </span>
);

/**
 * A declared level as three cells.
 *
 * A level a run knocked down stays drawn rather than removed: deleting it hides the useful fact,
 * which is that a control was declared here and did not hold.
 */
export const StrengthCells: FunctionComponent<{
  filled: number,
  struckDown?: boolean,
  /** The Controls tab reads the cells as content rather than as a marker beside a row. */
  large?: boolean,
}> = ({ filled, struckDown, large }) => (
  <span className="inline-flex gap-[2px] align-middle">
    {[0, 1, 2].map((index) => (
      <span
        key={index}
        className={cn(
          'block border border-[var(--fds-border-elevation-subtle)]',
          large === true ? 'h-[11px] w-[14px]' : 'h-[7px] w-[9px]',
        )}
        style={index < filled
          ? {
            backgroundColor: struckDown === true
              ? 'var(--fds-border-elevation-subtle)'
              : 'var(--fds-text-default-secondary)',
          }
          : undefined}
      />
    ))}
  </span>
);

/**
 * Which way the panel's figure runs.
 *
 * Most panels publish an exposure, which is the factor as the engine composed it: more is worse.
 * A controls panel publishes the defence left standing, which is its complement, because a
 * reader shown `100` under a shield reads a defence that holds and the engine means the opposite.
 * The band still comes off the exposure either way, so an empty defence is drawn in the red an
 * exposure of a hundred earns.
 */
type ColumnReading = 'exposure' | 'defence';

interface EvidenceColumnProps {
  accent: ColumnAccent,
  /** Sits after the panel's name, for help on the figure the header carries. */
  nameAdornment?: ReactNode,
  /** The factor's weight on its published 0 to 1 scale. */
  value: number,
  reading: ColumnReading,
  children: ReactNode,
}

/**
 * A factor as one tile: its name across the top of the header, its question under it with its
 * reading beside it as the score's own arc at its smallest size, and the evidence it was drawn
 * from under a hairline. The score and the parts above it read at the two larger sizes of the
 * same arc.
 *
 * Colour on a tile carries the severity band and nothing else. It paints the arc, the figure, the
 * ground and the edge, so a row of tiles states its levels before a figure is read. The icon
 * stays neutral: a second colour on the tile would claim to be a level it does not hold.
 */
export const EvidenceColumn: FunctionComponent<EvidenceColumnProps> = ({ accent, nameAdornment, value, reading, children }) => {
  const exposure = Math.round(value * 100);
  const band = resolveSeverityBand(exposure);
  const figure = reading === 'defence' ? 100 - exposure : exposure;
  const name = columnTitle(accent);
  const bandWord = severityBandLabel(band);
  const gaugeLabel = reading === 'defence'
    ? t`${name}: ${figure} out of 100 of defence left standing, ${bandWord} band`
    : t`${name}: ${figure} out of 100 of exposure, ${bandWord} band`;
  return (
    <Paper
      elevation={0}
      className="flex min-w-0 flex-col p-4"
      style={{
        backgroundImage: severityBandWash(band),
        backgroundOrigin: 'border-box',
        borderColor: severityBandFillColor(band),
      }}
    >
      <span className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-[0.05rem]">
        {/* The title is read whole, so a word wider than the tile breaks with a hyphen rather than being truncated. */}
        <span className="col-span-2 flex items-center gap-1.5 hyphens-auto font-content-compact-bold text-content-compact-bold uppercase tracking-[var(--fds-tracking-relaxed)]">
          {COLUMN_ICON[accent]}
          {name}
          {nameAdornment}
        </span>
        <span className="txt-sub-content lowercase text-muted-foreground">{columnQuestion(accent)}</span>
        <ScoreGaugeMark score={figure} band={band} label={gaugeLabel} />
      </span>
      <span aria-hidden className="my-3 block h-px bg-[var(--fds-border-elevation-subtle)]" />
      {children}
    </Paper>
  );
};
