import { describe, expect, it } from 'vitest';
import { approximationPricedAt, reviewWindowDays, scopeAleSeries, scopeRiskSeries } from './review-risk-series';

describe('reviewWindowDays', () => {
  it('reaches back to the period start, today included', () => {
    expect(reviewWindowDays('2026-01-01', new Date(Date.UTC(2026, 0, 1)))).toBe(1);
    expect(reviewWindowDays('2026-04-01', new Date(Date.UTC(2026, 4, 1)))).toBe(31);
  });

  it('counts up to today in UTC, as the endpoint does', () => {
    expect(reviewWindowDays('2026-04-01', new Date('2026-05-01T01:00:00+03:00'))).toBe(30);
  });

  it('reaches a period begun more than a year ago', () => {
    expect(reviewWindowDays('2025-04-01', new Date(Date.UTC(2026, 9, 5)))).toBe(553);
  });

  it('stops at the run history limit for a period begun more than two years ago', () => {
    expect(reviewWindowDays('2024-04-01', new Date(Date.UTC(2026, 9, 5)))).toBe(731);
  });
});

describe('reviewWindowDays', () => {
  it('counts one day for a period that has not begun', () => {
    expect(reviewWindowDays('2027-01-01', new Date(Date.UTC(2026, 9, 5)))).toBe(1);
  });
});

describe('scopeAleSeries', () => {
  it('sums what every scenario holds each day, carrying a reading forward until its next run', () => {
    const series = scopeAleSeries([
      { series: [{ date: '2026-01-01', aleMean: 100 }, { date: '2026-03-01', aleMean: 80 }] },
      { series: [{ date: '2026-01-01', aleMean: 50 }, { date: '2026-02-01', aleMean: 60 }] },
    ], '2026-01-01', '2026-10-05');

    expect(series).toEqual([
      { date: '2026-01-01', ale: 150 },
      { date: '2026-02-01', ale: 160 },
      { date: '2026-03-01', ale: 140 },
    ]);
  });

  it('adds nothing for a scenario before its first priced run', () => {
    const series = scopeAleSeries([
      { series: [{ date: '2026-01-01', aleMean: 100 }] },
      { series: [{ date: '2026-01-01', aleMean: null }, { date: '2026-04-01', aleMean: 40 }] },
    ], '2026-01-01', '2026-10-05');

    expect(series).toEqual([{ date: '2026-01-01', ale: 100 }, { date: '2026-04-01', ale: 140 }]);
  });

  it('opens on the first day with the readings made before it, and drops the days after the period', () => {
    const series = scopeAleSeries([
      { series: [{ date: '2024-12-20', aleMean: 100 }, { date: '2025-06-01', aleMean: 90 }, { date: '2026-02-01', aleMean: 70 }] },
    ], '2025-01-01', '2025-12-31');

    expect(series).toEqual([{ date: '2025-01-01', ale: 100 }, { date: '2025-06-01', ale: 90 }]);
  });

  it('keeps the day the period ends on, and opens once on the first day when a reading lands on it', () => {
    const series = scopeAleSeries([
      { series: [{ date: '2025-12-20', aleMean: 100 }, { date: '2026-01-01', aleMean: 90 }, { date: '2026-10-05', aleMean: 80 }] },
    ], '2026-01-01', '2026-10-05');

    expect(series).toEqual([{ date: '2026-01-01', ale: 90 }, { date: '2026-10-05', ale: 80 }]);
  });

  it('opens the series on the first day with the last reading when every reading precedes it', () => {
    const series = scopeAleSeries([{ series: [{ date: '2025-06-01', aleMean: 100 }] }], '2026-01-01', '2026-10-05');

    expect(series).toEqual([{ date: '2026-01-01', ale: 100 }]);
  });

  it('is empty when no scenario was ever priced', () => {
    expect(scopeAleSeries([{ series: [{ date: '2026-01-01', aleMean: null }] }], '2026-01-01', '2026-10-05')).toEqual([]);
  });
});

describe('scopeRiskSeries', () => {
  const crm = {
    scenarioId: 'crm',
    series: [
      { date: '2026-04-01', aleMean: 2e6 },
      { date: '2026-06-20', aleMean: 1.6e6 },
      { date: '2026-07-10', aleMean: 1.5e6 },
      { date: '2026-08-01', aleMean: 1.4e6 },
    ],
  };
  const crmHistory = {
    riskScenarioId: 'crm',
    pricedAt: '2026-11-12T08:00:00Z',
    steps: [{ date: '2026-06-15', relativeReduction: 0.125 }, { date: '2026-07-20', relativeReduction: 0.3 }],
  };

  it('raises each day\'s ALE by the last step on or before it, and leaves it as it is before the first one', () => {
    const points = scopeRiskSeries([crm], [crmHistory], '2026-04-01', '2026-10-05');

    expect(points.map(({ date, ale }) => [date, ale])).toEqual([
      ['2026-04-01', 2e6],
      ['2026-06-20', 1.6e6],
      ['2026-07-10', 1.5e6],
      ['2026-08-01', 1.4e6],
    ]);
    [2e6, 1.8e6, 1.6875e6, 1.82e6].forEach((without, index) => expect(points[index].without).toBeCloseTo(without));
  });

  it('adds the ALE alone of a scenario without steps', () => {
    const pos = { scenarioId: 'pos', series: [{ date: '2026-04-01', aleMean: 1e6 }] };
    const unpriced = { scenarioId: 'lab', series: [{ date: '2026-04-01', aleMean: 0.5e6 }] };
    const history = [crmHistory, { riskScenarioId: 'pos', pricedAt: '2026-11-12T08:00:00Z', steps: [{ date: '2026-05-01', relativeReduction: 0.1 }] }];

    const points = scopeRiskSeries([crm, pos, unpriced], history, '2026-04-01', '2026-10-05');

    expect(points.at(-1)!.without).toBeCloseTo(1.4e6 * 1.3 + 1e6 * 1.1 + 0.5e6);
  });

  it('carries the last measured ALE through a run without one', () => {
    const scenario = { scenarioId: 'crm', series: [{ date: '2026-04-01', aleMean: 1e6 }, { date: '2026-05-01', aleMean: null }] };
    const history = [{ riskScenarioId: 'crm', pricedAt: '2026-11-12T08:00:00Z', steps: [{ date: '2026-04-15', relativeReduction: 0.2 }] }];

    const points = scopeRiskSeries([scenario], history, '2026-04-01', '2026-10-05');

    expect(points.map(({ date, ale }) => [date, ale])).toEqual([['2026-04-01', 1e6], ['2026-05-01', 1e6]]);
    expect(points[1].without).toBeCloseTo(1.2e6);
  });

  it('adds nothing for a scenario no run has priced by that day, in the scope without the build work too', () => {
    const late = { scenarioId: 'late', series: [{ date: '2026-05-01', aleMean: 0.5e6 }] };
    const history = [{ riskScenarioId: 'crm', pricedAt: '2026-11-12T08:00:00Z', steps: [{ date: '2026-04-15', relativeReduction: 0.1 }] }];

    const points = scopeRiskSeries([crm, late], history, '2026-04-01', '2026-10-05');

    expect(points[0].without).toBeCloseTo(2e6);
    expect(points.find((point) => point.date === '2026-06-20')!.without).toBeCloseTo(1.6e6 * 1.1 + 0.5e6);
  });

  it('draws no scope without the build work when no scenario carries a step', () => {
    const history = [{ riskScenarioId: 'crm', pricedAt: '2026-11-12T08:00:00Z', steps: [] }];
    expect(scopeRiskSeries([crm], history, '2026-04-01', '2026-10-05').every((point) => point.without === null)).toBe(true);
    expect(scopeRiskSeries([crm], [], '2026-04-01', '2026-10-05').every((point) => point.without === null)).toBe(true);
  });
});

describe('approximationPricedAt', () => {
  it('takes the latest run a scenario\'s steps are priced on, and none without a step', () => {
    const steps = [{ date: '2026-03-15', relativeReduction: 0.1 }];
    expect(approximationPricedAt([
      { pricedAt: new Date('2026-10-01T08:00:00Z'), steps },
      { pricedAt: new Date('2026-10-03T08:00:00Z'), steps },
      { pricedAt: new Date('2026-10-05T08:00:00Z'), steps: [] },
    ])).toEqual(new Date('2026-10-03T08:00:00Z'));
    expect(approximationPricedAt([{ pricedAt: new Date('2026-10-05T08:00:00Z'), steps: [] }])).toBeNull();
  });
});
