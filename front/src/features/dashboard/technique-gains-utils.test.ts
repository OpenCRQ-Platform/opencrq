import { describe, expect, it } from 'vitest';
import type { TacticGains, TechniqueGain } from './technique-gains-utils';
import {
  countGainingTechniques,
  exceedsTechniqueCap,
  formatGain,
  gainShade,
  largestGain,
  sortTechniques,
  TECHNIQUES_PER_TACTIC,
} from './technique-gains-utils';

const technique = (externalId: string, prevention: number, detection: number): TechniqueGain => ({
  id: externalId,
  externalId,
  name: externalId,
  prevention,
  detection,
  total: prevention + detection,
});

const tactic = (techniques: Array<TechniqueGain>): TacticGains => ({ id: 'ta', externalId: 'TA0001', name: 'Initial Access', techniques });

describe('sortTechniques', () => {
  it('orders by the chosen reading, largest first', () => {
    const techniques = [technique('T1', 10, 90), technique('T2', 50, 0), technique('T3', 30, 30)];

    expect(sortTechniques(techniques, 'prevention').map((row) => row.externalId)).toEqual(['T2', 'T3', 'T1']);
    expect(sortTechniques(techniques, 'detection').map((row) => row.externalId)).toEqual(['T1', 'T3', 'T2']);
    expect(sortTechniques(techniques, 'total').map((row) => row.externalId)).toEqual(['T1', 'T3', 'T2']);
  });

  it('breaks a tie on the technique id', () => {
    expect(sortTechniques([technique('T9', 5, 0), technique('T1', 5, 0)], 'prevention').map((row) => row.externalId)).toEqual(['T1', 'T9']);
  });
});

describe('exceedsTechniqueCap', () => {
  const techniques = (count: number): Array<TechniqueGain> => Array.from({ length: count }, (_, index) => technique(`T${index}`, 1, 0));

  it('is true once one tactic lists more techniques than a column shows', () => {
    expect(exceedsTechniqueCap([tactic(techniques(2)), tactic(techniques(TECHNIQUES_PER_TACTIC + 1))])).toBe(true);
  });

  it('is false while every tactic fits its column', () => {
    expect(exceedsTechniqueCap([tactic(techniques(TECHNIQUES_PER_TACTIC)), tactic([])])).toBe(false);
  });
});

describe('countGainingTechniques', () => {
  it('counts only the techniques that save something on the reading', () => {
    const techniques = [technique('T1', 10, 0), technique('T2', 0, 0), technique('T3', -1, 4)];

    expect(countGainingTechniques(techniques, 'prevention')).toBe(1);
    expect(countGainingTechniques(techniques, 'detection')).toBe(1);
    expect(countGainingTechniques(techniques, 'total')).toBe(2);
  });
});

describe('largestGain', () => {
  it('reads the largest figure of the reading over every tactic', () => {
    const tactics = [tactic([technique('T1', 10, 90)]), tactic([technique('T2', 50, 0)])];

    expect(largestGain(tactics, 'prevention')).toBe(50);
    expect(largestGain(tactics, 'total')).toBe(100);
  });

  it('is zero when nothing gains', () => {
    expect(largestGain([tactic([technique('T1', 0, 0)])], 'total')).toBe(0);
    expect(largestGain([], 'total')).toBe(0);
  });
});

describe('gainShade', () => {
  it('runs from the faintest shade near zero to the strongest at the largest figure', () => {
    expect(gainShade(100, 100)).toBeCloseTo(0.85);
    expect(gainShade(50, 100)).toBeCloseTo(0.475);
    expect(gainShade(1e-9, 100)).toBeCloseTo(0.1);
  });

  it('leaves a technique that saves nothing unshaded', () => {
    expect(gainShade(0, 100)).toBeNull();
    expect(gainShade(-3, 100)).toBeNull();
  });
});

describe('formatGain', () => {
  it('reads a saving as an unsigned cost and nothing as a dash', () => {
    expect(formatGain(640_000)).toBe('$640K');
    expect(formatGain(0)).toBe('-');
  });
});
