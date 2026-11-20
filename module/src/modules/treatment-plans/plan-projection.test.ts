import { describe, expect, it } from 'vitest';
import type { PlanProjectionRow, PlanProjectionScenario, PlanTotalRow } from './plan-projection';
import { buildPlanProjection, scenariosToReprice, summarisePlanTotals } from './plan-projection';

const scenario = (id: string, readinessStatus: PlanProjectionScenario['readinessStatus'] = 'ready'): PlanProjectionScenario =>
  ({ id, name: `Scenario ${id}`, readinessStatus });

const row = (riskScenarioId: string, overrides: Partial<PlanProjectionRow> = {}): PlanProjectionRow => ({
  riskScenarioId,
  runId: `run-${riskScenarioId}`,
  runCreatedAt: new Date('2026-09-17T00:00:00Z'),
  aleMean: 1000,
  lefMean: 2,
  planScopeVersion: 3,
  aleReductionMean: 400,
  aleReductionP10: 250,
  aleReductionP90: 550,
  olderThanHeadline: false,
  ...overrides,
});

describe('buildPlanProjection', () => {
  it('should price the target from the run\'s own baseline', () => {
    const projection = buildPlanProjection([scenario('a')], [row('a')], 3);

    expect(projection.scenarios[0]).toMatchObject({ state: 'priced', aleMean: 1000, aleTargetMean: 600 });
    expect(projection.totalAleReduction).toBe(400);
    expect(projection.pricedScenarioCount).toBe(1);
  });

  it('should keep a figure priced against an earlier set of moves, marked expired', () => {
    const projection = buildPlanProjection([scenario('a')], [row('a', { planScopeVersion: 2 })], 3);

    expect(projection.scenarios[0].state).toBe('expired');
    expect(projection.scenarios[0].aleTargetMean).toBe(600);
    expect(projection.expired).toBe(true);
  });

  it('should read a plan the run priced at zero as priced, not as unpriced', () => {
    const projection = buildPlanProjection([scenario('a')], [row('a', { aleReductionMean: 0 })], 3);

    expect(projection.scenarios[0]).toMatchObject({ state: 'priced', aleReductionMean: 0, aleTargetMean: 1000 });
    expect(projection.totalAleReduction).toBe(0);
    expect(projection.pricedScenarioCount).toBe(1);
  });

  it('should read a run carrying no row for the plan as not priced, never as zero', () => {
    const projection = buildPlanProjection([scenario('a')], [row('a', { planScopeVersion: null, aleReductionMean: null, olderThanHeadline: true })], 3);

    expect(projection.scenarios[0]).toMatchObject({ state: 'not-priced', aleTargetMean: null, aleReductionMean: null, olderThanHeadline: false });
    expect(projection.totalAleReduction).toBeNull();
  });

  it('should list every scenario of the scope, and drop the figures of the ones it could not price', () => {
    const projection = buildPlanProjection(
      [scenario('a'), scenario('b', 'not-simulated'), scenario('c', 'stale')],
      [row('a'), row('c')],
      3,
    );

    expect(projection.scenarios.map((entry) => entry.riskScenarioId)).toEqual(['a', 'b', 'c']);
    expect(projection.scopeScenarioCount).toBe(3);
    expect(projection.pricedScenarioCount).toBe(1);
    // `c` has a run of its own, priced before the inputs moved: it describes a scenario that no
    // longer exists, so nothing of it survives but its name.
    expect(projection.scenarios[2]).toMatchObject({
      readinessStatus: 'stale',
      state: 'not-priced',
      runId: null,
      runCreatedAt: null,
      aleMean: null,
      aleTargetMean: null,
      aleReductionMean: null,
    });
  });

  it('should date the total from the oldest simulation it is made of', () => {
    const projection = buildPlanProjection(
      [scenario('a'), scenario('b')],
      [
        row('a', { runCreatedAt: new Date('2026-09-18T00:00:00Z') }),
        row('b', { runCreatedAt: new Date('2026-09-15T00:00:00Z') }),
      ],
      3,
    );

    expect(projection.pricedAt).toEqual(new Date('2026-09-15T00:00:00Z'));
    expect(projection.totalAleReduction).toBe(800);
  });

  it('should hold a plan whose scope has no scenario at all', () => {
    const projection = buildPlanProjection([], [], 1);

    expect(projection).toMatchObject({
      scenarios: [],
      totalAleReduction: null,
      pricedScenarioCount: 0,
      scopeScenarioCount: 0,
      expired: false,
      pricedAt: null,
    });
  });
});

const totalRow = (riskScenarioId: string, overrides: Partial<PlanTotalRow> = {}): PlanTotalRow => ({
  planId: 'plan-1',
  riskScenarioId,
  planScopeVersion: 3,
  aleReductionMean: 400,
  runCreatedAt: new Date('2026-09-17T00:00:00Z'),
  ...overrides,
});

const ready = (...ids: Array<string>): ReadonlySet<string> => new Set(ids);

describe('scenariosToReprice', () => {
  it('should name every scenario a run can start from whose figure is not current', () => {
    const projection = buildPlanProjection(
      [scenario('priced'), scenario('expired'), scenario('never-priced'), scenario('not-simulated', 'not-simulated'), scenario('stale', 'stale')],
      [row('priced'), row('expired', { planScopeVersion: 2 }), row('never-priced', { planScopeVersion: null }), row('stale')],
      3,
    );

    expect(scenariosToReprice(projection, true)).toEqual(['expired', 'never-priced', 'not-simulated', 'stale']);
  });

  it('should name a current figure read from a run older than the scenario\'s ALE', () => {
    const projection = buildPlanProjection(
      [scenario('current'), scenario('older')],
      [row('current'), row('older', { olderThanHeadline: true })],
      3,
    );

    expect(projection.scenarios.map((entry) => entry.olderThanHeadline)).toEqual([false, true]);
    expect(scenariosToReprice(projection, true)).toEqual(['older']);
  });

  it('should leave out a scenario no run can start from', () => {
    const projection = buildPlanProjection([scenario('a', 'incomplete'), scenario('b', 'no-mapped-asset')], [], 3);

    expect(scenariosToReprice(projection, true)).toEqual([]);
  });

  it('should name nothing for a plan without a move, which no run prices', () => {
    const projection = buildPlanProjection([scenario('a')], [row('a', { planScopeVersion: null })], 3);

    expect(scenariosToReprice(projection, false)).toEqual([]);
  });
});

describe('summarisePlanTotals', () => {
  it('should sum the rows of a plan and date the total from the latest run it is made of', () => {
    const totals = summarisePlanTotals(
      [
        totalRow('a', { runCreatedAt: new Date('2026-09-15T00:00:00Z') }),
        totalRow('b', { aleReductionMean: 100, runCreatedAt: new Date('2026-09-18T00:00:00Z') }),
      ],
      new Map([['plan-1', 3]]),
      ready('a', 'b'),
    );

    expect(totals.get('plan-1')).toEqual({
      totalAleReduction: 500,
      expired: false,
      pricedAt: new Date('2026-09-18T00:00:00Z'),
    });
  });

  it('should drop the row of a scenario that is not ready, exactly as the plan page drops it', () => {
    const totals = summarisePlanTotals(
      [totalRow('a'), totalRow('b', { aleReductionMean: 100 })],
      new Map([['plan-1', 3]]),
      ready('a'),
    );

    expect(totals.get('plan-1')?.totalAleReduction).toBe(400);
  });

  it('should hold no total at all for a plan whose every scenario went stale', () => {
    const totals = summarisePlanTotals([totalRow('a')], new Map([['plan-1', 3]]), ready());

    expect(totals.has('plan-1')).toBe(false);
  });

  it('should mark a plan carrying a figure priced against an earlier set of moves', () => {
    const totals = summarisePlanTotals(
      [totalRow('a', { planScopeVersion: 2 })],
      new Map([['plan-1', 3]]),
      ready('a'),
    );

    expect(totals.get('plan-1')).toMatchObject({ totalAleReduction: 400, expired: true });
  });

  it('should read a run carrying no figure for the plan as no total, never as zero', () => {
    const totals = summarisePlanTotals(
      [totalRow('a', { aleReductionMean: null })],
      new Map([['plan-1', 3]]),
      ready('a'),
    );

    expect(totals.get('plan-1')).toEqual({ totalAleReduction: null, expired: false, pricedAt: null });
  });

  it('should keep the total of each plan apart', () => {
    const totals = summarisePlanTotals(
      [totalRow('a'), totalRow('a', { planId: 'plan-2', aleReductionMean: 900 })],
      new Map([['plan-1', 3], ['plan-2', 1]]),
      ready('a'),
    );

    expect(totals.get('plan-1')?.totalAleReduction).toBe(400);
    expect(totals.get('plan-2')?.totalAleReduction).toBe(900);
  });
});
