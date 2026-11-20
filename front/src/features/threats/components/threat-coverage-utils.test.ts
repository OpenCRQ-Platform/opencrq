import { describe, expect, it } from 'vitest';
import type { CoveredTechniqueControlTestReading, TechniqueCoverageReading, TechniqueFunctionCoverage, TechniqueTestOutcome } from '@app/module/client';
import {
  coverageOnFunction,
  otherControlLine,
  presentControlCount,
  segmentOfCoverage,
  shownReadingOf,
  testedAbsentReadingOf,
  testedUncoveredReadingOf,
  threatTechniquesBySegment,
} from './threat-coverage-utils';

type CoveredReading = TechniqueCoverageReading & CoveredTechniqueControlTestReading;

const DECLARED = 0.5;
const L2_L2 = { strengthRung: 'L2', coverageBucket: 'L2', strength: 0.72, coverage: 0.7, phishingStage: null } as const;

const outcome = (heldTests: number, hostsTested: number, scopeHosts = 20): TechniqueTestOutcome =>
  ({ tests: hostsTested, heldTests, rate: heldTests / hostsTested, hostsTested, scopeHosts, share: hostsTested / scopeHosts });

const covered = (
  capabilityExternalId: string,
  tested: TechniqueTestOutcome | null,
  over: Partial<CoveredReading> = {},
): CoveredReading => ({
  covered: true,
  linked: true,
  removedOn: null,
  capabilityId: capabilityExternalId.toLowerCase(),
  capabilityExternalId,
  capabilityName: `${capabilityExternalId} control`,
  capabilityRungs: { strengthRung: 'L2', coverageBucket: 'L2' },
  function: 'prevent',
  mitreTechniqueId: 't1059',
  familyTechniqueId: 't1059',
  declaration: L2_L2,
  declared: DECLARED,
  efficacy: tested === null ? DECLARED : Math.min(DECLARED, (1 - tested.share) * DECLARED + tested.share * tested.rate),
  tested,
  parentEfficacy: null,
  ...over,
});

const uncovered = (capabilityExternalId: string, tested: TechniqueTestOutcome | null, linked = false): TechniqueCoverageReading => ({
  covered: false,
  linked,
  removedOn: null,
  capabilityId: capabilityExternalId.toLowerCase(),
  capabilityExternalId,
  capabilityName: `${capabilityExternalId} control`,
  capabilityRungs: null,
  function: 'prevent',
  mitreTechniqueId: 't1059',
  familyTechniqueId: 't1059',
  tested,
});

const coverageOf = (
  mitreTechniqueId: string,
  best: CoveredReading | null,
  others: Array<TechniqueCoverageReading> = [],
): TechniqueFunctionCoverage => ({ mitreTechniqueId, function: 'prevent', best, others });

describe('coverageOnFunction', () => {
  it('should key one function of the techniques by technique', () => {
    const prevent = coverageOf('t1059', null);
    const detect = { ...coverageOf('t1059', null), function: 'detect' as const };

    expect([...coverageOnFunction([prevent, detect], 'detect').values()]).toEqual([detect]);
    expect(coverageOnFunction(undefined, 'prevent').size).toBe(0);
  });
});

describe('segmentOfCoverage', () => {
  it('should read a technique by its best control\'s verdict', () => {
    expect(segmentOfCoverage(coverageOf('t1059', covered('EDR', outcome(10, 10))))).toBe('confirmed');
    expect(segmentOfCoverage(coverageOf('t1059', covered('EDR', outcome(0, 10))))).toBe('lowered');
    expect(segmentOfCoverage(coverageOf('t1059', covered('EDR', null)))).toBe('untested');
  });

  it('should keep a lowered control beside the best one out of the best one\'s verdict', () => {
    expect(segmentOfCoverage(coverageOf('t1059', covered('EDR', null), [covered('OSH', outcome(0, 10))]))).toBe('untested');
  });

  it('should read a technique only an uncovered control was tested on as tested, not covered, and one nothing tested as none', () => {
    expect(segmentOfCoverage(coverageOf('t1059', null, [uncovered('EDR', outcome(0, 1))]))).toBe('uncovered');
    expect(segmentOfCoverage(coverageOf('t1059', null, [uncovered('EDR', null)]))).toBeNull();
    expect(segmentOfCoverage(undefined)).toBeNull();
  });
});

describe('threatTechniquesBySegment', () => {
  it('should put each technique under one segment at most, and the counts add up to the techniques with a reading', () => {
    const coverages = new Map([
      ['t1', coverageOf('t1', covered('EDR', outcome(10, 10)))],
      ['t2', coverageOf('t2', covered('EDR', outcome(0, 10)))],
      ['t3', coverageOf('t3', covered('EDR', null))],
      ['t4', coverageOf('t4', null, [uncovered('EDR', outcome(0, 1))])],
      ['t5', coverageOf('t5', null)],
    ]);

    const bySegment = threatTechniquesBySegment(['t1', 't2', 't3', 't4', 't5', 't6'], coverages);

    expect(Object.fromEntries(Object.entries(bySegment).map(([segment, ids]) => [segment, [...ids]]))).toEqual({
      confirmed: ['t1'],
      lowered: ['t2'],
      untested: ['t3'],
      uncovered: ['t4'],
    });
  });
});

describe('shownReadingOf', () => {
  const absent = covered('AV', outcome(1, 2), { declaration: { ...L2_L2, coverageBucket: 'L0', coverage: 0 }, declared: 0, efficacy: 0 });
  const unassessed = covered('IDP', outcome(1, 2), { capabilityRungs: null, declaration: null, declared: 0, efficacy: 0 });

  it('should show the best control, and nothing where no control was tested', () => {
    const best = covered('EDR', null);
    expect(shownReadingOf(coverageOf('t1059', best, [uncovered('AV', outcome(0, 1))]))).toBe(best);
    expect(testedUncoveredReadingOf(coverageOf('t1059', best, [uncovered('AV', outcome(0, 1))]))).toBeNull();
    expect(shownReadingOf(coverageOf('t1059', null, [uncovered('EDR', null), covered('OSH', null, { declaration: null })]))).toBeNull();
  });

  it('should show a tested control nothing links to the technique as not covered, ahead of a linked one read as absent', () => {
    const unlinked = uncovered('SEG', outcome(0, 1));

    expect(shownReadingOf(coverageOf('t1059', null, [absent, unlinked]))).toEqual({ ...unlinked, tested: outcome(0, 1) });
    expect(testedAbsentReadingOf(coverageOf('t1059', null, [absent, unlinked]))).toBeNull();
  });

  it('should keep the active link of a control the engine does not read, one on a sub-technique alone', () => {
    const onSubTechniqueAlone = uncovered('EDR', outcome(0, 1), true);

    expect(testedUncoveredReadingOf(coverageOf('t1055-012', null, [onSubTechniqueAlone]))).toMatchObject({ covered: false, linked: true });
    expect(segmentOfCoverage(coverageOf('t1055-012', null, [onSubTechniqueAlone]))).toBe('uncovered');
  });

  it('should show a tested control linked at no coverage as it is read, never as one nothing links', () => {
    const coverage = coverageOf('t1059', null, [uncovered('EDR', null), absent]);

    expect(testedUncoveredReadingOf(coverage)).toBeNull();
    expect(testedAbsentReadingOf(coverage)).toEqual(absent);
    expect(shownReadingOf(coverage)).toMatchObject({ covered: true, capabilityExternalId: 'AV', declaration: { coverage: 0 } });
    expect(otherControlLine(absent).status).toBe('absent');
    expect(segmentOfCoverage(coverage)).toBe('uncovered');
  });

  it('should show a tested control linked but never assessed as it is read', () => {
    const coverage = coverageOf('t1059', null, [unassessed]);

    expect(testedUncoveredReadingOf(coverage)).toBeNull();
    expect(shownReadingOf(coverage)).toMatchObject({ covered: true, capabilityExternalId: 'IDP', declaration: null });
    expect(otherControlLine(unassessed).status).toBe('unassessed');
    expect(segmentOfCoverage(coverage)).toBe('uncovered');
  });
});

describe('otherControlLine', () => {
  it('should read a present control by its efficacy and verdict', () => {
    expect(otherControlLine(covered('OSH', outcome(0, 10)))).toMatchObject({ capabilityExternalId: 'OSH', status: 'lowered', efficacy: 0.25 });
    expect(otherControlLine(covered('OSH', null))).toMatchObject({ status: 'untested', efficacy: DECLARED });
  });

  it('should read a control the engine counts as absent without an efficacy', () => {
    expect(otherControlLine(covered('OSH', null, { declaration: null, declared: 0, efficacy: 0 }))).toMatchObject({ status: 'unassessed', efficacy: null });
    expect(otherControlLine(covered('OSH', null, { declaration: { ...L2_L2, coverage: 0 }, declared: 0, efficacy: 0 })))
      .toMatchObject({ status: 'absent', efficacy: null });
  });

  it('should read a control the engine does not read there by whether it was tested', () => {
    expect(otherControlLine(uncovered('EDR', outcome(0, 1))).status).toBe('testedNotCovered');
    expect(otherControlLine(uncovered('EDR', null)).status).toBe('notCovered');
  });
});

describe('presentControlCount', () => {
  it('should count the best control and the present others only', () => {
    expect(presentControlCount(coverageOf('t1059', covered('EDR', null), [
      covered('OSH', null),
      covered('AV', null, { declaration: null }),
      uncovered('SEG', outcome(0, 1)),
    ]))).toBe(2);
    expect(presentControlCount(coverageOf('t1059', null))).toBe(0);
  });
});
