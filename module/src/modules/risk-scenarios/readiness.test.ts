import { describe, expect, it } from 'vitest';
import { computeScenarioReadiness } from './readiness';

const RUN_AT = new Date('2026-07-10T00:00:00.000Z');
const BEFORE_RUN = new Date('2026-07-01T00:00:00.000Z');
const AFTER_RUN = new Date('2026-07-20T00:00:00.000Z');

describe('computeScenarioReadiness', () => {
  it('should report ready when every input predates the last run', () => {
    expect(computeScenarioReadiness({
      noMappedAsset: false,
      lastRunAt: RUN_AT,
      tefUpdatedAt: BEFORE_RUN,
      lossDriversUpdatedAt: BEFORE_RUN,
    })).toEqual({ status: 'ready', missing: [], outdated: [] });
  });

  it('should report not-simulated when inputs are complete but no run exists', () => {
    expect(computeScenarioReadiness({
      noMappedAsset: false,
      lastRunAt: null,
      tefUpdatedAt: BEFORE_RUN,
      lossDriversUpdatedAt: BEFORE_RUN,
    })).toEqual({ status: 'not-simulated', missing: [], outdated: [] });
  });

  it('should report incomplete and name every missing input', () => {
    expect(computeScenarioReadiness({
      noMappedAsset: false,
      lastRunAt: RUN_AT,
      tefUpdatedAt: null,
      lossDriversUpdatedAt: null,
    })).toEqual({ status: 'incomplete', missing: ['tef', 'loss-drivers'], outdated: [] });
  });

  it('should prefer incomplete over stale when one input is missing and the other drifted', () => {
    expect(computeScenarioReadiness({
      noMappedAsset: false,
      lastRunAt: RUN_AT,
      tefUpdatedAt: null,
      lossDriversUpdatedAt: AFTER_RUN,
    })).toEqual({ status: 'incomplete', missing: ['tef'], outdated: ['loss-drivers'] });
  });

  it('should prefer incomplete over not-simulated when no run exists and an input is missing', () => {
    expect(computeScenarioReadiness({
      noMappedAsset: false,
      lastRunAt: null,
      tefUpdatedAt: null,
      lossDriversUpdatedAt: BEFORE_RUN,
    })).toEqual({ status: 'incomplete', missing: ['tef'], outdated: [] });
  });

  it('should report stale and name only the inputs edited after the run', () => {
    expect(computeScenarioReadiness({
      noMappedAsset: false,
      lastRunAt: RUN_AT,
      tefUpdatedAt: AFTER_RUN,
      lossDriversUpdatedAt: BEFORE_RUN,
    })).toEqual({ status: 'stale', missing: [], outdated: ['tef'] });
  });

  it('should not report an auto-mode frequency with no stored estimate yet as missing', () => {
    expect(computeScenarioReadiness({
      noMappedAsset: false,
      lastRunAt: null,
      tefUpdatedAt: null,
      lossDriversUpdatedAt: BEFORE_RUN,
      tefDerivedOnRead: true,
    })).toEqual({ status: 'not-simulated', missing: [], outdated: [] });
  });

  it('should still read a stored auto-mode estimate newer than the run as outdated', () => {
    expect(computeScenarioReadiness({
      noMappedAsset: false,
      lastRunAt: RUN_AT,
      tefUpdatedAt: AFTER_RUN,
      lossDriversUpdatedAt: BEFORE_RUN,
      tefDerivedOnRead: true,
    })).toEqual({ status: 'stale', missing: [], outdated: ['tef'] });
  });

  it('should keep reporting missing loss drivers when only the frequency is derived on read', () => {
    expect(computeScenarioReadiness({
      noMappedAsset: false,
      lastRunAt: null,
      tefUpdatedAt: null,
      lossDriversUpdatedAt: null,
      tefDerivedOnRead: true,
    })).toEqual({ status: 'incomplete', missing: ['loss-drivers'], outdated: [] });
  });

  it('should prefer no-mapped-asset over every other status', () => {
    expect(computeScenarioReadiness({
      noMappedAsset: true,
      lastRunAt: RUN_AT,
      tefUpdatedAt: null,
      lossDriversUpdatedAt: AFTER_RUN,
    })).toEqual({ status: 'no-mapped-asset', missing: ['tef'], outdated: ['loss-drivers'] });
  });

  it('should not report an input edited at the exact run instant as outdated', () => {
    expect(computeScenarioReadiness({
      noMappedAsset: false,
      lastRunAt: RUN_AT,
      tefUpdatedAt: RUN_AT,
      lossDriversUpdatedAt: RUN_AT,
    })).toEqual({ status: 'ready', missing: [], outdated: [] });
  });
});
