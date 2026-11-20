import { CONTROL_DOMAINS } from '@app/module/client';
import type { AssessmentMode, ControlDomain, CoverageBucket, StrengthRung } from '@app/module/client';

interface AssessableCapability {
  domain: ControlDomain,
  position: number,
  assessment: { strengthMode: AssessmentMode, coverageMode: AssessmentMode } | null,
}

/** Any assessment row counts, a declared level 0 included: the backend's rule for the step. */
export const isAssessed = (capability: AssessableCapability): boolean => capability.assessment !== null;

export const countAssessed = (capabilities: ReadonlyArray<AssessableCapability>): number => capabilities.filter(isAssessed).length;

/** A capability with at least one axis declared by hand; an axis a connector or a published framework derives does not count. */
export const countAssessedByHand = (capabilities: ReadonlyArray<AssessableCapability>): number =>
  capabilities.filter(({ assessment }) => assessment !== null && (assessment.strengthMode === 'manual' || assessment.coverageMode === 'manual')).length;

export interface CapabilityDomainGroup<T extends AssessableCapability> {
  domain: ControlDomain,
  capabilities: Array<T>,
  assessed: number,
}

/** The domains in the catalogue's order, each with its capabilities in the catalogue's order; a domain with none is left out. */
export const groupCapabilitiesByDomain = <T extends AssessableCapability>(capabilities: ReadonlyArray<T>): Array<CapabilityDomainGroup<T>> =>
  CONTROL_DOMAINS.flatMap((domain) => {
    const inDomain = capabilities.filter((capability) => capability.domain === domain).toSorted((a, b) => a.position - b.position);
    return inDomain.length === 0 ? [] : [{ domain, capabilities: inDomain, assessed: countAssessed(inDomain) }];
  });

export interface AxisLevels {
  strengthRung: StrengthRung | null,
  coverageBucket: CoverageBucket | null,
}

export type AxisPick = { axis: 'strength', rung: StrengthRung } | { axis: 'coverage', bucket: CoverageBucket };

export type RowPlan =
  | { kind: 'draft', draft: AxisLevels }
  | { kind: 'save', declaration: AxisLevels };

/**
 * A first declaration needs both axes (the backend refuses one), so the first pick on an unassessed
 * capability waits as a draft for the other; once the capability holds an assessment a pick is
 * saved alone and the other axis is left as it stands.
 */
export const planRowPick = (assessed: boolean, draft: AxisLevels, pick: AxisPick): RowPlan => {
  if (assessed) {
    return {
      kind: 'save',
      declaration: pick.axis === 'strength'
        ? { strengthRung: pick.rung, coverageBucket: null }
        : { strengthRung: null, coverageBucket: pick.bucket },
    };
  }
  const next: AxisLevels = pick.axis === 'strength'
    ? { ...draft, strengthRung: pick.rung }
    : { ...draft, coverageBucket: pick.bucket };
  return next.strengthRung !== null && next.coverageBucket !== null ? { kind: 'save', declaration: next } : { kind: 'draft', draft: next };
};
