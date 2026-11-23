import { describe, expect, it } from 'vitest';
import type { EngineRunRows } from './result-fingerprint';
import { resultFingerprintOf } from './result-fingerprint';

const runRows = ({ runId = 'run-1', keys = ['key-a', 'key-b'], priced = true } = {}): EngineRunRows => ({
  priced,
  run: {
    id: runId,
    riskScenarioId: 'scenario',
    jobId: `job-of-${runId}`,
    readAt: new Date(runId === 'run-1' ? '2026-11-01T10:00:00Z' : '2026-11-02T10:00:00Z'),
    inputsFingerprint: `inputs-of-${runId}`,
    iterations: 100,
    vulnerabilityP5: 0.1,
    vulnerabilityP50: 0.2,
    vulnerabilityP95: 0.3,
    vulnerabilityMean: 0.2,
    aleMean: priced ? 1_000 : null,
    techniqueCount: 12,
    coveredTechniqueCount: 8,
    profile: runId === 'run-1' ? ['techniques', 'cves', 'levers', 'plans'] : [],
  },
  annualLoss: priced
    ? { id: runId, runId, years: 1, mean: 1_000, lossYearShare: 0.4, lossEventYearShare: 0.5, probabilities: [0.5, 0.9], losses: [10, 900] }
    : null,
  groupScores: keys.map((groupKey, index) => ({
    id: `${runId}-group-${index}`,
    runId,
    groupKey,
    groupName: `Attacker ${index}`,
    share: 0.5,
    vulnerabilityP5: 0.1,
    vulnerabilityP50: 0.2,
    vulnerabilityP95: 0.3,
    vulnerabilityMean: 0.2,
  })),
  unplayableObstacles: [{ id: `${runId}-obstacle`, runId, groupKey: keys[1], obstacleKey: 'deep_access' }],
  reachGaps: [{ id: `${runId}-gap`, runId, mitreTechniqueId: 'technique', family: 'host', gap: 'estate' }],
  planWhatIfs: [],
  budgetReviewResults: [],
  budgetReviewAnnualLosses: [],
  controlWhatIfs: [],
  cveWhatIfs: [],
  techniqueWhatIfs: runId === 'run-1' ? [{ id: `${runId}-technique`, runId, mitreTechniqueId: 'technique', preventValueMean: null, detectValueMean: null }] : [],
});

describe('resultFingerprintOf', () => {
  it('should read two runs answering alike as equal, whatever their ids, job, read moment, inputs and profile', () => {
    expect(resultFingerprintOf(runRows({ runId: 'run-2', keys: ['key-c', 'key-d'] }), 'main-a')).toBe(resultFingerprintOf(runRows(), 'main-a'));
  });

  it('should tell apart two runs whose figures differ', () => {
    const moved = runRows();
    expect(resultFingerprintOf({ ...moved, run: { ...moved.run, aleMean: 1_001 } }, 'main-a')).not.toBe(resultFingerprintOf(runRows(), 'main-a'));
  });

  it('should tell apart two runs whose obstacle stops another attacker', () => {
    const moved = runRows();
    expect(resultFingerprintOf({ ...moved, unplayableObstacles: [{ ...moved.unplayableObstacles[0], groupKey: 'key-a' }] }, 'main-a'))
      .not.toBe(resultFingerprintOf(runRows(), 'main-a'));
  });

  it('should read the what-ifs of a run with no price as part of its answer', () => {
    expect(resultFingerprintOf(runRows({ runId: 'run-2', priced: false }), 'main-a')).not.toBe(resultFingerprintOf(runRows({ priced: false }), 'main-a'));
  });

  it('should tell apart two runs answering alike from two releases', () => {
    expect(resultFingerprintOf(runRows(), 'main-b')).not.toBe(resultFingerprintOf(runRows(), 'main-a'));
  });
});
