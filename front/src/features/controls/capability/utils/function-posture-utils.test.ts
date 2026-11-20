import { describe, expect, it } from 'vitest';
import type { CapabilityFunction, EffectiveEdgeState } from '@app/module/client';
import type { CapabilityEdge } from '../types/capability';
import type { ValidationCell } from '../types/validation';
import { creditedExpectations, isSimulationReachable, posturePerFunction } from './function-posture-utils';

const edge = (
  techniqueId: string,
  capabilityFunction: CapabilityFunction,
  state: EffectiveEdgeState = 'recommended',
): CapabilityEdge => ({
  techniqueId,
  techniqueExternalId: techniqueId,
  techniqueName: `Technique ${techniqueId}`,
  function: capabilityFunction,
  source: state === 'added' ? 'tenant' : 'catalogue',
  state,
  tactics: [],
});

const cell = (
  techniqueId: string,
  capabilityFunction: CapabilityFunction,
  met: boolean,
  latestProofAt: string | Date | null = null,
): ValidationCell => ({
  techniqueId,
  techniqueExternalId: techniqueId,
  function: capabilityFunction,
  state: met ? 'validated' : 'contradicted',
  validatedVotes: met ? 1 : 0,
  totalVotes: 1,
  latestProofAt,
});

describe('isSimulationReachable', () => {
  it('reads a control no security platform family implements as untestable, never as untested', () => {
    expect(isSimulationReachable({ securityPlatformFamilies: [] })).toBe(false);
  });

  it('reads a control a family implements as reachable, whatever any tenant has ingested', () => {
    const families = [{ id: 'family-edr', name: 'EDR', platformTypeKey: 'EDR' }];

    expect(isSimulationReachable({ securityPlatformFamilies: families })).toBe(true);
  });
});

describe('creditedExpectations', () => {
  it('counts the techniques the function still covers', () => {
    const edges = [edge('T1059', 'detect'), edge('T1055', 'detect'), edge('T1059', 'prevent')];

    expect(creditedExpectations(edges, 'detect')).toBe(2);
    expect(creditedExpectations(edges, 'prevent')).toBe(1);
  });

  it('drops a technique the tenant removed, which the control no longer credits', () => {
    const edges = [edge('T1059', 'detect'), edge('T1055', 'detect', 'removed')];

    expect(creditedExpectations(edges, 'detect')).toBe(1);
  });

  it('counts a technique the tenant added, which the control now credits', () => {
    const edges = [edge('T1059', 'detect'), edge('T1090', 'detect', 'added')];

    expect(creditedExpectations(edges, 'detect')).toBe(2);
  });
});

describe('posturePerFunction', () => {
  it('reads a function no simulation has reached as untested rather than as failing', () => {
    const edges = [edge('T1059', 'detect'), edge('T1059', 'prevent')];
    const posture = posturePerFunction([cell('T1059', 'detect', true)], edges, 'prevent');

    expect(posture.tested).toBe(0);
    expect(posture.credited).toBe(1);
    expect(posture.coverageRate).toBe(0);
  });

  it('keeps the two functions of one technique apart', () => {
    const edges = [edge('T1059', 'detect'), edge('T1059', 'prevent')];
    const cells = [cell('T1059', 'detect', true), cell('T1059', 'prevent', false)];

    expect(posturePerFunction(cells, edges, 'detect').successRate).toBe(1);
    expect(posturePerFunction(cells, edges, 'prevent').successRate).toBe(0);
  });

  it('leaves a covered but untested technique out of the rate and inside the coverage denominator', () => {
    const edges = [edge('T1059', 'detect'), edge('T1055', 'detect'), edge('T1003', 'detect')];
    const posture = posturePerFunction([cell('T1059', 'detect', true)], edges, 'detect');

    expect(posture.tested).toBe(1);
    expect(posture.successRate).toBe(1);
    expect(posture.credited).toBe(3);
    expect(posture.coverageRate).toBeCloseTo(1 / 3);
  });

  it('measures coverage against what the tenant still credits, never against the raw catalogue', () => {
    const edges = [edge('T1059', 'detect'), edge('T1055', 'detect', 'removed')];
    const posture = posturePerFunction([cell('T1059', 'detect', true)], edges, 'detect');

    expect(posture.credited).toBe(1);
    expect(posture.coverageRate).toBe(1);
  });

  it('dates each function on its own results, which is why the two are never merged', () => {
    const edges = [edge('T1059', 'detect'), edge('T1059', 'prevent')];
    const cells = [
      cell('T1059', 'detect', true, '2026-08-16T00:00:00.000Z'),
      cell('T1059', 'prevent', true, '2026-08-11T00:00:00.000Z'),
    ];

    expect(posturePerFunction(cells, edges, 'detect').latestProofAt)
      .toEqual(new Date('2026-08-16T00:00:00.000Z'));
    expect(posturePerFunction(cells, edges, 'prevent').latestProofAt)
      .toEqual(new Date('2026-08-11T00:00:00.000Z'));
  });
});
