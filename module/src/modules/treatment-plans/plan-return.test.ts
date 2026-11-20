import { describe, expect, it } from 'vitest';
import { summarisePlanReturn } from './plan-return';

describe('summarisePlanReturn', () => {
  it('should sum the one-off and the recurring cost into the first-year cost', () => {
    const summary = summarisePlanReturn(486_000, { costOneOff: 120_000, costRecurringAnnual: 36_000 });

    expect(summary.costYear1).toBe(156_000);
    expect(summary.returnPercent).toBeCloseTo(211.54, 2);
  });

  it('should price a plan carrying one cost field alone on that field', () => {
    expect(summarisePlanReturn(100_000, { costOneOff: null, costRecurringAnnual: 50_000 }))
      .toEqual({ costYear1: 50_000, returnPercent: 100 });
    expect(summarisePlanReturn(100_000, { costOneOff: 50_000, costRecurringAnnual: null }))
      .toEqual({ costYear1: 50_000, returnPercent: 100 });
  });

  it('should leave both figures undefined when no cost is entered', () => {
    expect(summarisePlanReturn(486_000, { costOneOff: null, costRecurringAnnual: null }))
      .toEqual({ costYear1: null, returnPercent: null });
  });

  it('should leave the return undefined on a cost of zero, never infinite', () => {
    expect(summarisePlanReturn(486_000, { costOneOff: 0, costRecurringAnnual: 0 }))
      .toEqual({ costYear1: 0, returnPercent: null });
  });

  it('should keep the cost and leave the return undefined until a run prices the plan', () => {
    expect(summarisePlanReturn(null, { costOneOff: 120_000, costRecurringAnnual: null }))
      .toEqual({ costYear1: 120_000, returnPercent: null });
  });

  it('should return a negative figure for a plan that raises the exposure', () => {
    const summary = summarisePlanReturn(-50_000, { costOneOff: 100_000, costRecurringAnnual: null });

    expect(summary.returnPercent).toBe(-150);
  });

  it('should return a negative figure for a plan that saves less than it costs', () => {
    const summary = summarisePlanReturn(198_000, { costOneOff: 240_000, costRecurringAnnual: null });

    expect(summary.returnPercent).toBeCloseTo(-17.5, 1);
  });

  it('should read a plan priced at nothing as a total loss of its cost', () => {
    expect(summarisePlanReturn(0, { costOneOff: 100_000, costRecurringAnnual: null }).returnPercent).toBe(-100);
  });
});
