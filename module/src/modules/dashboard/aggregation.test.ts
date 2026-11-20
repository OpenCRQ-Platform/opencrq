import { describe, expect, it } from 'vitest';
import type { AssetDistributionCell, DashboardRunSample, DashboardTrendPoint, RiskScopeRunSample } from './aggregation';
import {
  buildDailyTrendSeries,
  buildExposureFlowAggregate,
  buildRiskScopeFigures,
  computeLikelihoodChange,
  computeScenarioTrend,
  deriveLikelihood,
  deriveMagnitude,
  foldAssetDistribution,
} from './aggregation';

const run = (overrides: Partial<DashboardRunSample> & { runId: string, riskScenarioId: string, createdAt: Date }): DashboardRunSample => ({
  aleMean: null,
  lefMean: null,
  ...overrides,
});

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const sums = (points: Array<DashboardTrendPoint>) => points.map(({ date, ale, lef }) => ({ date, ale, lef }));

describe('buildDailyTrendSeries', () => {
  it('sums metrics across scenarios and carries values forward over days without runs', () => {
    const windowStart = day('2026-07-01');
    const now = day('2026-07-05');
    const windowRuns = [
      run({ runId: 'r1', riskScenarioId: 's1', createdAt: day('2026-07-01'), aleMean: 100, lefMean: 1 }),
      run({ runId: 'r2', riskScenarioId: 's2', createdAt: day('2026-07-03'), aleMean: 200, lefMean: 2 }),
    ];

    const points = sums(buildDailyTrendSeries([], windowRuns, windowStart, now));

    expect(points).toEqual([
      { date: '2026-07-01', ale: 100, lef: 1 },
      { date: '2026-07-02', ale: 100, lef: 1 },
      { date: '2026-07-03', ale: 300, lef: 3 },
      { date: '2026-07-04', ale: 300, lef: 3 },
      { date: '2026-07-05', ale: 300, lef: 3 },
    ]);
  });

  it('seeds the carry from runs before the window so the series starts full', () => {
    const windowStart = day('2026-07-01');
    const now = day('2026-07-02');
    const seedRuns = [
      run({ runId: 'r0', riskScenarioId: 's1', createdAt: day('2026-06-15'), aleMean: 500, lefMean: 5 }),
    ];

    const points = sums(buildDailyTrendSeries(seedRuns, [], windowStart, now));

    expect(points).toEqual([
      { date: '2026-07-01', ale: 500, lef: 5 },
      { date: '2026-07-02', ale: 500, lef: 5 },
    ]);
  });

  it('keeps the last run of a day when a scenario has several runs the same day', () => {
    const windowStart = day('2026-07-01');
    const now = day('2026-07-01');
    const windowRuns = [
      run({ runId: 'r1', riskScenarioId: 's1', createdAt: new Date('2026-07-01T08:00:00.000Z'), aleMean: 100 }),
      run({ runId: 'r2', riskScenarioId: 's1', createdAt: new Date('2026-07-01T17:00:00.000Z'), aleMean: 250 }),
    ];

    const points = sums(buildDailyTrendSeries([], windowRuns, windowStart, now));

    expect(points).toEqual([{ date: '2026-07-01', ale: 250, lef: null }]);
  });

  it('does not reset a metric when a newer run has it null', () => {
    const windowStart = day('2026-07-01');
    const now = day('2026-07-02');
    const windowRuns = [
      run({ runId: 'r1', riskScenarioId: 's1', createdAt: day('2026-07-01'), aleMean: 100, lefMean: 1 }),
      run({ runId: 'r2', riskScenarioId: 's1', createdAt: day('2026-07-02'), aleMean: 150, lefMean: null }),
    ];

    const points = sums(buildDailyTrendSeries([], windowRuns, windowStart, now));

    expect(points).toEqual([
      { date: '2026-07-01', ale: 100, lef: 1 },
      { date: '2026-07-02', ale: 150, lef: 1 },
    ]);
  });

  it('starts emitting on the first day with data, not at window start', () => {
    const windowStart = day('2026-07-01');
    const now = day('2026-07-04');
    const windowRuns = [
      run({ runId: 'r1', riskScenarioId: 's1', createdAt: day('2026-07-03'), aleMean: 42 }),
    ];

    const points = sums(buildDailyTrendSeries([], windowRuns, windowStart, now));

    expect(points).toEqual([
      { date: '2026-07-03', ale: 42, lef: null },
      { date: '2026-07-04', ale: 42, lef: null },
    ]);
  });

  it('returns an empty series when there is no run at all', () => {
    expect(buildDailyTrendSeries([], [], day('2026-07-01'), day('2026-07-05'))).toEqual([]);
  });

  it('derives the likelihood and the magnitude from the summed LEF and ALE', () => {
    const windowRuns = [
      run({ runId: 'r1', riskScenarioId: 's1', createdAt: day('2026-07-01'), aleMean: 300, lefMean: 0.5 }),
      run({ runId: 'r2', riskScenarioId: 's2', createdAt: day('2026-07-01'), aleMean: 100, lefMean: 0.5 }),
    ];

    const [point] = buildDailyTrendSeries([], windowRuns, day('2026-07-01'), day('2026-07-01'));

    expect(point.likelihood).toBeCloseTo(1 - Math.exp(-1), 12);
    expect(point.magnitude).toBe(400);
  });
});

describe('deriveMagnitude', () => {
  it('has no magnitude without a positive event frequency', () => {
    expect(deriveMagnitude(100, 0)).toBeNull();
    expect(deriveMagnitude(100, null)).toBeNull();
    expect(deriveMagnitude(null, 1)).toBeNull();
  });
});

describe('deriveLikelihood', () => {
  it('reads no event as no chance and keeps an unknown frequency unknown', () => {
    expect(deriveLikelihood(0)).toBe(0);
    expect(deriveLikelihood(null)).toBeNull();
  });
});

describe('computeScenarioTrend', () => {
  it('computes delta and deltaPct between baseline and current', () => {
    const trend = computeScenarioTrend(
      { runId: 'r2', aleMean: 150 },
      { runId: 'r1', aleMean: 100 },
    );
    expect(trend).toEqual({ baselineAleMean: 100, currentAleMean: 150, delta: 50, deltaPct: 0.5 });
  });

  it('returns null when current and baseline are the same run', () => {
    expect(computeScenarioTrend({ runId: 'r1', aleMean: 100 }, { runId: 'r1', aleMean: 100 })).toBeNull();
  });

  it('returns null when either side is missing or has a null ALE', () => {
    expect(computeScenarioTrend(undefined, { runId: 'r1', aleMean: 100 })).toBeNull();
    expect(computeScenarioTrend({ runId: 'r2', aleMean: 100 }, undefined)).toBeNull();
    expect(computeScenarioTrend({ runId: 'r2', aleMean: null }, { runId: 'r1', aleMean: 100 })).toBeNull();
    expect(computeScenarioTrend({ runId: 'r2', aleMean: 100 }, { runId: 'r1', aleMean: null })).toBeNull();
  });

  it('returns a null deltaPct when the baseline is zero', () => {
    const trend = computeScenarioTrend(
      { runId: 'r2', aleMean: 80 },
      { runId: 'r1', aleMean: 0 },
    );
    expect(trend).toEqual({ baselineAleMean: 0, currentAleMean: 80, delta: 80, deltaPct: null });
  });
});

describe('computeLikelihoodChange', () => {
  it('measures the change as the difference of 1 - e^-LEF', () => {
    expect(computeLikelihoodChange({ runId: 'r2', lefMean: 0.5 }, { runId: 'r1', lefMean: 0.2 }))
      .toBeCloseTo(Math.exp(-0.2) - Math.exp(-0.5), 12);
  });

  it('returns null when current and baseline are the same run', () => {
    expect(computeLikelihoodChange({ runId: 'r1', lefMean: 0.5 }, { runId: 'r1', lefMean: 0.5 })).toBeNull();
  });

  it('returns null when either side is missing or carries no LEF', () => {
    expect(computeLikelihoodChange(undefined, { runId: 'r1', lefMean: 0.2 })).toBeNull();
    expect(computeLikelihoodChange({ runId: 'r2', lefMean: 0.2 }, undefined)).toBeNull();
    expect(computeLikelihoodChange({ runId: 'r2', lefMean: null }, { runId: 'r1', lefMean: 0.2 })).toBeNull();
    expect(computeLikelihoodChange({ runId: 'r2', lefMean: 0.2 }, { runId: 'r1', lefMean: null })).toBeNull();
  });
});

const cell = (
  categoryId: AssetDistributionCell['categoryId'],
  exposure: AssetDistributionCell['exposure'],
  assetCount: number,
  impactedAssetCount: number,
): AssetDistributionCell => ({ categoryId, exposure, assetCount, impactedAssetCount });

describe('foldAssetDistribution', () => {
  it('sums each margin of the grid over the other axis', () => {
    const { byCategory, byExposure } = foldAssetDistribution([
      cell('host', 'internet_facing', 3, 2),
      cell('host', 'internal', 1, 0),
      cell('container_workload', 'internet_facing', 2, 2),
    ]);

    expect(byCategory).toEqual([
      { categoryId: 'host', assetCount: 4, impactedAssetCount: 2 },
      { categoryId: 'container_workload', assetCount: 2, impactedAssetCount: 2 },
    ]);
    expect(byExposure).toEqual([
      { exposure: 'internet_facing', assetCount: 5, impactedAssetCount: 4 },
      { exposure: 'internal', assetCount: 1, impactedAssetCount: 0 },
    ]);
  });

  it('breaks an equal asset count on the key so the order never depends on the row order', () => {
    const { byCategory } = foldAssetDistribution([
      cell('host', 'internal', 2, 0),
      cell('container_workload', 'internal', 2, 1),
    ]);

    expect(byCategory.map((entry) => entry.categoryId)).toEqual(['container_workload', 'host']);
  });

  it('returns empty margins for a scope holding no asset', () => {
    expect(foldAssetDistribution([])).toEqual({ byCategory: [], byExposure: [] });
  });
});

describe('buildExposureFlowAggregate', () => {
  const flowRun = (runId: string, riskScenarioId: string, aleMean: number | null) => ({
    runId,
    riskScenarioId,
    aleMean,
    aleP10: null,
    aleP90: null,
    lefMean: null,
  });

  const scenarioRow = {
    id: 's1',
    name: 'Ransomware on ERP',
    organizationId: 'org-1',
    attackOutcomeId: 'outcome-1',
    attackOutcomeName: 'Ransomware',
    noMappedAsset: false,
  };

  it('should join every decomposition onto its scenario and total the priced ones', () => {
    const result = buildExposureFlowAggregate(
      [scenarioRow],
      [{ ...flowRun('r1', 's1', 1200), aleP10: 300, aleP90: 2500, lefMean: 0.4 }],
      [{ runId: 'r1', groupKey: 'g1', groupName: 'ALPHV', groupEntityType: 'intrusion-set', actorClass: 'ransomware_operator', share: 0.6, vulnerabilityMean: 0.4 }],
      [{ riskScenarioId: 's1', mitreTechniqueId: 't1', externalId: 'T1078', name: 'Valid Accounts', preventValue: 2, detectValue: 1 }],
      [{ riskScenarioId: 's1', lossDriverId: 'd1', lossDriverName: 'Interruption', lossCategoryId: 'c1', lossCategoryName: 'Business Interruption', minValue: 1, likelyValue: 2, maxValue: 3 }],
      [
        { riskScenarioId: 's1', primaryAssetId: 'pa1', primaryAssetName: 'Payments' },
        { riskScenarioId: 's1', primaryAssetId: 'pa2', primaryAssetName: 'Ledger' },
        { riskScenarioId: 's2', primaryAssetId: 'pa3', primaryAssetName: 'HR data' },
      ],
    );

    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0]).toMatchObject({ scenarioId: 's1', outcomeId: 'outcome-1', ale: 1200, aleP10: 300, aleP90: 2500, lefMean: 0.4 });
    expect(result.scenarios[0].primaryAssets).toEqual([{ id: 'pa1', name: 'Payments' }, { id: 'pa2', name: 'Ledger' }]);
    expect(result.scenarios[0].driverExpectations[0]).toMatchObject({ lossCategoryId: 'c1', lossCategoryName: 'Business Interruption' });
    expect(result.scenarios[0].groups[0]).toMatchObject({ key: 'g1', share: 0.6, vulnerabilityMean: 0.4 });
    expect(result.scenarios[0].techniques[0]).toMatchObject({ techniqueId: 't1', externalId: 'T1078', value: 3 });
    expect(result.scenarios[0].driverExpectations[0]).toMatchObject({ driverId: 'd1', minValue: 1, maxValue: 3 });
    expect(result.totals).toEqual({ aleMean: 1200 });
  });

  it('should report a scenario with no run as unsimulated and leave it out of the total', () => {
    const result = buildExposureFlowAggregate([scenarioRow], [], [], [], [], []);

    expect(result.scenarios).toHaveLength(0);
    expect(result.unsimulatedScenarios).toEqual([{ id: 's1', name: 'Ransomware on ERP', organizationId: 'org-1' }]);
    expect(result.totals).toEqual({ aleMean: null });
  });

  it.each([null, 0])('should report a run whose ale is %s as unpriced, not as a priced zero', (aleMean) => {
    const result = buildExposureFlowAggregate(
      [scenarioRow],
      [flowRun('r1', 's1', aleMean)],
      [], [], [], [],
    );

    expect(result.scenarios).toHaveLength(0);
    expect(result.unpricedScenarios).toHaveLength(1);
    expect(result.totals.aleMean).toBeNull();
  });

  it.each([
    ['with a run on file', [flowRun('r1', 's1', 1200)]],
    ['with no run', []],
  ])('should report a scenario whose scope maps no asset apart, %s, and leave it out of the total', (_, runs) => {
    const result = buildExposureFlowAggregate([{ ...scenarioRow, noMappedAsset: true }], runs, [], [], [], []);

    expect(result.scenarios).toHaveLength(0);
    expect(result.unmappedScenarios).toEqual([{ id: 's1', name: 'Ransomware on ERP', organizationId: 'org-1' }]);
    expect(result.unpricedScenarios).toEqual([]);
    expect(result.unsimulatedScenarios).toEqual([]);
    expect(result.totals.aleMean).toBeNull();
  });

  it('should drop a partly-filled loss estimate rather than default its missing bound', () => {
    const result = buildExposureFlowAggregate(
      [scenarioRow],
      [flowRun('r1', 's1', 1000)],
      [], [],
      [
        { riskScenarioId: 's1', lossDriverId: 'd1', lossDriverName: 'Interruption', lossCategoryId: 'c1', lossCategoryName: 'Business Interruption', minValue: 1, likelyValue: 2, maxValue: null },
        { riskScenarioId: 's1', lossDriverId: 'd2', lossDriverName: 'Response', lossCategoryId: 'c2', lossCategoryName: 'Response & Investigation', minValue: 1, likelyValue: 2, maxValue: 3 },
      ],
      [],
    );

    expect(result.scenarios[0].driverExpectations.map((driver) => driver.driverId)).toEqual(['d2']);
  });

  it('should keep each run attached to its own scenario', () => {
    const result = buildExposureFlowAggregate(
      [scenarioRow, { ...scenarioRow, id: 's2', name: 'Exfiltration' }],
      [
        flowRun('r1', 's1', 1000),
        flowRun('r2', 's2', 500),
      ],
      [
        { runId: 'r2', groupKey: 'g2', groupName: 'LockBit', groupEntityType: 'intrusion-set', actorClass: 'ransomware_operator', share: 1, vulnerabilityMean: 0.2 },
        { runId: 'r1', groupKey: 'g1', groupName: 'ALPHV', groupEntityType: 'intrusion-set', actorClass: 'ransomware_operator', share: 1, vulnerabilityMean: 0.4 },
      ],
      [], [], [],
    );

    expect(result.scenarios.find((s) => s.scenarioId === 's1')?.groups[0].name).toBe('ALPHV');
    expect(result.scenarios.find((s) => s.scenarioId === 's2')?.groups[0].name).toBe('LockBit');
    expect(result.totals.aleMean).toBe(1500);
  });

  it('should identify a row standing for an actor class by its class, and an analysis row by its key alone', () => {
    const result = buildExposureFlowAggregate(
      [scenarioRow],
      [flowRun('r1', 's1', 1000)],
      [
        { runId: 'r1', groupKey: 'run-local', groupName: null, groupEntityType: null, actorClass: 'state_sponsored', share: 0.7, vulnerabilityMean: 0.6 },
        { runId: 'r1', groupKey: 'g1', groupName: 'ALPHV', groupEntityType: 'intrusion-set', actorClass: 'ransomware_operator', share: 0.3, vulnerabilityMean: 0.4 },
      ],
      [], [], [],
    );

    expect(result.scenarios[0].groups.map((group) => [group.key, group.actorClass])).toEqual([
      ['run-local', 'state_sponsored'],
      ['g1', null],
    ]);
  });
});

describe('buildRiskScopeFigures', () => {
  const windowStart = day('2026-07-01');
  const now = day('2026-07-05');
  const scopeRun = (organizationId: string, overrides: Partial<RiskScopeRunSample> & { runId: string, riskScenarioId: string, createdAt: Date }): RiskScopeRunSample => ({
    ...run(overrides),
    organizationId,
  });
  const scopes = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Bravo' },
    { id: 'c', name: 'Charlie' },
  ];

  it('should read each scope on the last day of its own series, ranked by ALE', () => {
    const seedRuns = [scopeRun('a', { runId: 'r0', riskScenarioId: 's1', createdAt: day('2026-06-01'), aleMean: 100, lefMean: 0.5 })];
    const windowRuns = [
      scopeRun('a', { runId: 'r1', riskScenarioId: 's1', createdAt: day('2026-07-03'), aleMean: 150, lefMean: 0.5 }),
      scopeRun('a', { runId: 'r2', riskScenarioId: 's2', createdAt: day('2026-07-04'), aleMean: 50, lefMean: 0.5 }),
      scopeRun('b', { runId: 'r3', riskScenarioId: 's3', createdAt: day('2026-07-02'), aleMean: 400, lefMean: 2 }),
    ];

    const figures = buildRiskScopeFigures(scopes, seedRuns, windowRuns, windowStart, now);

    expect(figures.map((row) => row.name)).toEqual(['Bravo', 'Alpha']);
    expect(figures[1]).toEqual({
      organizationId: 'a',
      name: 'Alpha',
      scenarioCount: 2,
      ale: 200,
      lef: 1,
      likelihood: deriveLikelihood(1),
      magnitude: 200,
      aleChange: 100,
      aleBaseline: { date: '2026-07-01', ale: 100 },
      windowStart: '2026-07-01',
    });
    expect(figures[0].aleBaseline).toEqual({ date: '2026-07-02', ale: 400 });
    expect(figures[0].windowStart).toBe('2026-07-01');
  });

  it('should give no change to a scope measured on one day only', () => {
    const windowRuns = [scopeRun('b', { runId: 'r1', riskScenarioId: 's3', createdAt: day('2026-07-05'), aleMean: 400, lefMean: 2 })];

    const [figures] = buildRiskScopeFigures(scopes, [], windowRuns, windowStart, now);

    expect(figures.aleChange).toBeNull();
    expect(figures.aleBaseline).toEqual({ date: '2026-07-05', ale: 400 });
  });

  it('should leave out a scope with no run carrying a figure, and rank an unpriced scope last', () => {
    const windowRuns = [
      scopeRun('a', { runId: 'r1', riskScenarioId: 's1', createdAt: day('2026-07-02'), lefMean: 0.2 }),
      scopeRun('b', { runId: 'r2', riskScenarioId: 's3', createdAt: day('2026-07-02') }),
      scopeRun('c', { runId: 'r3', riskScenarioId: 's4', createdAt: day('2026-07-02'), aleMean: 10, lefMean: 0.1 }),
    ];

    const figures = buildRiskScopeFigures(scopes, [], windowRuns, windowStart, now);

    expect(figures.map((row) => [row.name, row.ale, row.scenarioCount])).toEqual([['Charlie', 10, 1], ['Alpha', null, 1]]);
  });
});
