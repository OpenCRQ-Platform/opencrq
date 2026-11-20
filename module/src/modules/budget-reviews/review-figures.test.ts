import { describe, expect, it } from 'vitest';
import type { ReviewLineSpend, ReviewResultRow, ReviewScenario } from './review-figures';
import { buildReviewFigures, returnPercentOf } from './review-figures';

const LINES: Array<ReviewLineSpend> = [
  { id: 'build', nature: 'build', amountSpent: 100_000, amortizationYears: null },
  { id: 'run', nature: 'run', amountSpent: 300_000, amortizationYears: null },
];

const READY: Array<ReviewScenario> = [
  { id: 's1', readinessStatus: 'ready' },
  { id: 's2', readinessStatus: 'ready' },
];

const row = (riskScenarioId: string, overrides: Partial<ReviewResultRow>): ReviewResultRow => ({
  riskScenarioId,
  runCreatedAt: new Date('2026-10-01T00:00:00Z'),
  reviewVersion: 2,
  basket: 'ensemble',
  lineId: null,
  aleReductionMean: 100,
  aleReductionP10: 50,
  aleReductionP90: 200,
  olderThanHeadline: false,
  ...overrides,
});

const everyBasket = (riskScenarioId: string, overrides: Partial<ReviewResultRow> = {}): Array<ReviewResultRow> => [
  row(riskScenarioId, { basket: 'line', lineId: 'build', ...overrides }),
  row(riskScenarioId, { basket: 'line', lineId: 'run', ...overrides }),
  row(riskScenarioId, { basket: 'build', ...overrides }),
  row(riskScenarioId, { basket: 'run', ...overrides }),
  row(riskScenarioId, { basket: 'ensemble', ...overrides }),
];

const figureOf = (figures: ReturnType<typeof buildReviewFigures>, basket: string, lineId: string | null = null) =>
  figures.figures.find((figure) => figure.basket === basket && figure.lineId === lineId)!;

describe('buildReviewFigures', () => {
  it('sums each figure over the scope\'s ready scenarios and reads priced when every one carries the current version', () => {
    const figures = buildReviewFigures(READY, [...everyBasket('s1'), ...everyBasket('s2')], 2, LINES);

    expect(figureOf(figures, 'ensemble')).toMatchObject({
      state: 'priced',
      aleReductionMean: 200,
      aleReductionP10: 100,
      aleReductionP90: 400,
      spent: 400_000,
      pricedScenarioCount: 2,
    });
    expect(figureOf(figures, 'line', 'run').spent).toBe(300_000);
    expect(figureOf(figures, 'build').spent).toBe(100_000);
    expect(figures.toReprice).toEqual([]);
  });

  it('reads expired as soon as one scenario carries an earlier version, and keeps its amount', () => {
    const figures = buildReviewFigures(READY, [...everyBasket('s1'), ...everyBasket('s2', { reviewVersion: 1 })], 2, LINES);

    expect(figureOf(figures, 'ensemble')).toMatchObject({ state: 'expired', aleReductionMean: 200 });
    expect(figures.toReprice).toEqual(['s2']);
  });

  it('reads not priced when a ready scenario carries no figure, and asks for that scenario', () => {
    const figures = buildReviewFigures(READY, everyBasket('s1'), 2, LINES);

    expect(figureOf(figures, 'ensemble')).toMatchObject({ state: 'not-priced', aleReductionMean: 100 });
    expect(figures.toReprice).toEqual(['s2']);
  });

  it('answers no amount at all for a line no run has priced yet', () => {
    const figures = buildReviewFigures(READY, [...everyBasket('s1'), ...everyBasket('s2')], 2, [...LINES, { id: 'new', nature: 'run', amountSpent: 10, amortizationYears: null }]);

    expect(figureOf(figures, 'line', 'new')).toMatchObject({ state: 'not-priced', aleReductionMean: null, returnPercent: null });
  });

  it('drops the figures of a scenario that is no longer ready, and reprices it', () => {
    const figures = buildReviewFigures(
      [{ id: 's1', readinessStatus: 'ready' }, { id: 's2', readinessStatus: 'stale' }],
      [...everyBasket('s1'), ...everyBasket('s2')],
      2,
      LINES,
    );

    expect(figureOf(figures, 'ensemble')).toMatchObject({ state: 'priced', aleReductionMean: 100, pricedScenarioCount: 1 });
    expect(figures.toReprice).toEqual(['s2']);
  });

  it('spreads an amortized build line over its years, in its own figure and in every basket holding it', () => {
    const lines: Array<ReviewLineSpend> = [
      { id: 'build', nature: 'build', amountSpent: 120_000, amortizationYears: 3 },
      { id: 'run', nature: 'run', amountSpent: 300_000, amortizationYears: null },
    ];
    const figures = buildReviewFigures(READY, [...everyBasket('s1', { aleReductionMean: 300_000 }), ...everyBasket('s2', { aleReductionMean: 300_000 })], 2, lines);

    expect(figureOf(figures, 'line', 'build')).toMatchObject({ spent: 120_000, annualSpent: 40_000 });
    expect(figureOf(figures, 'line', 'build').returnPercent).toBeCloseTo(400, 10);
    expect(figureOf(figures, 'line', 'build').amortizedReturnPercent).toBeCloseTo(1_400, 10);
    expect(figureOf(figures, 'run')).toMatchObject({ spent: 300_000, annualSpent: 300_000 });
    expect(figureOf(figures, 'ensemble')).toMatchObject({ spent: 420_000, annualSpent: 340_000 });
  });

  it('reads a build line without amortization years at its full spend', () => {
    const figures = buildReviewFigures(READY, [...everyBasket('s1'), ...everyBasket('s2')], 2, LINES);

    expect(figureOf(figures, 'build')).toMatchObject({ spent: 100_000, annualSpent: 100_000 });
    expect(figureOf(figures, 'build').amortizedReturnPercent).toBe(figureOf(figures, 'build').returnPercent);
  });

  it('never asks a simulation of a scenario that waits on the analyst', () => {
    const figures = buildReviewFigures([{ id: 's1', readinessStatus: 'incomplete' }], [], 2, LINES);

    expect(figures.toReprice).toEqual([]);
    expect(figureOf(figures, 'ensemble').state).toBe('not-priced');
  });

  it('dates a figure from the oldest simulation it is made of', () => {
    const figures = buildReviewFigures(
      READY,
      [...everyBasket('s1', { runCreatedAt: new Date('2026-10-05T00:00:00Z') }), ...everyBasket('s2', { runCreatedAt: new Date('2026-10-02T00:00:00Z') })],
      2,
      LINES,
    );

    expect(figureOf(figures, 'ensemble').pricedAt).toEqual(new Date('2026-10-02T00:00:00Z'));
  });

  it('keeps a figure priced when its run is older than the scenario\'s latest, and reprices that scenario', () => {
    const figures = buildReviewFigures(READY, [...everyBasket('s1'), ...everyBasket('s2', { olderThanHeadline: true })], 2, LINES);

    expect(figureOf(figures, 'ensemble').state).toBe('priced');
    expect(figures.olderThanHeadline).toEqual(['s2']);
    expect(figures.toReprice).toEqual(['s2']);
  });

  it('never lists a scenario that is not ready as older than its latest run', () => {
    const figures = buildReviewFigures(
      [{ id: 's1', readinessStatus: 'ready' }, { id: 's2', readinessStatus: 'stale' }],
      [...everyBasket('s1'), ...everyBasket('s2', { olderThanHeadline: true })],
      2,
      LINES,
    );

    expect(figures.olderThanHeadline).toEqual([]);
    expect(figures.toReprice).toEqual(['s2']);
  });

  it('lists an expired scenario that is also older once in toReprice', () => {
    const figures = buildReviewFigures(READY, [...everyBasket('s1'), ...everyBasket('s2', { reviewVersion: 1, olderThanHeadline: true })], 2, LINES);

    expect(figureOf(figures, 'ensemble').state).toBe('expired');
    expect(figures.olderThanHeadline).toEqual(['s2']);
    expect(figures.toReprice).toEqual(['s2']);
  });

  it('flags nothing when every scenario reads its latest run', () => {
    const figures = buildReviewFigures(READY, [...everyBasket('s1'), ...everyBasket('s2')], 2, LINES);

    expect(figures.olderThanHeadline).toEqual([]);
    expect(figures.toReprice).toEqual([]);
  });
});

describe('returnPercentOf', () => {
  it('is the loss avoided less the spend, over the spend', () => {
    expect(returnPercentOf(1_300_000, 400_000)).toBeCloseTo(225, 10);
  });

  it('is undefined without a spend or without a figure', () => {
    expect(returnPercentOf(100, 0)).toBeNull();
    expect(returnPercentOf(null, 100)).toBeNull();
  });
});
