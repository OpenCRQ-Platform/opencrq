import { roundPercentPoints } from '@app/utils/decimals';

export interface RequirementReadinessInput {
  isInScope: boolean,
  isReady: boolean,
}

export interface RequirementReadiness {
  total: number,
  inScope: number,
  readyInScope: number,
  notReadyInScope: number,
  outOfScope: number,
  /** Null when no requirement is in scope: readiness is undefined, not zero. */
  percent: number | null,
}

export interface RequirementReadinessCounts {
  total: number,
  inScope: number,
  readyInScope: number,
}

export const readinessFromCounts = ({ total, inScope, readyInScope }: RequirementReadinessCounts): RequirementReadiness => ({
  total,
  inScope,
  readyInScope,
  notReadyInScope: inScope - readyInScope,
  outOfScope: total - inScope,
  percent: inScope === 0 ? null : roundPercentPoints(readyInScope / inScope, 0),
});

export const computeRequirementReadiness = (rows: Array<RequirementReadinessInput>): RequirementReadiness => {
  const inScopeRows = rows.filter((row) => row.isInScope);
  return readinessFromCounts({
    total: rows.length,
    inScope: inScopeRows.length,
    readyInScope: inScopeRows.filter((row) => row.isReady).length,
  });
};

export interface ControlReadinessInput {
  isReady: boolean,
  archivedAt: Date | string | null,
}

export interface ControlReadiness {
  active: number,
  readyActive: number,
  archived: number,
}

/** Archived controls stay visible but never count toward readiness. */
export const computeControlReadiness = (rows: Array<ControlReadinessInput>): ControlReadiness => {
  const activeRows = rows.filter((row) => row.archivedAt == null);
  return {
    active: activeRows.length,
    readyActive: activeRows.filter((row) => row.isReady).length,
    archived: rows.length - activeRows.length,
  };
};

export const READY_SEVERITY = 'low';
export const NOT_READY_SEVERITY = 'critical';

/** SegmentBar and ChartSwatch take a colour, not a severity, hence the two hexes beside the severities above. */
export const READY_COLOR = '#22C55E';
export const NOT_READY_COLOR = '#F43F5E';
