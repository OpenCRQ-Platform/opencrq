import { describe, expect, it } from 'vitest';
import type { WhatIfAggregationRow, WhatIfMoveRow } from './control-aggregation';
import { aggregateTopControlMoves, aggregateTopControls } from './control-aggregation';

describe('aggregateTopControls', () => {
  const row = (overrides: Partial<WhatIfAggregationRow> & { riskScenarioId: string, controlId: string, aleReduction: number | null }): WhatIfAggregationRow => ({
    controlName: 'Control',
    controlExternalId: 'CC-1',
    dimension: 'strength',
    ...overrides,
  });

  it('keeps the best axis per scenario instead of summing alternative axes', () => {
    const result = aggregateTopControls([
      row({ riskScenarioId: 's1', controlId: 'c1', dimension: 'strength', aleReduction: 100 }),
      row({ riskScenarioId: 's1', controlId: 'c1', dimension: 'coverage', aleReduction: 40 }),
    ]);

    expect(result).toEqual([
      {
        controlId: 'c1',
        name: 'Control',
        externalId: 'CC-1',
        suggestedDimension: 'strength',
        scenarioCount: 1,
        totalAleReduction: 100,
      },
    ]);
  });

  it('sums the per-scenario best reductions across scenarios and sorts descending', () => {
    const result = aggregateTopControls([
      row({ riskScenarioId: 's1', controlId: 'c1', aleReduction: 100 }),
      row({ riskScenarioId: 's2', controlId: 'c1', aleReduction: 60 }),
      row({ riskScenarioId: 's1', controlId: 'c2', aleReduction: 300 }),
    ]);

    expect(result.map((c) => c.controlId)).toEqual(['c2', 'c1']);
    expect(result[0]).toMatchObject({ scenarioCount: 1, totalAleReduction: 300 });
    expect(result[1]).toMatchObject({ scenarioCount: 2, totalAleReduction: 160 });
  });

  it('suggests the dimension of the largest single reduction observed', () => {
    const result = aggregateTopControls([
      row({ riskScenarioId: 's1', controlId: 'c1', dimension: 'strength', aleReduction: 50 }),
      row({ riskScenarioId: 's2', controlId: 'c1', dimension: 'deploy', aleReduction: 120 }),
    ]);

    expect(result[0]?.suggestedDimension).toBe('deploy');
  });

  it('ignores null and non-positive reductions', () => {
    const result = aggregateTopControls([
      row({ riskScenarioId: 's1', controlId: 'c1', aleReduction: null }),
      row({ riskScenarioId: 's1', controlId: 'c1', aleReduction: 0 }),
      row({ riskScenarioId: 's1', controlId: 'c1', aleReduction: -10 }),
    ]);

    expect(result).toEqual([]);
  });

  it('breaks an equal total reduction by name, then by id', () => {
    const result = aggregateTopControls([
      row({ riskScenarioId: 's1', controlId: 'c2', controlName: 'Zebra Control', aleReduction: 100 }),
      row({ riskScenarioId: 's1', controlId: 'c1', controlName: 'Alpha Control', aleReduction: 100 }),
    ]);

    expect(result.map((c) => c.controlId)).toEqual(['c1', 'c2']);
  });
});

describe('aggregateTopControlMoves', () => {
  const move = (overrides: Partial<WhatIfMoveRow> & { riskScenarioId: string, controlId: string, aleReduction: number | null }): WhatIfMoveRow => ({
    controlName: 'Control',
    controlExternalId: 'CC-1',
    dimension: 'strength',
    currentStrength: 'L1',
    upgradedStrength: 'L2',
    currentCoverage: 'L1',
    upgradedCoverage: 'L1',
    ...overrides,
  });
  const coverage = { dimension: 'coverage', currentStrength: 'L1', upgradedStrength: 'L1', currentCoverage: 'L1', upgradedCoverage: 'L2' } as const;

  it('keeps the move whose summed reduction is largest, with its own sum and scenario count', () => {
    const result = aggregateTopControlMoves([
      move({ riskScenarioId: 's1', controlId: 'c1', aleReduction: 100 }),
      move({ riskScenarioId: 's2', controlId: 'c1', aleReduction: 100 }),
      move({ riskScenarioId: 's3', controlId: 'c1', ...coverage, aleReduction: 150 }),
    ]);

    expect(result).toEqual([{
      controlId: 'c1',
      name: 'Control',
      externalId: 'CC-1',
      dimension: 'strength',
      currentStrength: 'L1',
      upgradedStrength: 'L2',
      currentCoverage: 'L1',
      upgradedCoverage: 'L1',
      scenarioCount: 2,
      totalAleReduction: 200,
    }]);
  });

  it('reads the same axis from two different rungs as two moves', () => {
    const result = aggregateTopControlMoves([
      move({ riskScenarioId: 's1', controlId: 'c1', aleReduction: 100 }),
      move({ riskScenarioId: 's2', controlId: 'c1', currentStrength: 'L2', upgradedStrength: 'L3', aleReduction: 80 }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ currentStrength: 'L1', upgradedStrength: 'L2', scenarioCount: 1, totalAleReduction: 100 });
  });

  it('leaves out non-positive reductions', () => {
    const result = aggregateTopControlMoves([
      move({ riskScenarioId: 's1', controlId: 'c2', aleReduction: 0 }),
      move({ riskScenarioId: 's1', controlId: 'c3', aleReduction: null }),
      move({ riskScenarioId: 's1', controlId: 'c4', dimension: 'deploy', currentStrength: 'L0', currentCoverage: 'L0', aleReduction: 30 }),
    ]);

    expect(result.map((control) => [control.controlId, control.dimension])).toEqual([['c4', 'deploy']]);
  });

  it('ranks the controls by their kept reduction, then by name', () => {
    const result = aggregateTopControlMoves([
      move({ riskScenarioId: 's1', controlId: 'c1', controlName: 'Zebra', aleReduction: 50 }),
      move({ riskScenarioId: 's1', controlId: 'c2', controlName: 'Alpha', aleReduction: 50 }),
      move({ riskScenarioId: 's1', controlId: 'c3', controlName: 'Middle', aleReduction: 90 }),
    ]);

    expect(result.map((control) => control.controlId)).toEqual(['c3', 'c2', 'c1']);
  });
});
