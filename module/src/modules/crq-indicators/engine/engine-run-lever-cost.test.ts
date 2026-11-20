import { describe, expect, it, vi } from 'vitest';
import type { AttackRunConstants, AttackRunTechnique } from './attack-run-law';
import type { EngineRunControl, EngineRunInputs } from './engine-run';
import type { CoverageBucket, StrengthRung } from '../../controls/capability/constants';
import type * as evaluation from './attack-run-evaluation';
import { evaluateAttackRun, evaluateBaseline, evaluateWhatIf } from './attack-run-evaluation';
import { createEngineRun } from './engine-run';

vi.mock('./attack-run-evaluation', async (importOriginal) => {
  const actual = await importOriginal<typeof evaluation>();
  return {
    ...actual,
    evaluateAttackRun: vi.fn(actual.evaluateAttackRun),
    evaluateBaseline: vi.fn(actual.evaluateBaseline),
    evaluateWhatIf: vi.fn(actual.evaluateWhatIf),
  };
});

const EVALUATIONS = [evaluateAttackRun, evaluateBaseline, evaluateWhatIf];

/**
 * Each evaluation is a whole attack run, so a lever arm the run prices but no control value lists
 * is paid for nothing. Adding one control to a run adds exactly its evaluated levers per world.
 */

const CONSTANTS: AttackRunConstants = {
  visitQuota: 5,
  populationDetectionCap: 7,
  unknownFlawFloorScale: 0.04,
  detectionScale: 0.0383,
  signalGain: 0.3,
  execFloor: 0.3,
  postDetectionRate: 0.7,
  coupleSuccessCap: 0.98,
  actorExploitedCveFloor: 0.9,
};

const WORLDS = 6;

const technique = (externalId: string, tacticExternalId: string): AttackRunTechnique =>
  ({ externalId, tacticExternalIds: [tacticExternalId], families: ['host'] });

const control = (capabilityExternalId: string, strengthRung: StrengthRung, coverageBucket: CoverageBucket): EngineRunControl => ({
  controlId: `id-${capabilityExternalId}`,
  capabilityExternalId,
  strengthRung,
  coverageBucket,
  preventTechniqueExternalIds: ['X1', 'X4'],
  detectTechniqueExternalIds: ['X1', 'X4'],
});

const inputsWith = (controls: ReadonlyArray<EngineRunControl>): EngineRunInputs => ({
  terminalTacticExternalId: 'TA0040',
  controls,
  actors: [{
    key: 'actor-1',
    name: 'Ransomware crew',
    actorClass: 'ransomware_operator',
    knobs: { capability: 0.7, stealth: 0.4, patience: 0.2, attackRunDays: 5 },
    share: 1,
    repertoire: [technique('X1', 'TA0001'), technique('X2', 'TA0006'), technique('X3', 'TA0007'), technique('X4', 'TA0008'), technique('X5', 'TA0040')],
    groups: [{ id: 'desktops', family: 'host', assets: 200, exposure: 'internal', criticality: 'low', matchedByScenarioGroup: true }],
  }],
  tef: { min: 1, likely: 1, max: 1 },
  lossDrivers: [{ min: 1000000, likely: 1000000, max: 1000000 }],
  reactionTimeHours: { min: 8, likely: 8, max: 8 },
  constants: CONSTANTS,
  door: {
    techniques: ['X1'],
    families: ['host'],
    cves: [{ cveId: 'CVE-2024-0001', threat: 1, priced: true }],
    assets: [{ family: 0, target: false, openings: [{ cve: 0, technique: 0, opening: 1 }] }],
    applicable: [Float64Array.from([1])],
    targetApplicable: [Float64Array.from([0])],
    phishing: null,
  },
  phishing: { declaredSusceptibility: null },
  unknownExposureCountsAs: 'internal',
  unknownCriticalityCountsAs: 'low',
  worlds: WORLDS,
  seed: 'lever-cost',
});

const evaluationsOf = (inputs: EngineRunInputs): number => {
  EVALUATIONS.forEach((evaluate) => vi.mocked(evaluate).mockClear());
  const run = createEngineRun(inputs);
  while (!run.done()) {
    run.advance(8);
  }
  return EVALUATIONS.reduce((calls, evaluate) => calls + vi.mocked(evaluate).mock.calls.length, 0);
};

describe('the cost of a control\'s levers', () => {
  const held = control('IDP', 'L2', 'L2');
  const without = evaluationsOf(inputsWith([held]));

  it.each([
    { strength: 'L0', coverage: 'L0', levers: ['deploy'] },
    { strength: 'L1', coverage: 'L0', levers: ['coverage'] },
    { strength: 'L0', coverage: 'L1', levers: ['strength'] },
    { strength: 'L2', coverage: 'L2', levers: ['strength', 'coverage'] },
  ] as const)('evaluates a control at $strength/$coverage once per world for each lever it lists', ({ strength, coverage, levers }) => {
    const added = control('EDR', strength, coverage);
    const run = createEngineRun(inputsWith([held, added]));
    while (!run.done()) {
      run.advance(8);
    }
    const value = run.result().controlValues.find((entry) => entry.capabilityExternalId === 'EDR')!;
    expect(value.levers.map((lever) => lever.dimension)).toEqual(levers);
    const evaluated = value.levers.filter((lever) => lever.zeroReason !== 'already-maximal').length;
    expect(evaluationsOf(inputsWith([held, added])) - without).toBe(WORLDS * evaluated);
  });
});
