import { describe, expect, it } from 'vitest';
import type { WhatIfMoveRow } from '../crq-indicators/control-aggregation';
import type { RiskTreatmentScenario, ScenarioRunReading } from './risk-treatment';
import { assembleRiskTreatmentCards, buildRiskTreatmentPoints, buildScenarioRunSeries, countToleranceByScope } from './risk-treatment';

const day = (iso: string): Date => new Date(`${iso}T10:00:00.000Z`);

const reading = (overrides: Partial<ScenarioRunReading> & { runId: string, riskScenarioId: string, createdAt: Date }): ScenarioRunReading => ({
  aleMean: 100,
  lefMean: 0.5,
  lefP10: 0.2,
  lefP90: 0.9,
  lossEventYearShare: 0.4,
  ...overrides,
});

const scenario = (id: string, name: string): RiskTreatmentScenario => ({
  id,
  name,
  organizationId: 'org',
  attackOutcomeName: 'Ransomware',
  noMappedAsset: false,
  scopeTolerance: null,
  ownTolerance: null,
});

const move = (overrides: Partial<WhatIfMoveRow> & { riskScenarioId: string, controlId: string, aleReduction: number }): WhatIfMoveRow => ({
  controlName: overrides.controlId,
  controlExternalId: overrides.controlId.toUpperCase(),
  dimension: 'strength',
  currentStrength: 'L1',
  upgradedStrength: 'L2',
  currentCoverage: 'L1',
  upgradedCoverage: 'L1',
  ...overrides,
});

describe('buildScenarioRunSeries', () => {
  const windowStart = new Date('2026-01-01T00:00:00.000Z');

  it('opens the series on the window start with the last run before it', () => {
    const series = buildScenarioRunSeries(
      [reading({ runId: 'seed', riskScenarioId: 's1', createdAt: day('2025-11-20'), aleMean: 50 })],
      [reading({ runId: 'r1', riskScenarioId: 's1', createdAt: day('2026-02-01'), aleMean: 80 })],
      windowStart,
    );

    expect(series.get('s1')?.map(({ date, runId }) => ({ date, runId }))).toEqual([
      { date: '2026-01-01', runId: 'seed' },
      { date: '2026-02-01', runId: 'r1' },
    ]);
  });

  it('lets a run of the window start day replace the run before the window', () => {
    const series = buildScenarioRunSeries(
      [reading({ runId: 'seed', riskScenarioId: 's1', createdAt: day('2025-11-20') })],
      [reading({ runId: 'r1', riskScenarioId: 's1', createdAt: day('2026-01-01') })],
      windowStart,
    );

    expect(series.get('s1')?.map(({ runId }) => runId)).toEqual(['r1']);
  });

  it('orders a scenario readings oldest first', () => {
    const series = buildScenarioRunSeries([], [
      reading({ runId: 'late', riskScenarioId: 's1', createdAt: day('2026-03-01') }),
      reading({ runId: 'early', riskScenarioId: 's1', createdAt: day('2026-02-01') }),
    ], windowStart);

    expect(series.get('s1')?.map(({ runId }) => runId)).toEqual(['early', 'late']);
  });
});

const latest = (runId: string, riskScenarioId: string, aleMean: number | null = 100) => ({ runId, riskScenarioId, aleMean });

describe('assembleRiskTreatmentCards', () => {
  it('orders the cards by the latest run expected annual loss, a scenario without one last', () => {
    const cards = assembleRiskTreatmentCards(
      [scenario('a', 'Alpha'), scenario('b', 'Bravo'), scenario('c', 'Charlie'), scenario('d', 'Delta')],
      [latest('a2', 'a', 100), latest('b1', 'b', 500), latest('d1', 'd', null)],
      [],
      5,
    );

    expect(cards.map(({ name, aleMean }) => ({ name, aleMean }))).toEqual([
      { name: 'Bravo', aleMean: 500 },
      { name: 'Alpha', aleMean: 100 },
      { name: 'Charlie', aleMean: null },
      { name: 'Delta', aleMean: null },
    ]);
  });

  it('ranks each scenario moves on that scenario alone, up to the limit', () => {
    const rows = [
      move({ riskScenarioId: 'a', controlId: 'c1', aleReduction: 10 }),
      move({ riskScenarioId: 'a', controlId: 'c2', aleReduction: 30 }),
      move({ riskScenarioId: 'a', controlId: 'c3', aleReduction: 20 }),
      move({ riskScenarioId: 'b', controlId: 'c1', aleReduction: 1000 }),
    ];
    const cards = assembleRiskTreatmentCards([scenario('a', 'Alpha'), scenario('b', 'Bravo')], [], rows, 2);

    const alpha = cards.find((card) => card.scenarioId === 'a');
    expect(alpha?.topControlMoves.map(({ controlId, totalAleReduction, scenarioCount }) => ({ controlId, totalAleReduction, scenarioCount }))).toEqual([
      { controlId: 'c2', totalAleReduction: 30, scenarioCount: 1 },
      { controlId: 'c3', totalAleReduction: 20, scenarioCount: 1 },
    ]);
  });

  it('marks a scenario without a run as not simulated, with no figure', () => {
    const [card] = assembleRiskTreatmentCards([scenario('a', 'Alpha')], [], [], 5);

    expect(card).toMatchObject({ simulated: false, aleMean: null, topControlMoves: [] });
  });

  it('marks a scenario whose latest run has no ALE as simulated', () => {
    const [card] = assembleRiskTreatmentCards([scenario('a', 'Alpha')], [latest('a1', 'a', null)], [], 5);

    expect(card).toMatchObject({ simulated: true, aleMean: null });
  });

  it('carries the scenario tolerances as given', () => {
    const scopeTolerance = { annualLoss: 1000, maxExceedanceProbability: 0.1 };
    const [card] = assembleRiskTreatmentCards([{ ...scenario('a', 'Alpha'), scopeTolerance }], [latest('a2', 'a')], [], 5);

    expect(card).toMatchObject({ scopeTolerance, ownTolerance: null });
  });
});

describe('buildRiskTreatmentPoints', () => {
  const series = (runs: Array<ScenarioRunReading>) =>
    buildScenarioRunSeries([], runs, new Date('2026-01-01T00:00:00.000Z')).get('a') ?? [];

  it('reads likelihood from the sampled share and its band from the LEF band', () => {
    const points = buildRiskTreatmentPoints(
      series([reading({ runId: 'a1', riskScenarioId: 'a', createdAt: day('2026-02-01'), aleMean: 300, lefMean: 1.5, lefP10: 1, lefP90: 2, lossEventYearShare: 0.7 })]),
      null,
      new Map(),
    );

    expect(points).toEqual([{
      date: '2026-02-01',
      aleMean: 300,
      likelihood: 0.7,
      likelihoodP10: 1 - Math.exp(-1),
      likelihoodP90: 1 - Math.exp(-2),
      exceedance: null,
    }]);
  });

  it('leaves the likelihood out for a run without a distribution, and the band for a run without one', () => {
    const points = buildRiskTreatmentPoints(
      series([
        reading({ runId: 'a1', riskScenarioId: 'a', createdAt: day('2026-02-01'), lossEventYearShare: null }),
        reading({ runId: 'a2', riskScenarioId: 'a', createdAt: day('2026-03-01'), lefP10: null, lefP90: null }),
      ]),
      null,
      new Map(),
    );

    expect(points.map(({ likelihood, likelihoodP10, likelihoodP90 }) => ({ likelihood, likelihoodP10, likelihoodP90 }))).toEqual([
      { likelihood: null, likelihoodP10: 1 - Math.exp(-0.2), likelihoodP90: 1 - Math.exp(-0.9) },
      { likelihood: 0.4, likelihoodP10: null, likelihoodP90: null },
    ]);
  });

  describe('exceedance', () => {
    const distribution = (lossYearShare: number) => ({
      mean: 100,
      lossYearShare,
      quantiles: [{ probability: 0.5, loss: 1000 }, { probability: 0.9, loss: 5000 }],
    });
    const runs = series([
      reading({ runId: 'a1', riskScenarioId: 'a', createdAt: day('2026-02-01') }),
      reading({ runId: 'a2', riskScenarioId: 'a', createdAt: day('2026-03-01') }),
      reading({ runId: 'a3', riskScenarioId: 'a', createdAt: day('2026-04-01') }),
    ]);
    const losses = new Map([['a1', distribution(0.6)], ['a3', distribution(0.8)]]);

    it('reads each run against the applied threshold amount, and skips a run without a distribution', () => {
      const points = buildRiskTreatmentPoints(runs, { annualLoss: 1000, maxExceedanceProbability: 0.2 }, losses);

      expect(points.map(({ exceedance }) => exceedance)).toEqual([0.5, null, 0.5]);
    });

    it('reads a lower amount higher on the curve', () => {
      const points = buildRiskTreatmentPoints(runs, { annualLoss: 500, maxExceedanceProbability: 0.1 }, losses);

      expect(points.map(({ exceedance }) => exceedance)).toEqual([0.55, null, 0.65]);
    });

    it('reads nothing without a tolerance', () => {
      const points = buildRiskTreatmentPoints(runs, null, losses);

      expect(points.map(({ exceedance }) => exceedance)).toEqual([null, null, null]);
    });
  });
});

describe('countToleranceByScope', () => {
  const tolerance = { annualLoss: 1_000, maxExceedanceProbability: 0.1 };
  const distribution = (loss: number) => ({
    lossYearShare: 1,
    quantiles: [{ probability: 0.5, loss: loss / 2 }, { probability: 0.9, loss }, { probability: 0.99, loss: loss * 2 }],
  });
  const under = (id: string, organizationId: string, overrides: { scopeTolerance?: typeof tolerance | null, ownTolerance?: typeof tolerance | null } = {}) => ({
    id,
    organizationId,
    scopeTolerance: tolerance,
    ownTolerance: null,
    ...overrides,
  });

  it('counts the scenarios whose latest run exceeds their tolerance, per scope', () => {
    const counts = countToleranceByScope(
      [under('a1', 'a'), under('a2', 'a'), under('b1', 'b'), under('c1', 'c')],
      new Map([['a1', distribution(5_000)], ['a2', distribution(5_000)], ['b1', distribution(100)], ['c1', distribution(5_000)]]),
    );

    expect(counts).toEqual([
      { organizationId: 'a', assessed: 2, outside: 2 },
      { organizationId: 'b', assessed: 1, outside: 0 },
      { organizationId: 'c', assessed: 1, outside: 1 },
    ]);
  });

  it('leaves out a scenario with no applied tolerance, and never counts as outside one with no distribution', () => {
    const counts = countToleranceByScope(
      [under('a1', 'a', { scopeTolerance: null }), under('a2', 'a'), under('b1', 'b', { scopeTolerance: null })],
      new Map([['a1', distribution(5_000)]]),
    );

    expect(counts).toEqual([{ organizationId: 'a', assessed: 1, outside: 0 }]);
  });

  it('holds a scenario to its own tolerance over its scope', () => {
    const lenient = { annualLoss: 1_000_000, maxExceedanceProbability: 0.1 };

    expect(countToleranceByScope([under('a1', 'a', { ownTolerance: lenient })], new Map([['a1', distribution(5_000)]])))
      .toEqual([{ organizationId: 'a', assessed: 1, outside: 0 }]);
  });

  it('does not add the scenarios of a scope up against a tolerance', () => {
    const counts = countToleranceByScope([under('a1', 'a'), under('a2', 'a')], new Map([['a1', distribution(600)], ['a2', distribution(600)]]));

    expect(counts).toEqual([{ organizationId: 'a', assessed: 2, outside: 0 }]);
  });
});
