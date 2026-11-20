import { describe, expect, it } from 'vitest';
import { roundPercentPoints, roundToDecimals, toPercentPoints } from './decimals';

describe('roundToDecimals', () => {
  it('should round an exact decimal half up, as it prints', () => {
    expect(roundToDecimals(1.005, 2)).toBe(1.01);
    expect(roundToDecimals(-1.005, 2)).toBe(-1.01);
    expect(roundToDecimals(12_345.6, 0)).toBe(12_346);
  });
});

describe('toPercentPoints', () => {
  it('should scale a fraction to percentage points in decimal, without rounding it', () => {
    expect(toPercentPoints(0.0185)).toBe(1.85);
    expect(toPercentPoints(0.145)).toBe(14.5);
    expect(toPercentPoints(0.123456789)).toBe(12.3456789);
    expect(toPercentPoints(-0.0185)).toBe(-1.85);
    expect(toPercentPoints(0)).toBe(0);
  });
});

describe('roundPercentPoints', () => {
  it('should scale a fraction to percentage points in decimal, so an exact half rounds up', () => {
    expect(roundPercentPoints(0.145, 0)).toBe(15);
    expect(roundPercentPoints(0.1455, 1)).toBe(14.6);
    expect(roundPercentPoints(-0.145, 0)).toBe(-15);
  });

  it('should keep a fraction above one whole, without grouping', () => {
    expect(roundPercentPoints(12.345, 0)).toBe(1235);
  });
});
