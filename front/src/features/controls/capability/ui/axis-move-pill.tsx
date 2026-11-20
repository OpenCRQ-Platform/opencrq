import type { FunctionComponent, ReactNode } from 'react';
import { t } from '@lingui/core/macro';
import { Pencil, Sparkles } from 'lucide-react';
import type { AssessmentAxis, AssessmentMode } from '@app/module/client';
import type { AxisLevel, AxisMove } from '../utils/capability-event-utils';
import { coverageLabel } from './coverage-label';
import { strengthLabel } from './strength-label';

const axisName = (axis: AssessmentAxis): string => {
  switch (axis) {
    case 'strength':
      return t`Strength`;
    case 'coverage':
      return t`Coverage`;
  }
};

const levelLabel = (axis: AssessmentAxis, level: AxisLevel): string => {
  switch (axis) {
    case 'strength':
      return strengthLabel(level);
    case 'coverage':
      return coverageLabel(level);
  }
};

const modeName = (mode: AssessmentMode): string => (mode === 'auto' ? t`Auto` : t`Manual`);

const ModeIcon = ({ mode }: { mode: AssessmentMode }): ReactNode => (mode === 'auto'
  ? <Sparkles className="size-3.5" aria-hidden />
  : <Pencil className="size-3.5" aria-hidden />);

interface AxisMovePillProps {
  move: AxisMove,
  /** A scope line, whose null side is the tenant's value. */
  inScope: boolean,
}

/**
 * One axis's move. Before the move a null reads as not assessed; after it, as derived when the move
 * switched the axis to auto, the derivation leaving it blank.
 */
export const AxisMovePill: FunctionComponent<AxisMovePillProps> = ({ move, inScope }) => {
  const { axis, hasBefore, from, to, toMode } = move;
  const inherited = t`Inherited from the tenant`;
  const fromText = from === null ? (inScope ? inherited : t`Not assessed`) : levelLabel(axis, from);
  const derived = t({ context: 'assessment value', message: 'derived' });
  const toText = to === null ? (inScope ? inherited : (toMode === 'auto' ? derived : t`Not assessed`)) : levelLabel(axis, to);
  const fromMode: AssessmentMode | null = toMode === null || !hasBefore ? null : (toMode === 'auto' ? 'manual' : 'auto');
  const toModeName = toMode === null ? '' : modeName(toMode);
  const fromModeName = fromMode === null ? '' : modeName(fromMode);
  const modeLabel = fromMode === null ? toModeName : t`${fromModeName} → ${toModeName}`;
  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded border border-border bg-muted/40 px-2.5 py-1 txt-sub-content">
      <span className="text-muted-foreground">{axisName(axis)}</span>
      {hasBefore && from !== to && (
        <>
          <span className="text-muted-foreground">{fromText}</span>
          <span className="text-muted-foreground" aria-hidden>→</span>
        </>
      )}
      <span className="font-semibold">{toText}</span>
      {hasBefore && from === to && <span className="text-muted-foreground">{t`unchanged`}</span>}
      {toMode !== null && (
        <span className="inline-flex items-center gap-1 border-l border-border pl-2 text-primary" role="img" aria-label={modeLabel} title={modeLabel}>
          {fromMode !== null && (
            <>
              <ModeIcon mode={fromMode} />
              <span aria-hidden>→</span>
            </>
          )}
          <ModeIcon mode={toMode} />
        </span>
      )}
    </span>
  );
};
