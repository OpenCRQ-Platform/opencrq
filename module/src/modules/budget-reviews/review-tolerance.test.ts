import { describe, expect, it } from 'vitest';
import type { ReviewAnnualLossRow, ScenarioTolerances } from './review-tolerance';
import { buildReviewTolerance, closedReviewToleranceOf, closedToleranceColumnsOf, toleranceReferenceOf } from './review-tolerance';

const row = (riskScenarioId: string, posture: ReviewAnnualLossRow['posture'], scale: number, reviewVersion = 2): ReviewAnnualLossRow => ({
  riskScenarioId,
  reviewVersion,
  posture,
  lossYearShare: 0.5,
  probabilities: [0.5, 0.6, 0.9, 0.99],
  losses: [0, 100 * scale, 400 * scale, 1000 * scale],
});

const NONE: ReadonlySet<string> = new Set();
const SCOPE = { annualLoss: 300, maxExceedanceProbability: 0.2 };
const OWN = { annualLoss: 900, maxExceedanceProbability: 0.05 };

const tolerances: Array<ScenarioTolerances> = [
  { riskScenarioId: 'a', scope: SCOPE, own: null },
  { riskScenarioId: 'b', scope: SCOPE, own: OWN },
  { riskScenarioId: 'c', scope: null, own: null },
];

describe('buildReviewTolerance', () => {
  const scenarios = [
    { id: 'b', name: 'Beta', readinessStatus: 'ready' as const },
    { id: 'a', name: 'Alpha', readinessStatus: 'ready' as const },
    { id: 'c', name: 'Gamma', readinessStatus: 'ready' as const },
    { id: 'd', name: 'Delta', readinessStatus: 'stale' as const },
  ];
  const rows = [
    row('a', 'reference', 1), row('a', 'without-build', 2),
    row('b', 'reference', 1), row('b', 'without-build', 1, 1),
    row('c', 'reference', 1), row('c', 'without-build', 1),
    row('d', 'reference', 1), row('d', 'without-build', 1),
  ];

  it('reads each scenario against its own tolerance first, then its scope\'s, and lists those without one', () => {
    const read = buildReviewTolerance(scenarios, tolerances, rows, 2, NONE);

    expect(read.map((scenario) => [scenario.name, scenario.tolerance?.source ?? null])).toEqual([
      ['Alpha', 'scope'], ['Beta', 'scenario'], ['Delta', null], ['Gamma', null],
    ]);
  });

  it('reads the probability of exceeding the tolerance amount on both curves', () => {
    const [alpha] = buildReviewTolerance(scenarios, tolerances, rows, 2, NONE);

    expect(alpha.reference).toMatchObject({ probability: 0.2, beyondTail: false });
    expect(alpha.withoutBuild!.probability!).toBeGreaterThan(alpha.reference!.probability!);
    expect(alpha.reference!.curve[0]).toEqual({ loss: 0, probability: 0.5 });
  });

  it('keeps the curves of a scenario without a tolerance, with no probability read on them', () => {
    const gamma = buildReviewTolerance(scenarios, tolerances, rows, 2, NONE).find((scenario) => scenario.name === 'Gamma')!;

    expect(gamma.reference).toMatchObject({ probability: null, beyondTail: null });
    expect(gamma.reference!.curve.length).toBeGreaterThan(1);
  });

  it('reads nothing for a scenario priced under another version or not ready', () => {
    const read = buildReviewTolerance(scenarios, tolerances, rows, 2, NONE);

    expect(read.find((scenario) => scenario.name === 'Beta')).toMatchObject({ reference: null, withoutBuild: null });
    expect(read.find((scenario) => scenario.name === 'Delta')).toMatchObject({ reference: null, withoutBuild: null });
  });

  it('marks a scenario priced for the version whose run is older than its latest', () => {
    const read = buildReviewTolerance(scenarios, tolerances, rows, 2, new Set(['a']));

    expect(read.find((scenario) => scenario.name === 'Alpha')!.olderThanHeadline).toBe(true);
    expect(read.find((scenario) => scenario.name === 'Gamma')!.olderThanHeadline).toBe(false);
  });

  it('never marks a scenario that reads no curve', () => {
    const read = buildReviewTolerance(scenarios, tolerances, rows, 2, new Set(['b', 'd']));

    expect(read.find((scenario) => scenario.name === 'Beta')!.olderThanHeadline).toBe(false);
    expect(read.find((scenario) => scenario.name === 'Delta')!.olderThanHeadline).toBe(false);
  });

  it('reads a closed review as never older than its latest run', () => {
    const [closed] = closedReviewToleranceOf([{
      riskScenarioId: 'a', scenarioName: 'Alpha', toleranceAnnualLoss: null, toleranceMaxExceedanceProbability: null, toleranceSource: null,
      referenceLosses: null, referenceProbabilities: null, withoutBuildLosses: null, withoutBuildProbabilities: null,
    }]);

    expect(closed.olderThanHeadline).toBe(false);
  });

  it('reads back from its frozen columns exactly what it read', () => {
    const read = buildReviewTolerance(scenarios, tolerances, rows, 2, NONE);

    expect(closedReviewToleranceOf(read.map(closedToleranceColumnsOf))).toEqual(read);
  });
});

describe('toleranceReferenceOf', () => {
  const LAST_DAY = new Date('2026-02-28T23:59:59Z');
  const PERIOD_END = new Date('2026-03-01T00:00:00Z');

  it('reads an open review today while its period runs and at its end once it is over', () => {
    expect(toleranceReferenceOf('2025-03-01', null, LAST_DAY)).toBe('today');
    expect(toleranceReferenceOf('2025-03-01', null, PERIOD_END)).toBe('period-end');
  });

  it('reads a closed review on its closing day when it closed before its period ended, whenever it is read', () => {
    expect(toleranceReferenceOf('2025-03-01', LAST_DAY, new Date('2027-01-01T00:00:00Z'))).toBe('closing');
    expect(toleranceReferenceOf('2025-03-01', PERIOD_END, PERIOD_END)).toBe('period-end');
  });
});
