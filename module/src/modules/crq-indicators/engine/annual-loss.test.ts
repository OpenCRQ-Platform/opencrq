import { describe, expect, it } from 'vitest';
import { ANNUAL_LOSS_PROBABILITIES, poissonDraw, sampleAnnualLosses } from './annual-loss';
import { createPrng } from './prng';

const DRAWS = 40000;

const momentsOf = (rate: number): { mean: number, variance: number, zeroShare: number } => {
  const random = createPrng(7);
  let total = 0;
  let squares = 0;
  let zeros = 0;
  for (let draw = 0; draw < DRAWS; draw += 1) {
    const count = poissonDraw(rate, random);
    total += count;
    squares += count * count;
    zeros += count === 0 ? 1 : 0;
  }
  const mean = total / DRAWS;
  return { mean, variance: squares / DRAWS - mean * mean, zeroShare: zeros / DRAWS };
};

describe('poissonDraw', () => {
  it.each([0.05, 0.4, 3, 9.5, 10, 42, 900])('draws a count whose mean and variance are the rate (%s)', (rate) => {
    const { mean, variance } = momentsOf(rate);
    expect(Math.abs(mean - rate)).toBeLessThan(3 * Math.sqrt(rate / DRAWS));
    expect(variance / rate).toBeGreaterThan(0.95);
    expect(variance / rate).toBeLessThan(1.05);
  });

  it('draws no event with probability e^-rate', () => {
    for (const rate of [0.1, 1, 2.5]) {
      const expected = Math.exp(-rate);
      expect(Math.abs(momentsOf(rate).zeroShare - expected)).toBeLessThan(3 * Math.sqrt(expected * (1 - expected) / DRAWS));
    }
  });

  it('draws nothing at a zero rate', () => {
    expect(poissonDraw(0, createPrng(1))).toBe(0);
  });
});

describe('sampleAnnualLosses', () => {
  const uniformWorlds = (count: number, value: number): Float64Array => new Float64Array(count).fill(value);
  const lossEvents = (rates: Float64Array, pricedFraction = 1) => ({ rates, pricedFraction, lossEvent: true });

  it('prices a year at its events times the priced fraction of a magnitude', () => {
    const lef = 0.7;
    const distribution = sampleAnnualLosses({
      streams: [lossEvents(uniformWorlds(2000, lef), 0.9)],
      magnitudes: uniformWorlds(2000, 1000),
      yearsPerWorld: 10,
      seed: 's11',
    });
    expect(distribution.years).toBe(20000);
    /* A constant magnitude leaves the count as the only noise. */
    expect(Math.abs(distribution.mean - lef * 900)).toBeLessThan(3 * 900 * Math.sqrt(lef / 20000));
    const nonZero = 1 - Math.exp(-lef);
    expect(Math.abs(distribution.lossEventYearShare - nonZero)).toBeLessThan(3 * Math.sqrt(nonZero * (1 - nonZero) / 20000));
    expect(distribution.lossYearShare).toBe(distribution.lossEventYearShare);
    for (const { loss } of distribution.quantiles) {
      expect(loss % 900).toBe(0);
    }
  });

  it('charges an attack stopped in time without counting it as a loss event', () => {
    const [lef, stopped] = [0.3, 0.6];
    const distribution = sampleAnnualLosses({
      streams: [lossEvents(uniformWorlds(2000, lef)), { rates: uniformWorlds(2000, stopped), pricedFraction: 0.15, lossEvent: false }],
      magnitudes: uniformWorlds(2000, 1000),
      yearsPerWorld: 10,
      seed: 's13',
    });
    const binomialError = (share: number): number => 3 * Math.sqrt(share * (1 - share) / 20000);
    const lossEvent = 1 - Math.exp(-lef);
    const anyCost = 1 - Math.exp(-(lef + stopped));
    expect(Math.abs(distribution.lossEventYearShare - lossEvent)).toBeLessThan(binomialError(lossEvent));
    expect(Math.abs(distribution.lossYearShare - anyCost)).toBeLessThan(binomialError(anyCost));
    const expectedMean = 1000 * (lef + 0.15 * stopped);
    expect(Math.abs(distribution.mean / expectedMean - 1)).toBeLessThan(0.03);
  });

  it('counts a loss event in a year whose magnitude is zero', () => {
    const lef = 0.7;
    const distribution = sampleAnnualLosses({
      streams: [lossEvents(uniformWorlds(2000, lef))],
      magnitudes: uniformWorlds(2000, 0),
      yearsPerWorld: 10,
      seed: 's17',
    });
    const nonZero = 1 - Math.exp(-lef);
    expect(Math.abs(distribution.lossEventYearShare - nonZero)).toBeLessThan(3 * Math.sqrt(nonZero * (1 - nonZero) / 20000));
    expect(distribution.lossYearShare).toBe(0);
    expect(distribution.mean).toBe(0);
  });

  it('keeps every level of the grid, in order, with losses that never decrease', () => {
    const distribution = sampleAnnualLosses({
      streams: [lossEvents(Float64Array.from({ length: 500 }, (_, world) => world / 250))],
      magnitudes: Float64Array.from({ length: 500 }, (_, world) => 100 + world),
      yearsPerWorld: 10,
      seed: 's3',
    });
    expect(distribution.quantiles.map((quantile) => quantile.probability)).toEqual(ANNUAL_LOSS_PROBABILITIES);
    for (let index = 1; index < distribution.quantiles.length; index += 1) {
      expect(distribution.quantiles[index].loss).toBeGreaterThanOrEqual(distribution.quantiles[index - 1].loss);
    }
  });

  it('keeps the mean of a year far past the exact event limit', () => {
    const lef = 5000;
    const distribution = sampleAnnualLosses({
      streams: [lossEvents(uniformWorlds(100, lef))],
      magnitudes: Float64Array.from({ length: 100 }, (_, world) => 50 + world),
      yearsPerWorld: 10,
      seed: 's5',
    });
    expect(distribution.mean / (lef * 99.5)).toBeCloseTo(1, 2);
    expect(distribution.lossYearShare).toBe(1);
  });

  it('replays the same years on the same seed', () => {
    const inputs = {
      streams: [lossEvents(Float64Array.from({ length: 300 }, (_, world) => (world % 7) / 5), 0.8)],
      magnitudes: Float64Array.from({ length: 300 }, (_, world) => 10 + (world % 13)),
      yearsPerWorld: 10,
    };
    expect(sampleAnnualLosses({ ...inputs, seed: 's9' })).toEqual(sampleAnnualLosses({ ...inputs, seed: 's9' }));
    expect(sampleAnnualLosses({ ...inputs, seed: 's10' }).mean).not.toBe(sampleAnnualLosses({ ...inputs, seed: 's9' }).mean);
  });

  it('redraws only the years of a world whose rate moved', () => {
    const rates = Float64Array.from({ length: 1000 }, (_, world) => 0.2 + (world % 5) / 10);
    const moved = Float64Array.from(rates);
    moved[0] = 3;
    const sample = (worldRates: Float64Array) => sampleAnnualLosses({
      streams: [lossEvents(worldRates)],
      magnitudes: uniformWorlds(1000, 1000),
      yearsPerWorld: 10,
      seed: 'local',
    });
    const before = sample(rates);
    const after = sample(moved);
    expect(Math.abs(after.lossEventYearShare - before.lossEventYearShare) * before.years).toBeLessThanOrEqual(10);
  });

  it('answers zero everywhere when no event can happen', () => {
    const distribution = sampleAnnualLosses({
      streams: [lossEvents(uniformWorlds(100, 0))],
      magnitudes: uniformWorlds(100, 1000),
      yearsPerWorld: 10,
      seed: 's1',
    });
    expect(distribution.mean).toBe(0);
    expect(distribution.lossYearShare).toBe(0);
    expect(distribution.lossEventYearShare).toBe(0);
    expect(distribution.quantiles.every((quantile) => quantile.loss === 0)).toBe(true);
  });
});
