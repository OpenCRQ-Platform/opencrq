import { describe, expect, it } from 'vitest';
import type { AttackRunOutcomes } from './attack-run-evaluation';
import { mixAttackPaths } from './attack-paths-mix';

const outcomes = (parts: Partial<AttackRunOutcomes>): AttackRunOutcomes => {
  const evicted = parts.evicted ?? 0;
  const impactDetected = parts.impactDetected ?? 0;
  const impactUndetected = parts.impactUndetected ?? 0;

  return { blocked: 1 - evicted - impactDetected - impactUndetected, evicted, impactDetected, impactUndetected };
};

const reached = (probability: number): AttackRunOutcomes => outcomes({ impactUndetected: probability });

/** The issue's example: the target falls at 60 % and the direct path passes at 70 %, another asset falls at 90 % of the rest and the long path passes at 10 %. */
const issueExample = {
  doorTarget: 0.6,
  doorOther: 0.4 * 0.9,
  direct: reached(0.6 * 0.7),
  long: reached(0.36 * 0.1),
  withoutInitialAccessShare: 0,
  withoutInitialAccess: null,
};

describe('mixAttackPaths', () => {
  it("reads the issue's example as 46 % of the attacks landing an impact", () => {
    const { outcomes: mixed } = mixAttackPaths(issueExample);

    expect(mixed.impactDetected + mixed.impactUndetected).toBeCloseTo(0.456, 12);
    expect(mixed.evicted).toBe(0);
    expect(mixed.blocked).toBeCloseTo(0.544, 12);
  });

  it('shares the attacks between the paths, summing to one', () => {
    const { shares } = mixAttackPaths(issueExample);

    expect(shares.stoppedAtInitialAccess).toBeCloseTo(0.04, 12);
    expect(shares.direct).toBeCloseTo(0.6, 12);
    expect(shares.long).toBeCloseTo(0.36, 12);
    expect(shares.withoutInitialAccess).toBe(0);
    expect(shares.stoppedAtInitialAccess + shares.direct + shares.long + shares.withoutInitialAccess).toBeCloseTo(1, 12);
  });

  it('is the path without initial access alone when it takes every attack', () => {
    const around = outcomes({ evicted: 0.1, impactDetected: 0.2, impactUndetected: 0.3 });
    const { outcomes: mixed, shares } = mixAttackPaths({
      ...issueExample,
      withoutInitialAccessShare: 1,
      withoutInitialAccess: around,
    });

    expect(mixed.evicted).toBeCloseTo(0.1, 12);
    expect(mixed.impactDetected).toBeCloseTo(0.2, 12);
    expect(mixed.impactUndetected).toBeCloseTo(0.3, 12);
    expect(mixed.blocked).toBeCloseTo(0.4, 12);
    expect(shares).toEqual({ stoppedAtInitialAccess: 0, direct: 0, long: 0, withoutInitialAccess: 1 });
  });

  it('weighs the paths through the door by 1 - g and the one around it by g', () => {
    const g = 0.05;
    const direct = outcomes({ evicted: 0.1, impactDetected: 0.2, impactUndetected: 0.1 });
    const long = outcomes({ evicted: 0.05, impactDetected: 0.05, impactUndetected: 0.1 });
    const around = outcomes({ evicted: 0.2, impactDetected: 0.3, impactUndetected: 0.4 });
    const { outcomes: mixed, shares } = mixAttackPaths({
      doorTarget: 0.5,
      doorOther: 0.3,
      direct,
      long,
      withoutInitialAccessShare: g,
      withoutInitialAccess: around,
    });

    expect(mixed.evicted).toBeCloseTo(0.95 * (0.1 + 0.05) + g * 0.2, 12);
    expect(mixed.impactDetected).toBeCloseTo(0.95 * (0.2 + 0.05) + g * 0.3, 12);
    expect(mixed.impactUndetected).toBeCloseTo(0.95 * (0.1 + 0.1) + g * 0.4, 12);
    expect(shares.stoppedAtInitialAccess).toBeCloseTo(0.95 * 0.2, 12);
    expect(shares.direct).toBeCloseTo(0.95 * 0.5, 12);
    expect(shares.long).toBeCloseTo(0.95 * 0.3, 12);
    expect(shares.withoutInitialAccess).toBe(g);
  });

  it('is the long chain alone, bit for bit, when no target fell and nothing goes around the door', () => {
    const long = outcomes({ evicted: 0.1, impactDetected: 0.2, impactUndetected: 0.3 });
    const { outcomes: mixed, shares } = mixAttackPaths({
      doorTarget: 0,
      doorOther: 0.75,
      direct: null,
      long,
      withoutInitialAccessShare: 0,
      withoutInitialAccess: null,
    });

    expect(mixed).toBe(long);
    expect(shares).toEqual({ stoppedAtInitialAccess: 0.25, direct: 0, long: 0.75, withoutInitialAccess: 0 });
  });

  it('never leaves a negative blocked share when the parts sum past one by rounding', () => {
    const { outcomes: mixed } = mixAttackPaths({
      doorTarget: 0.5,
      doorOther: 0.5,
      direct: { blocked: 0, evicted: 0, impactDetected: 0.5, impactUndetected: 0.5 + 1e-12 },
      long: { blocked: 0, evicted: 0, impactDetected: 0, impactUndetected: 0 },
      withoutInitialAccessShare: 0,
      withoutInitialAccess: null,
    });

    expect(mixed.blocked).toBe(0);
  });

  it('refuses a share around the door with no partition to price it', () => {
    expect(() => mixAttackPaths({ ...issueExample, withoutInitialAccessShare: 0.05, withoutInitialAccess: null })).toThrow();
  });

  it('prices a share of one around the door with no long partition at all', () => {
    const around = reached(0.3);
    const { outcomes: mixed, shares } = mixAttackPaths({ ...issueExample, long: null, direct: null, withoutInitialAccessShare: 1, withoutInitialAccess: around });

    expect(mixed).toEqual({ ...around, blocked: 1 - 0.3 });
    expect(shares).toEqual({ stoppedAtInitialAccess: 0, direct: 0, long: 0, withoutInitialAccess: 1 });
  });

  it('refuses attacks through the initial access with no long partition to price them', () => {
    expect(() => mixAttackPaths({ ...issueExample, long: null })).toThrow();
    expect(() => mixAttackPaths({ ...issueExample, long: null, withoutInitialAccessShare: 0.5, withoutInitialAccess: reached(0.3) })).toThrow();
  });
});
