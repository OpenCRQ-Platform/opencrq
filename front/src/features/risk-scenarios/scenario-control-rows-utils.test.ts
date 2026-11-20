import { describe, expect, it } from 'vitest';
import type { ScenarioControlPosture, WhatIfEntry } from './scenario-control-rows-utils';
import { bestAleReduction, groupWhatIfByControl, isControlAtMaximum, isMaximalStep, isWhatIfStale, selectTopControls } from './scenario-control-rows-utils';

const entry = (overrides: Partial<WhatIfEntry & { controlId: string }> = {}): WhatIfEntry & { controlId: string } => ({
  controlId: 'c1',
  controlKind: 'capability',
  dimension: 'strength',
  currentStrength: 'L1',
  upgradedStrength: 'L2',
  currentCoverage: 'L2',
  upgradedCoverage: 'L2',
  aleReductionMean: 1000,
  aleReductionP10: 800,
  aleReductionP90: 1200,
  zeroReason: null,
  ...overrides,
});

describe('groupWhatIfByControl', () => {
  it('should keep only known controls and order the levers deploy, strength, coverage', () => {
    const { whatIfByControl, hasWhatIfData } = groupWhatIfByControl([
      entry({ dimension: 'coverage' }),
      entry({ dimension: 'strength' }),
      entry({ dimension: 'deploy' }),
      entry({ controlId: 'unknown' }),
    ], new Set(['c1']));

    expect(hasWhatIfData).toBe(true);
    expect([...whatIfByControl.keys()]).toEqual(['c1']);
    expect(whatIfByControl.get('c1')!.map((held) => held.dimension)).toEqual(['deploy', 'strength', 'coverage']);
  });

  it('should report no data when no row carries a priced delta', () => {
    const { hasWhatIfData } = groupWhatIfByControl([entry({ aleReductionMean: null })], new Set(['c1']));

    expect(hasWhatIfData).toBe(false);
  });
});

describe('bestAleReduction', () => {
  it('should read the best priced lever and floor at zero', () => {
    expect(bestAleReduction([entry({ aleReductionMean: -50 }), entry({ aleReductionMean: 300 })])).toBe(300);
    expect(bestAleReduction([entry({ aleReductionMean: -50 })])).toBe(0);
    expect(bestAleReduction(undefined)).toBe(0);
  });
});

const posture = (overrides: Partial<ScenarioControlPosture> = {}): ScenarioControlPosture => ({
  id: 'c1',
  strengthRung: 'L1',
  coverageBucket: 'L2',
  ...overrides,
});

describe('isWhatIfStale', () => {
  it('should flag a control whose declared state moved since the run', () => {
    const { whatIfByControl } = groupWhatIfByControl([entry()], new Set(['c1']));

    expect(isWhatIfStale([posture()], whatIfByControl)).toBe(false);
    expect(isWhatIfStale([posture({ strengthRung: 'L2' })], whatIfByControl)).toBe(true);
  });
});

describe('isControlAtMaximum', () => {
  it('should require the top rung and full coverage', () => {
    expect(isControlAtMaximum(posture({ strengthRung: 'L3', coverageBucket: 'L3' }))).toBe(true);
    expect(isControlAtMaximum(posture({ strengthRung: 'L2', coverageBucket: 'L3' }))).toBe(false);
    expect(isControlAtMaximum(posture({ strengthRung: 'L3', coverageBucket: 'L2' }))).toBe(false);
  });
});

describe('isMaximalStep', () => {
  it('should read a step with nowhere to go from the stored pair, whatever the zero reason', () => {
    expect(isMaximalStep(entry({ currentStrength: 'L3', upgradedStrength: 'L3', zeroReason: 'estate-families' }))).toBe(true);
    expect(isMaximalStep(entry({ dimension: 'coverage', currentCoverage: 'L3', upgradedCoverage: 'L3' }))).toBe(true);
    expect(isMaximalStep(entry())).toBe(false);
    expect(isMaximalStep(entry({ dimension: 'deploy', currentStrength: 'L1', upgradedStrength: 'L1' }))).toBe(false);
  });
});

describe('selectTopControls', () => {
  it('should rank priced positive levers best first, capped, and skip unnamed controls', () => {
    const { whatIfByControl } = groupWhatIfByControl([
      entry({ controlId: 'c1', dimension: 'strength', aleReductionMean: 100 }),
      entry({ controlId: 'c1', dimension: 'coverage', aleReductionMean: 400 }),
      entry({ controlId: 'c2', dimension: 'deploy', aleReductionMean: 250 }),
      entry({ controlId: 'c3', dimension: 'deploy', aleReductionMean: 900 }),
      entry({ controlId: 'c2', dimension: 'strength', aleReductionMean: 0 }),
    ], new Set(['c1', 'c2', 'c3']));

    const controlById = new Map([
      ['c1', { externalId: 'IDP', name: 'Identity Platform (IdP, SSO, MFA, Conditional Access)' }],
      ['c2', { externalId: 'EDR', name: 'Endpoint Detection and Response' }],
    ]);
    const top = selectTopControls(whatIfByControl, controlById, 2);

    expect(top.map((row) => [row.controlId, row.externalId, row.dimension, row.aleReduction])).toEqual([['c1', 'IDP', 'coverage', 400], ['c2', 'EDR', 'deploy', 250]]);
  });
});
