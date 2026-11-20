import { describe, expect, it } from 'vitest';
import type { TestedResult } from './tested-efficacy';
import { coverageCoefficient, STRENGTH_BY_RUNG } from './constants';
import { lowestTestedEfficacy, testedCoverage, testedEfficacy, testedRebooks } from './tested-efficacy';

/** L2 strength and L2 coverage on the engine's scale, about 50.3 %. */
const DECLARED = STRENGTH_BY_RUNG.L2 * coverageCoefficient('L2');

const tested = (held: number, hostsTested: number, scopeHosts: number): TestedResult =>
  ({ rate: held / hostsTested, hostsTested, scopeHosts });

describe('testedEfficacy', () => {
  it('declares about 50 % at L2 / L2', () => {
    expect(DECLARED).toBeCloseTo(0.503, 3);
  });

  describe('the worked example: 20 hosts, 2 of them lab VMs', () => {
    it.each([
      { technique: 'T1055 prevention, 1 held of 10', result: tested(1, 10, 20), coverage: 0.5, efficacy: 0.30 },
      { technique: 'T1055 detection, 10 held of 10', result: tested(10, 10, 20), coverage: 0.5, efficacy: 0.50 },
      { technique: 'T1059 prevention, 15 held of 15', result: tested(15, 15, 20), coverage: 0.75, efficacy: 0.50 },
      { technique: 'T1021 prevention, 0 held of 1', result: tested(0, 1, 20), coverage: 0.05, efficacy: 0.48 },
      { technique: 'T1003 prevention, 0 held of the 2 lab VMs', result: tested(0, 2, 20), coverage: 0.1, efficacy: 0.45 },
    ])('reads $efficacy on $technique', ({ result, coverage, efficacy }) => {
      expect(testedCoverage(result)).toBeCloseTo(coverage, 12);
      expect(testedEfficacy(DECLARED, result)).toBeCloseTo(efficacy, 2);
    });

    it('reads the declaration exactly where every tested host held', () => {
      expect(testedEfficacy(DECLARED, tested(10, 10, 20))).toBe(DECLARED);
      expect(testedEfficacy(DECLARED, tested(15, 15, 20))).toBe(DECLARED);
    });

    it('reads the declaration exactly on an untested technique', () => {
      expect(testedEfficacy(DECLARED, undefined)).toBe(DECLARED);
    });
  });

  it('reads 50.1 % on 2,000 hosts with 10 tested and none held', () => {
    expect(testedEfficacy(DECLARED, tested(0, 10, 2000))).toBeCloseTo(0.501, 3);
  });

  it('never lifts the declaration, however many hosts held', () => {
    expect(testedEfficacy(DECLARED, tested(20, 20, 20))).toBe(DECLARED);
  });

  it('reads the rate on a fully tested scope below the declaration', () => {
    expect(testedEfficacy(DECLARED, tested(3, 20, 20))).toBeCloseTo(0.15, 12);
  });

  it('reads the declaration when the scope holds no host', () => {
    expect(testedEfficacy(DECLARED, { rate: 0, hostsTested: 1, scopeHosts: 0 })).toBe(DECLARED);
  });

  it('keeps a control declared absent at zero, whatever it held', () => {
    expect(testedEfficacy(0, tested(10, 10, 10))).toBe(0);
  });

  it('lands a declaration move in full at or below the rate, and for 1 - alpha of its size above it', () => {
    const step = STRENGTH_BY_RUNG.L3 * coverageCoefficient('L2') - DECLARED;
    const moved = (result: TestedResult): number => testedEfficacy(DECLARED + step, result) - testedEfficacy(DECLARED, result);
    expect(moved(tested(15, 15, 20))).toBeCloseTo(step, 12);
    expect(moved(tested(1, 10, 20))).toBeCloseTo(0.5 * step, 12);
  });
});

describe('testedRebooks', () => {
  it('books again a technique whose efficacy moved by 5 points', () => {
    expect(testedRebooks(DECLARED, undefined, tested(1, 10, 20))).toBe(true);
    expect(testedRebooks(DECLARED, tested(1, 10, 20), undefined)).toBe(true);
  });

  it('keeps the booking of a technique that moved less', () => {
    expect(testedRebooks(DECLARED, tested(1, 10, 20), tested(1, 11, 20))).toBe(false);
    expect(testedRebooks(DECLARED, undefined, tested(0, 10, 2000))).toBe(false);
    expect(testedRebooks(DECLARED, undefined, tested(15, 15, 20))).toBe(false);
  });
});

describe('lowestTestedEfficacy', () => {
  it('reads the weakest result, a failure on one technique pulling the whole reading down', () => {
    const held = tested(10, 10, 20);
    const failed = tested(0, 10, 20);
    expect(lowestTestedEfficacy(DECLARED, [held, failed])).toBe(testedEfficacy(DECLARED, failed));
    expect(lowestTestedEfficacy(DECLARED, [failed, held])).toBe(testedEfficacy(DECLARED, failed));
  });

  it('reads the declaration with no result', () => {
    expect(lowestTestedEfficacy(DECLARED, [])).toBe(DECLARED);
  });
});
