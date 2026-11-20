import { describe, expect, it } from 'vitest';
import { exerciseOutputSchema, injectExpectationOutputSchema, injectSchema, relatedFindingOutputSchema } from './openaev-legacy-types';

/**
 * OpenAEV serialises with Jackson's default inclusion (no `@JsonInclude(NON_NULL)` on the
 * models, no `default-property-inclusion` in its config), so every unset field arrives as an
 * explicit JSON null rather than being omitted. These fixtures mirror that wire format.
 */
describe('legacy response schemas', () => {
  it('parses an expectations payload whose collectors have not reported yet', () => {
    const raw = [{
      inject_expectation_id: 'exp-1',
      inject_expectation_type: 'DETECTION',
      inject_expectation_status: 'PENDING',
      inject_expectation_inject: 'inject-1',
      inject_expectation_asset: 'asset-1',
      inject_expectation_score: null,
      inject_expectation_expected_score: 100,
      inject_expectation_results: [
        { sourceId: 'collector-1', sourceType: 'COLLECTOR', sourceName: 'EDR collector', sourceAssetId: 'sp-1', sourcePlatform: 'EDR', date: '2026-08-19T00:00:00Z', score: 100, result: 'Detected', metadata: null },
        { sourceId: 'collector-2', sourceType: 'COLLECTOR', sourceName: 'SIEM collector', sourceAssetId: 'sp-2', sourcePlatform: 'SIEM', date: null, score: null, result: null, metadata: null },
      ],
    }];

    const parsed = injectExpectationOutputSchema.array().parse(raw);

    expect(parsed[0].inject_expectation_results).toHaveLength(2);
    expect(parsed[0].inject_expectation_results[1]).toMatchObject({ sourcePlatform: 'SIEM', score: null, result: null });
  });

  it('parses a manual expectation whose result stays null until a player validates it', () => {
    const raw = [{
      inject_expectation_id: 'exp-manual',
      inject_expectation_type: 'MANUAL',
      inject_expectation_status: 'PENDING',
      inject_expectation_inject: 'inject-1',
      inject_expectation_asset: null,
      inject_expectation_score: null,
      inject_expectation_expected_score: 100,
      inject_expectation_results: [
        { sourceId: 'player-manual-validation', sourceType: 'player-manual-validation', sourceName: 'Player Manual Validation', sourceAssetId: null, sourcePlatform: null, date: '2026-08-19T00:00:00Z', score: null, result: null, metadata: null },
      ],
    }];

    expect(() => injectExpectationOutputSchema.array().parse(raw)).not.toThrow();
  });

  it('parses a simulation that is not attached to any scenario', () => {
    const parsed = exerciseOutputSchema.parse({ exercise_id: 'ex-1', exercise_scenario: null });
    expect(parsed.exercise_scenario ?? 'ex-1').toBe('ex-1');
  });

  it('parses an inject with no attack pattern and no title', () => {
    const parsed = injectSchema.parse({ inject_id: 'inject-1', inject_title: null });
    expect(parsed.inject_attack_patterns).toEqual([]);
    expect(parsed.inject_title).toBeNull();
  });

  it('parses a finding of an atomic test, which carries no simulation at all', () => {
    const parsed = relatedFindingOutputSchema.parse({
      finding_id: 'finding-1',
      finding_type: 'cve',
      finding_value: 'CVE-2024-1234',
      finding_assets: [{ asset_id: 'asset-1' }],
      finding_inject: { inject_id: 'inject-atomic-1' },
    });
    expect(parsed.finding_simulation).toBeUndefined();
  });
});
