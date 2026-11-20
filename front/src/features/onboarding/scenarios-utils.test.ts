import { deriveSeedId } from '@app/module/client';
import { describe, expect, it } from 'vitest';
import { buildScenarioSuggestions, countComputedScenarios, hasScenarioFigure, isSuggestionChecked, readinessStepKey, resolveOutcomeKey, SCENARIO_OUTCOME_KEYS } from './scenarios-utils';

const TENANT_ID = '89c70e9a-8317-4da7-8765-1b9ba004c32c';

describe('resolveOutcomeKey', () => {
  it('names a tenant outcome row by the catalogue id it is derived from, whatever its name', () => {
    // The ids Acme Bank's rows carry, derived from the catalogue ids.
    expect(resolveOutcomeKey(TENANT_ID, 'd1a1dbbe-de60-51d6-b7c2-53c0b213dbd7')).toBe('ransomware');
    expect(resolveOutcomeKey(TENANT_ID, '1b75a102-139a-5fe3-b83c-1d35e69b7e1e')).toBe('service-disruption');
  });

  it('knows no key for an id of another tenant or of no catalogue outcome', () => {
    expect(resolveOutcomeKey('b1ceb3a3-5d1d-4d6e-8a4e-f0a0a0a0a0a0', 'd1a1dbbe-de60-51d6-b7c2-53c0b213dbd7')).toBeNull();
    expect(resolveOutcomeKey(TENANT_ID, deriveSeedId(TENANT_ID, TENANT_ID))).toBeNull();
  });
});

const OUTCOME_ROWS = {
  ransomware: { id: 'd1a1dbbe-de60-51d6-b7c2-53c0b213dbd7', name: 'Ransomware' },
  theft: { id: 'e525353b-083b-50a9-898d-e4e751601417', name: 'Data Theft Extortion' },
  espionage: { id: '3035898b-f4e7-5da9-bf9c-992d671ab7b0', name: 'Espionage' },
};

const outcomes = [OUTCOME_ROWS.espionage, OUTCOME_ROWS.theft, OUTCOME_ROWS.ransomware];

const ledger = { id: 'asset-ledger', name: 'Ledger', businessValueCategories: [{ id: 'cat-ops' }] };
const ip = { id: 'asset-ip', name: 'Designs', businessValueCategories: [{ id: 'cat-ip' }] };
const customers = { id: 'asset-customers', name: 'Customers', businessValueCategories: [{ id: 'cat-personal' }] };

const compatibleCategoryIds = {
  [OUTCOME_ROWS.ransomware.id]: ['cat-ops', 'cat-personal'],
  [OUTCOME_ROWS.theft.id]: ['cat-personal'],
  [OUTCOME_ROWS.espionage.id]: ['cat-ip'],
};

describe('buildScenarioSuggestions', () => {
  it('suggests one card per outcome reaching a primary asset, holding every asset it reaches', () => {
    const suggestions = buildScenarioSuggestions({ tenantId: TENANT_ID, outcomes, assets: [ledger, customers], compatibleCategoryIds, existing: [] });

    expect(suggestions.map((suggestion) => [suggestion.outcomeKey, suggestion.primaryAssets.map((asset) => asset.name)])).toEqual([
      ['ransomware', ['Ledger', 'Customers']],
      ['data-theft-extortion', ['Customers']],
    ]);
  });

  it('suggests nothing while the scope holds no primary asset', () => {
    expect(buildScenarioSuggestions({ tenantId: TENANT_ID, outcomes, assets: [], compatibleCategoryIds, existing: [] })).toEqual([]);
  });

  it('checks ransomware, data theft extortion, financial fraud and service disruption by default', () => {
    const suggestions = buildScenarioSuggestions({ tenantId: TENANT_ID, outcomes, assets: [ledger, customers, ip], compatibleCategoryIds, existing: [] });

    expect(suggestions.map((suggestion) => [suggestion.outcomeKey, suggestion.checkedByDefault])).toEqual([
      ['ransomware', true],
      ['data-theft-extortion', true],
      ['espionage', false],
    ]);
  });

  it('does not offer again an outcome the scope already has a scenario of', () => {
    const suggestions = buildScenarioSuggestions({
      tenantId: TENANT_ID,
      outcomes,
      assets: [ledger, customers],
      compatibleCategoryIds,
      existing: [{ attackOutcome: { id: OUTCOME_ROWS.ransomware.id } }],
    });

    expect(suggestions.map((suggestion) => suggestion.outcomeKey)).toEqual(['data-theft-extortion']);
  });

  it('does not offer an outcome again whatever the primary assets of its scenario or the ones the scope gained since', () => {
    const existing = [
      { attackOutcome: { id: OUTCOME_ROWS.ransomware.id }, primaryAssets: [{ id: 'asset-ledger' }] },
      { attackOutcome: { id: OUTCOME_ROWS.theft.id }, primaryAssets: [{ id: 'asset-other' }] },
    ];
    const suggestions = buildScenarioSuggestions({ tenantId: TENANT_ID, outcomes, assets: [ledger, customers], compatibleCategoryIds, existing });

    expect(suggestions).toEqual([]);
  });

  it('keeps an outcome of no known key, unchecked and last', () => {
    const custom = { id: 'custom-outcome', name: 'Custom outcome' };
    const suggestions = buildScenarioSuggestions({
      tenantId: TENANT_ID,
      outcomes: [custom, OUTCOME_ROWS.ransomware],
      assets: [ledger],
      compatibleCategoryIds: { ...compatibleCategoryIds, [custom.id]: ['cat-ops'] },
      existing: [],
    });

    expect(suggestions.map((suggestion) => [suggestion.outcomeKey, suggestion.checkedByDefault])).toEqual([['ransomware', true], [null, false]]);
  });
});

describe('isSuggestionChecked', () => {
  const [suggestion] = buildScenarioSuggestions({ tenantId: TENANT_ID, outcomes: [OUTCOME_ROWS.ransomware], assets: [ledger], compatibleCategoryIds, existing: [] });

  it('follows the default until the reader toggles the card', () => {
    expect(suggestion && isSuggestionChecked(suggestion, {})).toBe(true);
    expect(suggestion && isSuggestionChecked(suggestion, { [OUTCOME_ROWS.ransomware.id]: false })).toBe(false);
  });
});

describe('readinessStepKey', () => {
  it('sends a scenario of a scope that maps nothing to Assets', () => {
    expect(readinessStepKey({ status: 'no-mapped-asset', missing: [] })).toBe('assets');
  });

  it('sends a missing threat event frequency to Threats, the one a missing financial impact comes after', () => {
    expect(readinessStepKey({ status: 'incomplete', missing: ['tef', 'loss-drivers'] })).toBe('threats');
  });

  it('sends a missing financial impact to Finances', () => {
    expect(readinessStepKey({ status: 'incomplete', missing: ['loss-drivers'] })).toBe('finances');
  });

  it.each(['not-simulated', 'stale', 'ready'] as const)('sends a %s scenario to no step', (status) => {
    expect(readinessStepKey({ status, missing: [] })).toBeNull();
  });
});

describe('countComputedScenarios', () => {
  it('counts the scenarios a run priced, not those whose run has no loss figure', () => {
    expect(countComputedScenarios([{ latestRun: null }, { latestRun: { aleMean: 1 } }, { latestRun: { aleMean: null } }])).toBe(1);
  });
});

describe('hasScenarioFigure', () => {
  it('needs a run that priced the scenario over a scope that maps something', () => {
    expect(hasScenarioFigure({ noMappedAsset: false, latestRun: { aleMean: 1 } })).toBe(true);
    expect(hasScenarioFigure({ noMappedAsset: false, latestRun: { aleMean: null } })).toBe(false);
    expect(hasScenarioFigure({ noMappedAsset: false, latestRun: null })).toBe(false);
    expect(hasScenarioFigure({ noMappedAsset: true, latestRun: { aleMean: 1 } })).toBe(false);
  });
});

describe('SCENARIO_OUTCOME_KEYS', () => {
  it('holds the seven catalogue outcomes', () => {
    expect(SCENARIO_OUTCOME_KEYS).toHaveLength(7);
  });
});
