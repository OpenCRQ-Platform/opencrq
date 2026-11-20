import { describe, expect, it } from 'vitest';
import { resolveScopePosture, resolveScopePostures } from './scope-posture';

const TENANT = { strengthRung: 'L2', coverageBucket: 'L2' } as const;

describe('resolveScopePosture', () => {
  it('follows the tenant on both dimensions when the scope declares nothing', () => {
    expect(resolveScopePosture(TENANT, undefined)).toEqual({
      strengthRung: 'L2',
      coverageBucket: 'L2',
      strengthSource: 'tenant',
      coverageSource: 'tenant',
    });
  });

  it('reads a control no one declared anywhere as absent', () => {
    expect(resolveScopePosture(undefined, undefined)).toEqual({
      strengthRung: 'L0',
      coverageBucket: 'L0',
      strengthSource: 'tenant',
      coverageSource: 'tenant',
    });
  });

  it('takes the scope on the declared dimension and the tenant on the other', () => {
    expect(resolveScopePosture(TENANT, { strengthRung: null, coverageBucket: 'L0' })).toEqual({
      strengthRung: 'L2',
      coverageBucket: 'L0',
      strengthSource: 'tenant',
      coverageSource: 'scope',
    });
  });

  it('reads a dimension forced to the value the tenant already holds as the scope’s own', () => {
    expect(resolveScopePosture(TENANT, { strengthRung: 'L2', coverageBucket: null })).toMatchObject({
      strengthRung: 'L2',
      strengthSource: 'scope',
      coverageSource: 'tenant',
    });
  });

  it('carries an inherited dimension when the tenant declaration moves', () => {
    const override = { strengthRung: null, coverageBucket: 'L0' } as const;
    expect(resolveScopePosture({ strengthRung: 'L3', coverageBucket: 'L3' }, override)).toMatchObject({
      strengthRung: 'L3',
      coverageBucket: 'L0',
    });
  });

  it('leaves an overridden dimension where the scope put it when the tenant declaration moves', () => {
    const override = { strengthRung: 'L1', coverageBucket: null } as const;
    expect(resolveScopePosture({ strengthRung: 'L3', coverageBucket: 'L3' }, override)).toMatchObject({
      strengthRung: 'L1',
      strengthSource: 'scope',
      coverageBucket: 'L3',
      coverageSource: 'tenant',
    });
  });

  it('follows the tenant again once the declaration is gone', () => {
    expect(resolveScopePosture(TENANT, { strengthRung: null, coverageBucket: null })).toEqual({
      strengthRung: 'L2',
      coverageBucket: 'L2',
      strengthSource: 'tenant',
      coverageSource: 'tenant',
    });
  });
});

describe('resolveScopePostures', () => {
  it('answers one entry per control, in the order it was given them', () => {
    const resolved = resolveScopePostures(
      ['c3', 'c1', 'c2'],
      new Map([['c1', TENANT]]),
      new Map([['c2', { strengthRung: 'L3', coverageBucket: null }]]),
    );
    expect(resolved.map((entry) => entry.capabilityId)).toEqual(['c3', 'c1', 'c2']);
    expect(resolved[0]).toMatchObject({ strengthRung: 'L0', coverageBucket: 'L0' });
    expect(resolved[1]).toMatchObject({ strengthRung: 'L2', strengthSource: 'tenant' });
    expect(resolved[2]).toMatchObject({ strengthRung: 'L3', strengthSource: 'scope', coverageBucket: 'L0' });
  });
});
