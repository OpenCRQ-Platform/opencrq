import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { canRunScenario, generateScenarioName, isControlDeployed, resolveAssetNames, showsDeclaredNotDeployed } from './risk-scenario-utils';

describe('generateScenarioName', () => {
  beforeAll(() => {
    i18n.load('en', {});
    i18n.activate('en');
  });

  it('should generate name with single asset', () => {
    expect(generateScenarioName({
      outcomeName: 'Data Breach',
      assetNames: ['CRM Database'],
    })).toBe('Data Breach on CRM Database');
  });

  it('should generate name with multiple assets', () => {
    expect(generateScenarioName({
      outcomeName: 'Data Breach',
      assetNames: ['CRM Database', 'ERP System'],
    })).toBe('Data Breach on CRM Database, ERP System');
  });

  it('should return null when outcome is missing', () => {
    expect(generateScenarioName({
      assetNames: ['CRM Database'],
    })).toBeNull();
  });

  it('should return null when assets are empty', () => {
    expect(generateScenarioName({
      outcomeName: 'Data Breach',
      assetNames: [],
    })).toBeNull();
  });

  it('should return null when assets are missing', () => {
    expect(generateScenarioName({
      outcomeName: 'Data Breach',
    })).toBeNull();
  });

  it('should return null when all parts are missing', () => {
    expect(generateScenarioName({})).toBeNull();
  });
});

describe('resolveAssetNames', () => {
  const primaryAssets = [
    { id: 'pa1', name: 'Customer Data' },
    { id: 'pa2', name: 'Financial Records' },
    { id: 'pa3', name: 'HR Data' },
  ];

  it('should resolve single asset name', () => {
    expect(resolveAssetNames(['pa1'], primaryAssets)).toEqual(['Customer Data']);
  });

  it('should resolve multiple asset names', () => {
    expect(resolveAssetNames(['pa1', 'pa3'], primaryAssets)).toEqual(['Customer Data', 'HR Data']);
  });

  it('should return empty array for empty IDs', () => {
    expect(resolveAssetNames([], primaryAssets)).toEqual([]);
  });

  it('should filter out unknown IDs', () => {
    expect(resolveAssetNames(['pa1', 'unknown'], primaryAssets)).toEqual(['Customer Data']);
  });

  it('should return empty array when assets list is undefined', () => {
    expect(resolveAssetNames(['pa1'], undefined)).toEqual([]);
  });
});

describe('canRunScenario', () => {
  const runnable = { hasScope: true, noMappedAsset: false, isLoadingMixture: false, isMixturePending: false };

  it('should allow a run once the scope maps assets and the mixture is stored', () => {
    expect(canRunScenario(runnable)).toBe(true);
  });

  it.each([
    ['the scope is unanswered', { hasScope: false }],
    ['the scope maps no asset', { noMappedAsset: true }],
    ['the mixture read is loading', { isLoadingMixture: true }],
    ['the mixture is pending', { isMixturePending: true }],
  ])('should hold the run while %s', (_, change) => {
    expect(canRunScenario({ ...runnable, ...change })).toBe(false);
  });
});

describe('isControlDeployed', () => {
  it('should read as deployed above the baseline on both axes', () => {
    expect(isControlDeployed('L1', 'L1')).toBe(true);
  });

  it('should read as not deployed at the floor rung', () => {
    expect(isControlDeployed('L0', 'L3')).toBe(false);
  });

  it('should read as not deployed with no coverage', () => {
    expect(isControlDeployed('L3', 'L0')).toBe(false);
  });
});

describe('showsDeclaredNotDeployed', () => {
  it('should badge a control somebody declared at the floor', () => {
    expect(showsDeclaredNotDeployed(false, true)).toBe(true);
  });

  it('should not badge a control nobody ever declared', () => {
    expect(showsDeclaredNotDeployed(false, false)).toBe(false);
  });

  it('should not badge a deployed control', () => {
    expect(showsDeclaredNotDeployed(true, true)).toBe(false);
  });
});

describe('an undeclared control on the risk-scenario controls tab', () => {
  const undeclared = { strengthRung: 'L0' as const, coverageBucket: 'L0' as const, isAssessed: false };

  it('should still contribute nothing to the simulation', () => {
    expect(isControlDeployed(undeclared.strengthRung, undeclared.coverageBucket)).toBe(false);
  });

  it('should never read as a declaration nobody made', () => {
    const isDeployed = isControlDeployed(undeclared.strengthRung, undeclared.coverageBucket);
    expect(showsDeclaredNotDeployed(isDeployed, undeclared.isAssessed)).toBe(false);
  });
});
