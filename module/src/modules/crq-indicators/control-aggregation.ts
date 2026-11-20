import type { CoverageBucket, StrengthRung } from '../controls/capability/constants';
import type { CrqControlWhatIfDimension } from './schema';

export interface WhatIfAggregationRow {
  riskScenarioId: string,
  controlId: string,
  controlName: string,
  controlExternalId: string,
  dimension: CrqControlWhatIfDimension,
  aleReduction: number | null,
}

export interface AggregatedTopControl {
  controlId: string,
  name: string,
  externalId: string,
  suggestedDimension: CrqControlWhatIfDimension,
  scenarioCount: number,
  totalAleReduction: number,
}

/**
 * The what-if axes (strength/coverage/deploy) are alternative upgrades of the same
 * control, so per scenario only the best reduction counts; scenarios then sum up.
 */
export const aggregateTopControls = (rows: Array<WhatIfAggregationRow>): Array<AggregatedTopControl> => {
  interface ControlAccumulator {
    name: string,
    externalId: string,
    suggestedDimension: CrqControlWhatIfDimension,
    bestSingleReduction: number,
    bestReductionPerScenario: Map<string, number>,
  }
  const byControl = new Map<string, ControlAccumulator>();
  for (const row of rows) {
    if (row.aleReduction === null || row.aleReduction <= 0) {
      continue;
    }
    let acc = byControl.get(row.controlId);
    if (!acc) {
      acc = {
        name: row.controlName,
        externalId: row.controlExternalId,
        suggestedDimension: row.dimension,
        bestSingleReduction: 0,
        bestReductionPerScenario: new Map(),
      };
      byControl.set(row.controlId, acc);
    }
    const currentBest = acc.bestReductionPerScenario.get(row.riskScenarioId) ?? 0;
    if (row.aleReduction > currentBest) {
      acc.bestReductionPerScenario.set(row.riskScenarioId, row.aleReduction);
    }
    if (row.aleReduction > acc.bestSingleReduction) {
      acc.bestSingleReduction = row.aleReduction;
      acc.suggestedDimension = row.dimension;
    }
  }
  return [...byControl.entries()]
    .map(([controlId, acc]) => ({
      controlId,
      name: acc.name,
      externalId: acc.externalId,
      suggestedDimension: acc.suggestedDimension,
      scenarioCount: acc.bestReductionPerScenario.size,
      totalAleReduction: [...acc.bestReductionPerScenario.values()].reduce((sum, value) => sum + value, 0),
    }))
    .sort((a, b) => (b.totalAleReduction - a.totalAleReduction) || a.name.localeCompare(b.name) || a.controlId.localeCompare(b.controlId));
};

export interface WhatIfMoveRow extends WhatIfAggregationRow {
  currentStrength: StrengthRung,
  upgradedStrength: StrengthRung,
  currentCoverage: CoverageBucket,
  upgradedCoverage: CoverageBucket,
}

export type AggregatedControlMove = Omit<WhatIfMoveRow, 'riskScenarioId' | 'controlName' | 'controlExternalId' | 'aleReduction'> & {
  name: string,
  externalId: string,
  scenarioCount: number,
  totalAleReduction: number,
};

/** Keyed on the step the move shows, so scopes reading the same step sum together. */
const moveKeyOf = (row: WhatIfMoveRow): string =>
  [row.controlId, row.dimension, row.currentStrength, row.upgradedStrength, row.currentCoverage, row.upgradedCoverage].join('|');

/**
 * One move per control, the exact step with the largest reduction summed over the scenarios pricing
 * it, so the figures always belong to the step shown. Two scopes can hold a control at different
 * rungs, which makes two moves.
 */
export const aggregateTopControlMoves = (rows: Array<WhatIfMoveRow>): Array<AggregatedControlMove> => {
  const byMove = new Map<string, { move: Omit<AggregatedControlMove, 'scenarioCount' | 'totalAleReduction'>, reductionPerScenario: Map<string, number> }>();
  for (const row of rows) {
    if (row.aleReduction === null || row.aleReduction <= 0) {
      continue;
    }
    const key = moveKeyOf(row);
    let acc = byMove.get(key);
    if (!acc) {
      acc = {
        move: {
          controlId: row.controlId,
          name: row.controlName,
          externalId: row.controlExternalId,
          dimension: row.dimension,
          currentStrength: row.currentStrength,
          upgradedStrength: row.upgradedStrength,
          currentCoverage: row.currentCoverage,
          upgradedCoverage: row.upgradedCoverage,
        },
        reductionPerScenario: new Map(),
      };
      byMove.set(key, acc);
    }
    acc.reductionPerScenario.set(row.riskScenarioId, Math.max(acc.reductionPerScenario.get(row.riskScenarioId) ?? 0, row.aleReduction));
  }

  const bestByControl = new Map<string, AggregatedControlMove>();
  // Walked in key order so a tie between two moves elects the same one on every read.
  for (const [, { move, reductionPerScenario }] of [...byMove.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const candidate = {
      ...move,
      scenarioCount: reductionPerScenario.size,
      totalAleReduction: [...reductionPerScenario.values()].reduce((sum, value) => sum + value, 0),
    };
    const best = bestByControl.get(move.controlId);
    if (!best || candidate.totalAleReduction > best.totalAleReduction) {
      bestByControl.set(move.controlId, candidate);
    }
  }
  return [...bestByControl.values()]
    .sort((a, b) => (b.totalAleReduction - a.totalAleReduction) || a.name.localeCompare(b.name) || a.controlId.localeCompare(b.controlId));
};
