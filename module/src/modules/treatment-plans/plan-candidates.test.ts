import { describe, expect, it } from 'vitest';
import type { CrqControlWhatIfDimension } from '../crq-indicators/schema';
import type { PlanCandidateCapability, PlanCandidatePosture, PlanLeverRow } from './plan-candidates';
import { buildPlanCandidates } from './plan-candidates';

const capability = (id: string): PlanCandidateCapability =>
  ({ id, externalId: `EXT-${id}`, name: `Control ${id}` });

const declared = (...ids: Array<string>): Map<string, PlanCandidatePosture> =>
  new Map(ids.map((id) => [id, { strengthRung: 'L1', coverageBucket: 'L1' }]));

const lever = (
  controlId: string,
  dimension: CrqControlWhatIfDimension,
  aleReduction: number | null,
): PlanLeverRow => ({ controlId, dimension, aleReduction });

describe('buildPlanCandidates', () => {
  it('should price each lever of a control on its own, summed over the scope', () => {
    const candidates = buildPlanCandidates(
      [capability('a')],
      [],
      [lever('a', 'strength', 300), lever('a', 'strength', 200), lever('a', 'coverage', 900)],
      declared('a'),
    );

    expect(candidates[0]).toMatchObject({
      strengthAleReduction: 500,
      coverageAleReduction: 900,
      deployAleReduction: null,
    });
  });

  it('should rank by the best single step a control offers, whichever lever carries it', () => {
    const candidates = buildPlanCandidates(
      [capability('a'), capability('b'), capability('c')],
      [],
      [lever('a', 'strength', 300), lever('b', 'coverage', 900)],
      declared('a', 'b', 'c'),
    );

    expect(candidates.map((candidate) => candidate.capabilityId)).toEqual(['b', 'a', 'c']);
  });

  it('should keep a lever the runs never priced apart from one priced at zero', () => {
    const candidates = buildPlanCandidates([capability('a')], [], [lever('a', 'strength', 0)], declared('a'));

    expect(candidates[0]).toMatchObject({ strengthAleReduction: 0, coverageAleReduction: null });
  });

  it('should carry the anchor step of a control deployed nowhere, which no axis of its own answers for', () => {
    const candidates = buildPlanCandidates([capability('a')], [], [lever('a', 'deploy', 456)], new Map());

    expect(candidates[0]).toMatchObject({
      strengthAleReduction: null,
      coverageAleReduction: null,
      deployAleReduction: 456,
    });
  });

  it('should ignore a lever the run left unpriced', () => {
    const candidates = buildPlanCandidates([capability('a')], [], [lever('a', 'strength', null)], declared('a'));

    expect(candidates[0]).toMatchObject({ strengthAleReduction: null });
  });

  it('should carry the plan membership and the target already on file', () => {
    const candidates = buildPlanCandidates(
      [capability('a')],
      [{ capabilityId: 'a', targetStrengthRung: 'L2', targetCoverageBucket: null }],
      [],
      declared('a'),
    );

    expect(candidates[0]).toMatchObject({
      inPlan: true,
      targetStrengthRung: 'L2',
      targetCoverageBucket: null,
    });
  });

  it('should report the posture the scope resolves, not the one the tenant declares', () => {
    const candidates = buildPlanCandidates(
      [capability('a')],
      [],
      [],
      new Map([['a', { strengthRung: 'L3', coverageBucket: 'L2' }]]),
    );

    expect(candidates[0]).toMatchObject({
      currentStrengthRung: 'L3',
      currentCoverageBucket: 'L2',
    });
  });

  it('should read an undeclared control as deployed nowhere', () => {
    const candidates = buildPlanCandidates([capability('a')], [], [], new Map());

    expect(candidates[0]).toMatchObject({
      currentStrengthRung: 'L0',
      currentCoverageBucket: 'L0',
    });
  });

  it('should choose the best lever between strength and coverage', () => {
    const candidates = buildPlanCandidates(
      [capability('a'), capability('b')],
      [],
      [lever('a', 'strength', 800), lever('a', 'coverage', 100), lever('b', 'coverage', 900)],
      declared('a', 'b'),
    );

    expect(candidates.map((candidate) => candidate.capabilityId)).toEqual(['b', 'a']);
  });
});
