import { describe, expect, it } from 'vitest';
import type { AggregateRiskPointLike } from './aggregate-risk-utils';
import { aggregateRiskWindow, aggregateRiskWindowStartDay, readAggregateRisk } from './aggregate-risk-utils';

const point = (date: string, values: Partial<AggregateRiskPointLike>): AggregateRiskPointLike => ({
  date,
  ale: null,
  likelihood: null,
  magnitude: null,
  ...values,
});

describe('readAggregateRisk', () => {
  it('reads the current value and its change since the first reading', () => {
    const reading = readAggregateRisk([
      point('2026-01-01', { ale: 100 }),
      point('2026-01-02', { ale: null }),
      point('2026-01-03', { ale: 150 }),
    ], 'ale');

    expect(reading).toEqual({ values: [100, null, 150], firstDate: '2026-01-01', current: 150, change: 50, direction: 'up' });
  });

  it('has no change for a single reading', () => {
    const reading = readAggregateRisk([point('2026-01-01', { likelihood: 0.4 })], 'likelihood');

    expect(reading).toMatchObject({ current: 0.4, change: null, direction: 'flat' });
  });

  it('has neither value nor change for an empty series', () => {
    expect(readAggregateRisk([], 'magnitude')).toEqual({ values: [], firstDate: null, current: null, change: null, direction: 'flat' });
  });

  it('names the day of the first reading, skipping the days before one', () => {
    const reading = readAggregateRisk([
      point('2026-01-01', { ale: null }),
      point('2026-01-02', { ale: null }),
      point('2026-01-03', { ale: 150 }),
    ], 'ale');

    expect(reading.firstDate).toBe('2026-01-03');
  });

  it('reads a fall as down', () => {
    const reading = readAggregateRisk([point('2026-01-01', { magnitude: 200 }), point('2026-01-02', { magnitude: 100 })], 'magnitude');

    expect(reading).toMatchObject({ change: -100, direction: 'down' });
  });
});

describe('aggregateRiskWindow', () => {
  it('closes on the last day served and opens a year of days before it', () => {
    const window = aggregateRiskWindow([point('2026-06-01', {}), point('2026-10-02', {})]);

    expect(window).toEqual({ start: Date.parse('2025-10-03T00:00:00Z'), end: Date.parse('2026-10-02T00:00:00Z') });
  });

  it('has no window for an empty series', () => {
    expect(aggregateRiskWindow([])).toBeNull();
  });
});

describe('aggregateRiskWindowStartDay', () => {
  it("names the window's first day from the last day served, not from where the series starts", () => {
    const startDay = aggregateRiskWindowStartDay([point('2026-10-02', { ale: 90 }), point('2026-10-05', { ale: 100 })]);

    expect(startDay).toBe('2025-10-06');
  });

  it('has no first day for an empty series', () => {
    expect(aggregateRiskWindowStartDay([])).toBeNull();
  });
});
