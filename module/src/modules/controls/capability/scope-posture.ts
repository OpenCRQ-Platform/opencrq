import type { AssessmentAxis, CoverageBucket, StrengthRung } from './constants';
import type { PostureCrossing } from './service';

export type PostureSource = 'tenant' | 'scope';

export interface TenantPostureInput {
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
}

/** A null dimension declares nothing and follows the tenant. */
export interface ScopePostureOverrideInput {
  strengthRung: StrengthRung | null,
  coverageBucket: CoverageBucket | null,
}

export interface ResolvedPosture {
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
  strengthSource: PostureSource,
  coverageSource: PostureSource,
}

export interface ResolvedCapabilityPosture extends ResolvedPosture {
  capabilityId: string,
}

/** Declared nowhere is declared absent. */
export const DEFAULT_STRENGTH_RUNG: StrengthRung = 'L0';
export const DEFAULT_COVERAGE_BUCKET: CoverageBucket = 'L0';

/**
 * Single resolution point for a scoped posture, the attack run engine included, so the figure a page
 * shows and the figure priced beside it can never be two different rules.
 *
 * A dimension reads as the scope's because a declaration exists for it, never because it differs
 * from the tenant's: by difference, a connector sync landing the tenant on the declared value would
 * make the override invisible, and moving away again would carry the scope with it although the
 * scope had said the opposite.
 */
export const resolveScopePosture = (
  tenant: TenantPostureInput | undefined,
  override: ScopePostureOverrideInput | undefined,
): ResolvedPosture => ({
  strengthRung: override?.strengthRung ?? tenant?.strengthRung ?? DEFAULT_STRENGTH_RUNG,
  coverageBucket: override?.coverageBucket ?? tenant?.coverageBucket ?? DEFAULT_COVERAGE_BUCKET,
  strengthSource: override?.strengthRung != null ? 'scope' : 'tenant',
  coverageSource: override?.coverageBucket != null ? 'scope' : 'tenant',
});

/**
 * Whether a posture crossing reprices one risk scope: the scopes it names, else every scope whose own
 * declaration leaves one of the moved axes to the tenant. `pinned` says which axes the scope declares.
 */
export const crossingRepricesScope = (
  crossing: PostureCrossing,
  organizationId: string,
  pinned: (axis: AssessmentAxis) => boolean,
): boolean => (crossing.organizationIds === undefined
  ? crossing.axes.some((axis) => !pinned(axis))
  : crossing.organizationIds.includes(organizationId));

export const scopePinsAxis = (posture: ResolvedPosture, axis: AssessmentAxis): boolean => {
  switch (axis) {
    case 'strength':
      return posture.strengthSource === 'scope';
    case 'coverage':
      return posture.coverageSource === 'scope';
  }
};

/**
 * One entry per id, **in the order given**: the engine run canonicalises its controls by control
 * id before pricing, and a resolution that reordered them would move the figures.
 */
export const resolveScopePostures = (
  capabilityIds: ReadonlyArray<string>,
  tenantAssessments: ReadonlyMap<string, TenantPostureInput>,
  scopeOverrides: ReadonlyMap<string, ScopePostureOverrideInput>,
): Array<ResolvedCapabilityPosture> =>
  capabilityIds.map((capabilityId) => ({
    capabilityId,
    ...resolveScopePosture(tenantAssessments.get(capabilityId), scopeOverrides.get(capabilityId)),
  }));
