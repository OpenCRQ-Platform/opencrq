import { describe, expect, it } from 'vitest';
import type { CapabilityAssessment } from '../types/capability';
import { STRENGTH_BY_RUNG } from '@app/module/client';
import { computeSoloEffectiveness, effectivenessGrid, effectivenessPoints, isSameEffectiveness } from './capability-effectiveness';

const assessment = (
  strengthRung: CapabilityAssessment['strengthRung'],
  coverageBucket: CapabilityAssessment['coverageBucket'],
): Pick<CapabilityAssessment, 'strengthRung' | 'coverageBucket'> => ({ strengthRung, coverageBucket });

describe('computeSoloEffectiveness', () => {
  it('scores Master + Full at 100% (strong)', () => {
    const result = computeSoloEffectiveness(assessment('L3', 'L3'));
    expect(result.score).toBeCloseTo(1, 10);
    expect(result.band).toBe('strong');
  });

  it('reads an L0 declaration as not deployed, whatever the coverage', () => {
    expect(computeSoloEffectiveness(assessment('L0', 'L3'))).toEqual({ score: 0, band: 'not-deployed' });
    expect(computeSoloEffectiveness(assessment('L0', 'L0'))).toEqual({ score: 0, band: 'not-deployed' });
  });

  it('returns the none baseline when a deployed control declares no coverage', () => {
    const result = computeSoloEffectiveness(assessment('L3', 'L0'));
    expect(result.score).toBe(0);
    expect(result.band).toBe('none');
  });

  it('normalises the strength rung against the L3 ceiling: Intermediate + Full is strong', () => {
    const result = computeSoloEffectiveness(assessment('L2', 'L3'));
    expect(result.score).toBeCloseTo(STRENGTH_BY_RUNG.L2 / STRENGTH_BY_RUNG.L3, 10);
    expect(result.band).toBe('strong');
  });

  it('scales by coverage bucket: Master + Broad = 0.7 (solid)', () => {
    const result = computeSoloEffectiveness(assessment('L3', 'L2'));
    expect(result.score).toBeCloseTo(0.7, 10);
    expect(result.band).toBe('solid');
  });

  it('scales by coverage bucket: Master + Partial = 0.4 (moderate)', () => {
    const result = computeSoloEffectiveness(assessment('L3', 'L1'));
    expect(result.score).toBeCloseTo(0.4, 10);
    expect(result.band).toBe('moderate');
  });

  it('combines both axes: Basic + Partial is marginal', () => {
    const result = computeSoloEffectiveness(assessment('L1', 'L1'));
    expect(result.score).toBeCloseTo((STRENGTH_BY_RUNG.L1 / STRENGTH_BY_RUNG.L3) * 0.4, 10);
    expect(result.band).toBe('marginal');
  });
});

describe('isSameEffectiveness', () => {
  it('tells not deployed from inactive although both score 0', () => {
    expect(isSameEffectiveness(
      computeSoloEffectiveness(assessment('L0', 'L3')),
      computeSoloEffectiveness(assessment('L1', 'L0')),
    )).toBe(false);
  });

  it('treats two L0 declarations as the same effectiveness whatever the coverage', () => {
    expect(isSameEffectiveness(
      computeSoloEffectiveness(assessment('L0', 'L3')),
      computeSoloEffectiveness(assessment('L0', 'L0')),
    )).toBe(true);
  });

  it('tells two scores apart within the same band', () => {
    expect(isSameEffectiveness(
      computeSoloEffectiveness(assessment('L3', 'L2')),
      computeSoloEffectiveness(assessment('L2', 'L3')),
    )).toBe(false);
  });
});

describe('effectivenessPoints', () => {
  it('rounds an exact half up, as the percentage prints it', () => {
    expect(effectivenessPoints(0.145)).toBe(15);
    expect(effectivenessPoints(0.5927)).toBe(59);
  });
});

describe('effectivenessGrid', () => {
  it('lays the rungs top-down from Master and the buckets left to right from none', () => {
    const grid = effectivenessGrid();
    expect(grid.map((row) => row[0].strengthRung)).toEqual(['L3', 'L2', 'L1', 'L0']);
    expect(grid[0].map((cell) => cell.coverageBucket)).toEqual(['L0', 'L1', 'L2', 'L3']);
  });

  it('bands every cell the way a declaration of that pair would', () => {
    expect(effectivenessGrid().map((row) => row.map((cell) => cell.band))).toEqual([
      ['none', 'moderate', 'solid', 'strong'],
      ['none', 'moderate', 'solid', 'strong'],
      ['none', 'marginal', 'moderate', 'solid'],
      ['not-deployed', 'not-deployed', 'not-deployed', 'not-deployed'],
    ]);
  });
});
