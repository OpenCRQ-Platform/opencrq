import { describe, expect, it } from 'vitest';
import type { BuildHistoryRow } from './review-build-history';
import { buildHistoryOf, buildMoveDays, endOfDay } from './review-build-history';

interface StepFigures {
  gap: number,
  level: number,
}

const runRows = (
  runId: string,
  createdAt: string,
  build: number | null,
  steps: Record<string, StepFigures> = {},
  riskScenarioId = 'crm',
): Array<BuildHistoryRow> => {
  const runCreatedAt = new Date(createdAt);
  return [
    { runId, riskScenarioId, runCreatedAt, basket: 'build', stepOn: null, aleReductionMean: build },
    ...Object.entries(steps).flatMap(([stepOn, { gap, level }]) => [
      { runId, riskScenarioId, runCreatedAt, basket: 'step' as const, stepOn, aleReductionMean: gap },
      { runId, riskScenarioId, runCreatedAt, basket: 'step-level' as const, stepOn, aleReductionMean: level },
    ]),
  ];
};

// A build control moved in March, another in June: a step on the March day, and the build figure from June on.
const DAYS = [{ date: '2026-03-15' }, { date: '2026-06-10' }];

describe('buildHistoryOf', () => {
  it('reads each move day but the last off its own step, and the last one off the build figure', () => {
    // ALE(R) 2.0M; on 15 March the ALE is 2.4M, and 2.7M with the build controls back at the period start.
    const rows = runRows('r1', '2026-11-12T08:00:00Z', 600_000, { '2026-03-15': { gap: 300_000, level: 400_000 } });

    expect(buildHistoryOf(rows, [{ runId: 'r1', mean: 2_000_000 }], DAYS)).toEqual([{
      riskScenarioId: 'crm',
      pricedAt: new Date('2026-11-12T08:00:00Z'),
      steps: [{ date: '2026-03-15', relativeReduction: 0.125 }, { date: '2026-06-10', relativeReduction: 0.3 }],
    }]);
  });

  it('reads the latest run that priced the review, as its figures do', () => {
    const rows = [
      ...runRows('r1', '2026-11-12T08:00:00Z', 600_000, { '2026-03-15': { gap: 300_000, level: 400_000 } }),
      ...runRows('r2', '2026-12-01T08:00:00Z', 500_000, { '2026-03-15': { gap: 240_000, level: 400_000 } }),
    ];

    const [history] = buildHistoryOf(rows, [{ runId: 'r1', mean: 2_000_000 }, { runId: 'r2', mean: 2_000_000 }], DAYS);

    expect(history.pricedAt).toEqual(new Date('2026-12-01T08:00:00Z'));
    expect(history.steps).toEqual([{ date: '2026-03-15', relativeReduction: 0.1 }, { date: '2026-06-10', relativeReduction: 0.25 }]);
  });

  it('skips a move day the run did not price, a move logged after it', () => {
    const rows = runRows('r1', '2026-11-12T08:00:00Z', 600_000);

    expect(buildHistoryOf(rows, [{ runId: 'r1', mean: 2_000_000 }], DAYS)[0].steps)
      .toEqual([{ date: '2026-06-10', relativeReduction: 0.3 }]);
  });

  it('draws nothing without a reference ALE, and no step without a move day', () => {
    const rows = runRows('r1', '2026-11-12T08:00:00Z', 600_000);

    expect(buildHistoryOf(rows, [], DAYS)).toEqual([]);
    expect(buildHistoryOf(rows, [{ runId: 'r1', mean: 2_000_000 }], [])[0].steps).toEqual([]);
  });

  it('keeps each scenario apart', () => {
    const rows = [
      ...runRows('a', '2026-11-12T08:00:00Z', 100_000, {}, 'crm'),
      ...runRows('b', '2026-11-12T09:00:00Z', 200_000, {}, 'pos'),
    ];
    const references = [{ runId: 'a', mean: 1_000_000 }, { runId: 'b', mean: 1_000_000 }];

    expect(buildHistoryOf(rows, references, DAYS).map(({ riskScenarioId, steps }) => [riskScenarioId, steps.at(-1)?.relativeReduction]))
      .toEqual([['crm', 0.1], ['pos', 0.2]]);
  });
});

describe('buildMoveDays', () => {
  const lines = [{ id: 'identity', nature: 'build' }, { id: 'endpoint', nature: 'build' }, { id: 'licences', nature: 'run' }];
  const controls = [
    { lineId: 'identity', capabilityId: 'mfa' },
    { lineId: 'identity', capabilityId: 'pam' },
    { lineId: 'endpoint', capabilityId: 'edr' },
    { lineId: 'licences', capabilityId: 'siem' },
  ];

  it('gives each UTC day a build control moved on, every move counted, a line finished on its last day', () => {
    expect(buildMoveDays(lines, controls, [
      { capabilityId: 'mfa', movedAt: new Date('2026-03-15T09:00:00Z') },
      { capabilityId: 'siem', movedAt: new Date('2026-04-01T09:00:00Z') },
      { capabilityId: 'edr', movedAt: new Date('2026-06-10T08:00:00Z') },
      { capabilityId: 'pam', movedAt: new Date('2026-06-10T22:00:00Z') },
      { capabilityId: 'mfa', movedAt: new Date('2026-06-10T23:00:00Z') },
      { capabilityId: 'edr', movedAt: new Date('2026-08-20T09:00:00Z') },
    ])).toEqual([
      { date: '2026-03-15', lines: [{ lineId: 'identity', capabilityIds: ['mfa'], finished: false }] },
      {
        date: '2026-06-10',
        lines: [
          { lineId: 'identity', capabilityIds: ['mfa', 'pam'], finished: true },
          { lineId: 'endpoint', capabilityIds: ['edr'], finished: false },
        ],
      },
      { date: '2026-08-20', lines: [{ lineId: 'endpoint', capabilityIds: ['edr'], finished: true }] },
    ]);
  });

  it('moves every build line holding the control', () => {
    const shared = [...controls, { lineId: 'endpoint', capabilityId: 'mfa' }];

    expect(buildMoveDays(lines, shared, [{ capabilityId: 'mfa', movedAt: new Date('2026-03-15T09:00:00Z') }])[0].lines.map((line) => line.lineId))
      .toEqual(['identity', 'endpoint']);
  });
});

describe('endOfDay', () => {
  it('is the next UTC midnight', () => {
    expect(endOfDay('2026-03-15')).toEqual(new Date('2026-03-16T00:00:00Z'));
  });
});
