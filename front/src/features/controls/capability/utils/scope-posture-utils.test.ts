import { describe, expect, it } from 'vitest';
import type { Capability, ResolvedPosture, TechniqueCapability } from '../types/capability';
import {
  inheritedPostureOf,
  isNotDeployedOnScope,
  isScopeDeclared,
  overlayScopeAssessment,
  overlayScopePosture,
  planScopeSave,
  scopeDeclarationOf,
} from './scope-posture-utils';

const capability = (overrides: Partial<Capability>): Capability => ({
  id: 'idp',
  externalId: 'IDP',
  name: 'Identity Platform (IdP, SSO, MFA, Conditional Access)',
  description: '',
  domain: 'identities',
  position: 19,
  assessment: { strengthRung: 'L2', coverageBucket: 'L2', strengthMode: 'auto', coverageMode: 'auto', coverageBasis: 'measured', comment: null },
  lastAssessedAt: '2026-09-12T10:00:00.000Z',
  lastAssessedBy: null,
  lastAssessedConnector: 'drata',
  ...overrides,
});

const posture = (overrides: Partial<ResolvedPosture>): ResolvedPosture => ({
  capabilityId: 'idp',
  strengthRung: 'L2',
  coverageBucket: 'L2',
  strengthSource: 'tenant',
  coverageSource: 'tenant',
  comment: null,
  tenantStrengthRung: 'L2',
  tenantCoverageBucket: 'L2',
  scopeDeclaredAt: null,
  ...overrides,
});

describe('overlayScopePosture', () => {
  it('should read every row as the tenant’s outside any scope', () => {
    const [row] = overlayScopePosture([capability({})], undefined);

    expect(row).toMatchObject({ assessment: { strengthRung: 'L2', coverageBucket: 'L2' }, strengthSource: 'tenant', coverageSource: 'tenant' });
  });

  it('should leave a row the scope declared nothing on unmarked, with the tenant’s values', () => {
    const [row] = overlayScopePosture([capability({})], [posture({})]);

    expect(row).toMatchObject({ assessment: { strengthRung: 'L2', coverageBucket: 'L2' }, strengthSource: 'tenant', coverageSource: 'tenant' });
  });

  it('should keep a control nobody declared as not assessed inside a scope', () => {
    const [row] = overlayScopePosture(
      [capability({ assessment: null, lastAssessedAt: null })],
      [posture({ strengthRung: 'L0', coverageBucket: 'L0', tenantStrengthRung: null, tenantCoverageBucket: null })],
    );

    expect(row?.assessment).toBeNull();
  });

  it('should mark the declared coverage and not the inherited strength', () => {
    const [row] = overlayScopePosture(
      [capability({})],
      [posture({ coverageBucket: 'L0', coverageSource: 'scope', scopeDeclaredAt: '2026-09-18T14:22:00.000Z' })],
    );

    expect(row).toMatchObject({
      assessment: { strengthRung: 'L2', coverageBucket: 'L0' },
      strengthSource: 'tenant',
      coverageSource: 'scope',
    });
  });

  it('should date a declared row by the scope when it declared after the tenant', () => {
    const [row] = overlayScopePosture(
      [capability({})],
      [posture({ coverageSource: 'scope', coverageBucket: 'L0', scopeDeclaredAt: '2026-09-18T14:22:00.000Z' })],
    );

    expect(row?.lastAssessedAt).toBe('2026-09-18T14:22:00.000Z');
  });

  it('should date a declared row by the tenant when the tenant moved since', () => {
    const [row] = overlayScopePosture(
      [capability({ lastAssessedAt: '2026-09-20T03:10:00.000Z' })],
      [posture({ coverageSource: 'scope', coverageBucket: 'L0', scopeDeclaredAt: '2026-09-18T14:22:00.000Z' })],
    );

    expect(row?.lastAssessedAt).toBe('2026-09-20T03:10:00.000Z');
  });

  it('should read a declaration on a control the tenant never assessed as assessed', () => {
    const [row] = overlayScopePosture(
      [capability({ assessment: null, lastAssessedAt: null })],
      [posture({ strengthRung: 'L0', coverageBucket: 'L1', coverageSource: 'scope', tenantStrengthRung: null, tenantCoverageBucket: null, scopeDeclaredAt: '2026-09-18T14:22:00.000Z' })],
    );

    expect(row).toMatchObject({ assessment: { strengthRung: 'L0', coverageBucket: 'L1' }, lastAssessedAt: '2026-09-18T14:22:00.000Z' });
  });
});

describe('overlayScopeAssessment', () => {
  const techniqueControl = (overrides: Partial<TechniqueCapability>): TechniqueCapability => ({
    id: 'idp',
    externalId: 'IDP',
    name: 'Identity Platform (IdP, SSO, MFA, Conditional Access)',
    function: 'prevent',
    source: 'catalogue',
    state: 'recommended',
    assessment: { strengthRung: 'L2', coverageBucket: 'L2', strengthMode: 'auto', coverageMode: 'auto', coverageBasis: 'measured', comment: null },
    inheritedFrom: null,
    ...overrides,
  });

  it('should read the scope’s declared strength and coverage over the tenant’s', () => {
    const [row] = overlayScopeAssessment(
      [techniqueControl({})],
      [posture({ strengthRung: 'L3', coverageBucket: 'L1', strengthSource: 'scope', coverageSource: 'scope' })],
    );

    expect(row).toMatchObject({ function: 'prevent', assessment: { strengthRung: 'L3', coverageBucket: 'L1', strengthMode: 'auto' } });
  });

  it('should keep the tenant’s assessment on a control the scope declared nothing on', () => {
    const control = techniqueControl({});

    expect(overlayScopeAssessment([control], [posture({ strengthRung: 'L3' })])).toEqual([control]);
  });

  it('should keep the tenant’s assessment outside any scope', () => {
    const control = techniqueControl({});

    expect(overlayScopeAssessment([control], undefined)).toEqual([control]);
  });
});

describe('scopeDeclarationOf', () => {
  it('should keep only the declared axes', () => {
    expect(scopeDeclarationOf(posture({ coverageBucket: 'L0', coverageSource: 'scope' })))
      .toEqual({ strengthRung: null, coverageBucket: 'L0' });
  });
});

describe('inheritedPostureOf', () => {
  it('should read the tenant pair', () => {
    expect(inheritedPostureOf(posture({ tenantStrengthRung: 'L3', tenantCoverageBucket: 'L3' })))
      .toEqual({ strengthRung: 'L3', coverageBucket: 'L3' });
  });

  it('should fall back on the undeclared default when the tenant never assessed', () => {
    expect(inheritedPostureOf(posture({ tenantStrengthRung: null, tenantCoverageBucket: null })))
      .toEqual({ strengthRung: 'L0', coverageBucket: 'L0' });
  });
});

describe('planScopeSave', () => {
  it('should send nothing when the declaration did not move', () => {
    expect(planScopeSave({ strengthRung: null, coverageBucket: 'L0' }, { strengthRung: null, coverageBucket: 'L0' }))
      .toEqual({ kind: 'none' });
  });

  it('should declare an axis forced to the value the tenant already holds', () => {
    expect(planScopeSave({ strengthRung: null, coverageBucket: null }, { strengthRung: 'L2', coverageBucket: null }))
      .toEqual({ kind: 'declare', declaration: { strengthRung: 'L2', coverageBucket: null } });
  });

  it('should send the whole state, an axis returned to the tenant as null', () => {
    expect(planScopeSave({ strengthRung: 'L0', coverageBucket: 'L0' }, { strengthRung: 'L0', coverageBucket: null }))
      .toEqual({ kind: 'declare', declaration: { strengthRung: 'L0', coverageBucket: null } });
  });

  it('should clear the one declared axis returned to the tenant', () => {
    expect(planScopeSave({ strengthRung: null, coverageBucket: 'L0' }, { strengthRung: null, coverageBucket: null }))
      .toEqual({ kind: 'clear', dimensions: ['coverage'] });
  });

  it('should clear both axes when both return to the tenant', () => {
    expect(planScopeSave({ strengthRung: 'L0', coverageBucket: 'L0' }, { strengthRung: null, coverageBucket: null }))
      .toEqual({ kind: 'clear', dimensions: ['strength', 'coverage'] });
  });
});

describe('isScopeDeclared', () => {
  it('should read a strength or a coverage declared alone as declared', () => {
    expect(isScopeDeclared(posture({ strengthSource: 'scope' }))).toBe(true);
    expect(isScopeDeclared(posture({ coverageSource: 'scope' }))).toBe(true);
  });

  it('should read a posture that follows the tenant on every axis as undeclared', () => {
    expect(isScopeDeclared(posture({}))).toBe(false);
  });
});

describe('isNotDeployedOnScope', () => {
  it('should read a strength at L0 as not deployed', () => {
    expect(isNotDeployedOnScope({ strengthRung: 'L0', coverageBucket: 'L3' })).toBe(true);
  });

  it('should read a coverage at none as not deployed', () => {
    expect(isNotDeployedOnScope({ strengthRung: 'L3', coverageBucket: 'L0' })).toBe(true);
  });

  it('should read any other posture as deployed', () => {
    expect(isNotDeployedOnScope({ strengthRung: 'L1', coverageBucket: 'L1' })).toBe(false);
  });
});
