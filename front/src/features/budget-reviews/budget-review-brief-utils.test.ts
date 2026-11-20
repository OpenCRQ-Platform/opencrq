import { describe, expect, it } from 'vitest';
import type { BriefInput } from './budget-review-brief-utils';
import type { ReviewToleranceScenario } from './budget-review-tolerance-utils';
import { briefClauses, spentByNature, toleranceFigure } from './budget-review-brief-utils';

const input = (overrides: Partial<BriefInput> = {}): BriefInput => ({
  lineCount: 3,
  buildLineCount: 2,
  build: { state: 'priced', aleReductionMean: 5_200_000 },
  tolerance: { figure: 'assessed', state: 'priced', broughtBack: 1 },
  ...overrides,
});

describe('briefClauses', () => {
  it('states the spend, the loss the build work removes and the scenarios it brings back', () => {
    expect(briefClauses(input())).toEqual({ spent: true, build: 'removes', tolerance: true });
  });

  it('drops the build clause, and the tolerance one with it, without a build line', () => {
    expect(briefClauses(input({ buildLineCount: 0, build: undefined }))).toEqual({ spent: true, build: 'none', tolerance: false });
  });

  it('states no spend without any line', () => {
    expect(briefClauses(input({ lineCount: 0, buildLineCount: 0, build: undefined }))).toEqual({ spent: false, build: 'none', tolerance: false });
  });

  it('drops the tolerance clause when no tolerance is set or no scenario is assessed against one', () => {
    expect(briefClauses(input({ tolerance: { figure: 'no-tolerance', state: 'priced', broughtBack: 0 } })).tolerance).toBe(false);
    expect(briefClauses(input({ tolerance: { figure: 'not-assessed', state: 'priced', broughtBack: 0 } })).tolerance).toBe(false);
    expect(briefClauses(input({ tolerance: undefined })).tolerance).toBe(false);
  });

  it('states no stale amount while the build figure is expired or not priced', () => {
    for (const state of ['expired', 'not-priced'] as const) {
      expect(briefClauses(input({ build: { state, aleReductionMean: 5_200_000 }, tolerance: { figure: 'assessed', state, broughtBack: 1 } })))
        .toEqual({ spent: true, build: 'unpriced', tolerance: false });
    }
    expect(briefClauses(input({ build: undefined })).build).toBe('unpriced');
    expect(briefClauses(input({ build: { state: 'priced', aleReductionMean: null } })).build).toBe('unpriced');
  });

  it('says a build work that raises the annual loss does so, and draws no tolerance claim from it', () => {
    expect(briefClauses(input({ build: { state: 'priced', aleReductionMean: -300_000 } }))).toEqual({ spent: true, build: 'raises', tolerance: false });
  });

  it('draws no tolerance claim from work that brings no scenario back', () => {
    expect(briefClauses(input({ tolerance: { figure: 'assessed', state: 'priced', broughtBack: 0 } }))).toEqual({ spent: true, build: 'removes', tolerance: false });
  });

  it('reads a loss avoided of exactly zero as unchanged, never as removing nothing', () => {
    expect(briefClauses(input({ build: { state: 'priced', aleReductionMean: 0 } }))).toEqual({ spent: true, build: 'unchanged', tolerance: false });
  });

  it('keeps the tolerance clause off a tolerance reading that is out of date', () => {
    expect(briefClauses(input({ tolerance: { figure: 'assessed', state: 'expired', broughtBack: 1 } })).tolerance).toBe(false);
  });
});

const TOLERANCE = { annualLoss: 2_000_000, maxExceedanceProbability: 0.05, source: 'scope' as const };
const reading = (probability: number) => ({ probability, beyondTail: false, curve: [] });
const scenario = (overrides: Partial<ReviewToleranceScenario> = {}): ReviewToleranceScenario => ({
  scenarioId: 'id',
  name: 'Ransomware',
  tolerance: TOLERANCE,
  reference: reading(0.03),
  withoutBuild: reading(0.09),
  olderThanHeadline: false,
  ...overrides,
});

describe('toleranceFigure', () => {
  it('reads no tolerance when no scenario applies one', () => {
    expect(toleranceFigure([scenario({ tolerance: null })])).toBe('no-tolerance');
    expect(toleranceFigure([])).toBe('no-tolerance');
  });

  it('reads not assessed when a tolerance applies but no scenario carries both readings', () => {
    expect(toleranceFigure([scenario({ reference: null })])).toBe('not-assessed');
  });

  it('reads assessed otherwise', () => {
    expect(toleranceFigure([scenario(), scenario({ tolerance: null })])).toBe('assessed');
  });
});

describe('spentByNature', () => {
  it('adds the lines up by nature and in all', () => {
    expect(spentByNature([
      { nature: 'build', amountSpent: 900_000 },
      { nature: 'build', amountSpent: 500_000 },
      { nature: 'run', amountSpent: 2_600_000 },
    ])).toEqual({ build: 1_400_000, run: 2_600_000, total: 4_000_000 });
  });
});
