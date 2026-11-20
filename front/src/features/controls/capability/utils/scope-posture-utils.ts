import { DEFAULT_COVERAGE_BUCKET, DEFAULT_STRENGTH_RUNG } from '@app/module/client';
import type { AssessmentAxis, CoverageBucket, StrengthRung } from '@app/module/client';
import type { Capability, CapabilityAssessment, ListedCapability, PostureSources, ResolvedPosture } from '../types/capability';

const TENANT_SOURCES: PostureSources = { strengthSource: 'tenant', coverageSource: 'tenant' };

const UNDECLARED_ASSESSMENT: CapabilityAssessment = {
  strengthRung: DEFAULT_STRENGTH_RUNG,
  coverageBucket: DEFAULT_COVERAGE_BUCKET,
  strengthMode: 'manual',
  coverageMode: 'manual',
  coverageBasis: 'declared',
  comment: null,
};

export const isScopeDeclared = (sources: PostureSources): boolean =>
  sources.strengthSource === 'scope' || sources.coverageSource === 'scope';

const laterDate = (a: string | Date | null, b: string | Date | null): string | Date | null => {
  if (a === null || b === null) {
    return a ?? b;
  }
  return new Date(b).getTime() > new Date(a).getTime() ? b : a;
};

const scopedAssessment = (assessment: CapabilityAssessment | null, entry: ResolvedPosture): CapabilityAssessment => ({
  ...(assessment ?? UNDECLARED_ASSESSMENT),
  strengthRung: entry.strengthRung,
  coverageBucket: entry.coverageBucket,
});

/** `resolved` undefined is the reading outside any scope. A row the scope declared nothing on keeps the tenant's assessment, "not assessed" included. */
export const overlayScopeAssessment = <T extends { id: string, assessment: CapabilityAssessment | null }>(
  rows: ReadonlyArray<T>,
  resolved: ReadonlyArray<ResolvedPosture> | undefined,
): Array<T> => {
  const byCapability = new Map((resolved ?? []).map((entry) => [entry.capabilityId, entry]));
  return rows.map((row) => {
    const entry = byCapability.get(row.id);
    return entry === undefined || !isScopeDeclared(entry) ? row : { ...row, assessment: scopedAssessment(row.assessment, entry) };
  });
};

/**
 * `resolved` undefined is the reading outside any scope. A row the scope declared nothing on keeps the
 * tenant's own state, "not assessed" included; a declared row is dated by the later of the tenant's last
 * line and the scope's declaration.
 */
export const overlayScopePosture = (
  capabilities: Array<Capability>,
  resolved: Array<ResolvedPosture> | undefined,
): Array<ListedCapability> => {
  const byCapability = new Map((resolved ?? []).map((entry) => [entry.capabilityId, entry]));
  return capabilities.map((capability) => {
    const entry = byCapability.get(capability.id);
    if (entry === undefined || !isScopeDeclared(entry)) {
      return { ...capability, ...TENANT_SOURCES };
    }
    return {
      ...capability,
      assessment: scopedAssessment(capability.assessment, entry),
      lastAssessedAt: laterDate(capability.lastAssessedAt, entry.scopeDeclaredAt),
      strengthSource: entry.strengthSource,
      coverageSource: entry.coverageSource,
    };
  });
};

/** A null axis follows the tenant. */
export interface ScopeDeclaration {
  strengthRung: StrengthRung | null,
  coverageBucket: CoverageBucket | null,
}

export const scopeDeclarationOf = (posture: ResolvedPosture): ScopeDeclaration => ({
  strengthRung: posture.strengthSource === 'scope' ? posture.strengthRung : null,
  coverageBucket: posture.coverageSource === 'scope' ? posture.coverageBucket : null,
});

/** What an inherited axis reads: the tenant's value, or the undeclared default when it never declared one. */
export const inheritedPostureOf = (
  posture: ResolvedPosture,
): { strengthRung: StrengthRung, coverageBucket: CoverageBucket } => ({
  strengthRung: posture.tenantStrengthRung ?? DEFAULT_STRENGTH_RUNG,
  coverageBucket: posture.tenantCoverageBucket ?? DEFAULT_COVERAGE_BUCKET,
});

export type PostureDimension = AssessmentAxis;

export type ScopeSave =
  | { kind: 'none' }
  | { kind: 'declare', declaration: ScopeDeclaration }
  | { kind: 'clear', dimensions: Array<PostureDimension> };

/**
 * A declaration is sent whole, a null axis stored as inherited. The endpoint refuses a declaration of
 * neither axis, so returning every declared axis to the tenant clears each one instead, one after the
 * other: the second clear reads the row the first one left.
 */
export const planScopeSave = (initial: ScopeDeclaration, next: ScopeDeclaration): ScopeSave => {
  if (initial.strengthRung === next.strengthRung && initial.coverageBucket === next.coverageBucket) {
    return { kind: 'none' };
  }
  if (next.strengthRung !== null || next.coverageBucket !== null) {
    return { kind: 'declare', declaration: next };
  }
  const dimensions: Array<PostureDimension> = [];
  if (initial.strengthRung !== null) {
    dimensions.push('strength');
  }
  if (initial.coverageBucket !== null) {
    dimensions.push('coverage');
  }
  return { kind: 'clear', dimensions };
};

/** The engine lets such a control contest no technique. */
export const isNotDeployedOnScope = (posture: { strengthRung: StrengthRung, coverageBucket: CoverageBucket }): boolean =>
  posture.strengthRung === 'L0' || posture.coverageBucket === 'L0';
