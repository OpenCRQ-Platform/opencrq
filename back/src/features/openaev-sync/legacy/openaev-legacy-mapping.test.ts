import { describe, expect, it, vi } from 'vitest';
import type { InjectExpectationOutput, InjectExpectationResult, OpenaevCveRawRow, RelatedFindingOutput } from './openaev-legacy-types';
import {
  aggregateByPlatformType,
  buildCveEvidenceRows,
  buildExpectationEvidenceRows,
  chunkCveRowsByAsset,
  collectCveRawRows,
  cveIdentifierOf,
} from './openaev-legacy-mapping';

const r = (sourcePlatform: string | null, score: number | null): InjectExpectationResult =>
  ({ sourceId: 'x', sourcePlatform, score });

describe('aggregateByPlatformType', () => {
  const expectedScore = 100;

  it('returns empty map for empty results', () => {
    expect(aggregateByPlatformType([], expectedScore).size).toBe(0);
  });

  it('skips results with no sourcePlatform', () => {
    const results = [r(null, 100)];
    expect(aggregateByPlatformType(results, expectedScore).size).toBe(0);
  });

  it('isExposed=false when score >= expectedScore (detected/prevented)', () => {
    const results = [r('SIEM', 100)];
    const map = aggregateByPlatformType(results, expectedScore);
    expect(map.get('SIEM')).toEqual({ isExposed: false });
  });

  it('isExposed=true when score < expectedScore (missed)', () => {
    const results = [r('SIEM', 0)];
    const map = aggregateByPlatformType(results, expectedScore);
    expect(map.get('SIEM')).toEqual({ isExposed: true });
  });

  it('takes max score when multiple results for same platform type (max wins)', () => {
    const results = [r('SIEM', 0), r('SIEM', 100)];
    const map = aggregateByPlatformType(results, expectedScore);
    expect(map.get('SIEM')).toEqual({ isExposed: false });
  });

  it('preserves per-platform-type granularity', () => {
    const results = [r('SIEM', 0), r('EDR', 100)];
    const map = aggregateByPlatformType(results, expectedScore);
    expect(map.get('SIEM')).toEqual({ isExposed: true });
    expect(map.get('EDR')).toEqual({ isExposed: false });
  });

  it('handles partial score (non-zero but below expectedScore)', () => {
    const results = [r('NDR', 50)];
    const map = aggregateByPlatformType(results, expectedScore);
    expect(map.get('NDR')).toEqual({ isExposed: true });
  });

  it('handles missing score as 0', () => {
    const results = [r('SIEM', null)];
    const map = aggregateByPlatformType(results, expectedScore);
    expect(map.get('SIEM')).toEqual({ isExposed: true });
  });

  it('trims platform keys so padded values aggregate under their family', () => {
    const map = aggregateByPlatformType([r(' SIEM ', 100)], expectedScore);
    expect(map.get('SIEM')).toEqual({ isExposed: false });
  });

  it('skips whitespace-only platforms', () => {
    expect(aggregateByPlatformType([r('   ', 100)], expectedScore).size).toBe(0);
  });
});

describe('cveIdentifierOf', () => {
  const finding = (overrides: Partial<RelatedFindingOutput> = {}): RelatedFindingOutput => ({
    finding_id: 'finding-1',
    finding_type: 'cve',
    finding_value: 'CVE-2024-1234',
    finding_assets: [{ asset_id: 'asset-1' }],
    ...overrides,
  });

  it('extracts a normal cve identifier', () => {
    expect(cveIdentifierOf(finding({ finding_value: 'CVE-2024-1234' }))).toBe('CVE-2024-1234');
  });

  it('normalises a lowercase cve identifier to uppercase', () => {
    expect(cveIdentifierOf(finding({ finding_value: 'cve-2024-1234' }))).toBe('CVE-2024-1234');
  });

  it('trims surrounding whitespace on a cve identifier', () => {
    expect(cveIdentifierOf(finding({ finding_value: '  CVE-2024-1234  ' }))).toBe('CVE-2024-1234');
  });

  it('rejects a cve value that is not an identifier', () => {
    expect(cveIdentifierOf(finding({ finding_value: 'not-a-cve' }))).toBeNull();
  });

  it('extracts a cve named in a vulnerability name', () => {
    expect(cveIdentifierOf(finding({ finding_type: 'vulnerability', finding_value: 'EternalBlue CVE-2017-0144 [vulnerable]' }))).toBe('CVE-2017-0144');
  });

  it('returns null for a vulnerability whose name carries no cve', () => {
    expect(cveIdentifierOf(finding({ finding_type: 'vulnerability', finding_value: 'EternalBlue [vulnerable]' }))).toBeNull();
  });

  it('takes the first of two cve identifiers named in a vulnerability name', () => {
    expect(cveIdentifierOf(finding({ finding_type: 'vulnerability', finding_value: 'CVE-2017-0144 and CVE-2021-1234 [vulnerable]' }))).toBe('CVE-2017-0144');
  });

  it('skips a vulnerability whose status says not vulnerable', () => {
    expect(cveIdentifierOf(finding({ finding_type: 'vulnerability', finding_value: 'Log4Shell CVE-2021-45046 [not vulnerable]' }))).toBeNull();
    expect(cveIdentifierOf(finding({ finding_type: 'vulnerability', finding_value: 'Log4Shell CVE-2021-45046 [NOT_VULNERABLE]' }))).toBeNull();
    expect(cveIdentifierOf(finding({ finding_type: 'vulnerability', finding_value: 'Log4Shell CVE-2021-45046 [not-vulnerable]' }))).toBeNull();
  });

  it('keeps a vulnerability whose status is partially vulnerable or unknown', () => {
    expect(cveIdentifierOf(finding({ finding_type: 'vulnerability', finding_value: 'Log4Shell CVE-2021-45046 [partially vulnerable]' }))).toBe('CVE-2021-45046');
    expect(cveIdentifierOf(finding({ finding_type: 'vulnerability', finding_value: 'Log4Shell CVE-2021-45046 [exploited]' }))).toBe('CVE-2021-45046');
  });

  it('ignores a cve named only in the vulnerability status', () => {
    expect(cveIdentifierOf(finding({ finding_type: 'vulnerability', finding_value: 'Missing patch [CVE-2021-1234 not detected]' }))).toBeNull();
  });

  it('ignores a cve named only in the status when the vulnerability name is empty', () => {
    expect(cveIdentifierOf(finding({ finding_type: 'vulnerability', finding_value: ' [CVE-2021-1234 not detected]' }))).toBeNull();
  });

  // The name half stops at the FIRST bracket, so a name carrying brackets of its own loses whatever
  // follows them — the price of never reading the status, which the next two cases cover.
  it('drops a bracketed segment of the vulnerability name rather than risk reading the status', () => {
    expect(cveIdentifierOf(finding({ finding_type: 'vulnerability', finding_value: 'Patch [CVE-2024-2222] [not vulnerable]' }))).toBeNull();
  });

  it('ignores a cve named in a status that carries brackets of its own', () => {
    expect(cveIdentifierOf(finding({ finding_type: 'vulnerability', finding_value: 'Missing patch [CVE-2021-1234 [not detected]]' }))).toBeNull();
  });

  it('reads no cve from a bracketed name segment that carries none', () => {
    expect(cveIdentifierOf(finding({ finding_type: 'vulnerability', finding_value: 'EternalBlue [batch 2] [vulnerable]' }))).toBeNull();
  });

  it('treats the whole value as the name when a vulnerability value carries no bracket', () => {
    expect(cveIdentifierOf(finding({ finding_type: 'vulnerability', finding_value: 'CVE-2017-0144 unbracketed' }))).toBe('CVE-2017-0144');
  });

  it('rejects an identifier glued to a longer token in a vulnerability name', () => {
    expect(cveIdentifierOf(finding({ finding_type: 'vulnerability', finding_value: 'XCVE-2024-1234 [vulnerable]' }))).toBeNull();
    expect(cveIdentifierOf(finding({ finding_type: 'vulnerability', finding_value: 'CVE-2024-1234suffix [vulnerable]' }))).toBeNull();
  });

  it('returns null for an unexpected finding type', () => {
    expect(cveIdentifierOf(finding({ finding_type: 'portscan', finding_value: 'CVE-2024-1234' }))).toBeNull();
  });

  it('returns null when the finding carries no type at all, which the schema allows', () => {
    expect(cveIdentifierOf(finding({ finding_type: undefined, finding_value: 'CVE-2024-1234' }))).toBeNull();
    expect(cveIdentifierOf(finding({ finding_type: null, finding_value: 'CVE-2024-1234' }))).toBeNull();
  });
});

describe('chunkCveRowsByAsset', () => {
  const row = (supportingAssetId: string, cveIdentifier: string): OpenaevCveRawRow => ({
    cveIdentifier,
    supportingAssetId,
    findingId: `finding-${supportingAssetId}-${cveIdentifier}`,
    injectId: null,
    simulationId: null,
    simulationName: null,
    findingUpdatedAt: null,
  });

  it('caps a chunk at the given number of assets', () => {
    const rows = ['a-1', 'a-2', 'a-3', 'a-4', 'a-5'].map((assetId) => row(assetId, 'CVE-2024-1234'));

    const chunks = chunkCveRowsByAsset(rows, 2);

    expect(chunks.map((chunk) => chunk.length)).toEqual([2, 2, 1]);
  });

  it('keeps every row of one asset in the same chunk, whatever order they arrive in', () => {
    const rows = [
      row('a-1', 'CVE-2024-1111'),
      row('a-2', 'CVE-2024-2222'),
      row('a-1', 'CVE-2024-3333'),
      row('a-3', 'CVE-2024-4444'),
    ];

    const chunks = chunkCveRowsByAsset(rows, 1);

    expect(chunks).toHaveLength(3);
    expect(chunks[0].map((cveRow) => cveRow.cveIdentifier)).toEqual(['CVE-2024-1111', 'CVE-2024-3333']);
  });

  it('returns no chunk at all for no rows', () => {
    expect(chunkCveRowsByAsset([], 10)).toEqual([]);
  });
});

describe('collectCveRawRows', () => {
  const finding = (overrides: Partial<RelatedFindingOutput> = {}): RelatedFindingOutput => ({
    finding_id: 'finding-1',
    finding_type: 'cve',
    finding_value: 'CVE-2024-1234',
    finding_assets: [{ asset_id: 'asset-1' }],
    finding_inject: { inject_id: 'inject-1' },
    ...overrides,
  });

  it('skips findings with no CVE identifier', () => {
    expect(collectCveRawRows([finding({ finding_value: undefined })])).toHaveLength(0);
  });

  it('skips a finding whose finding_type is not cve or vulnerability', () => {
    expect(collectCveRawRows([finding({ finding_type: 'portscan' })])).toHaveLength(0);
  });

  it('emits one row per (finding, asset) pair', () => {
    const rows = collectCveRawRows([finding({ finding_assets: [{ asset_id: 'asset-1' }, { asset_id: 'asset-2' }], finding_updated_at: '2026-01-15T10:00:00Z' })]);
    expect(rows).toEqual([
      { cveIdentifier: 'CVE-2024-1234', supportingAssetId: 'asset-1', findingId: 'finding-1', injectId: 'inject-1', simulationId: null, simulationName: null, findingUpdatedAt: '2026-01-15T10:00:00Z' },
      { cveIdentifier: 'CVE-2024-1234', supportingAssetId: 'asset-2', findingId: 'finding-1', injectId: 'inject-1', simulationId: null, simulationName: null, findingUpdatedAt: '2026-01-15T10:00:00Z' },
    ]);
  });

  it('defaults injectId to null when the finding has no linked inject', () => {
    const rows = collectCveRawRows([finding({ finding_inject: null })]);
    expect(rows[0].injectId).toBeNull();
  });

  it('defaults findingUpdatedAt to null when not provided', () => {
    const rows = collectCveRawRows([finding({ finding_updated_at: undefined })]);
    expect(rows[0].findingUpdatedAt).toBeNull();
  });

  it('extracts simulationId and simulationName from finding_simulation when provided', () => {
    const rows = collectCveRawRows([finding({ finding_simulation: { exercise_id: 'ex-42', exercise_name: 'Ransomware Drill' } })]);
    expect(rows[0].simulationId).toBe('ex-42');
    expect(rows[0].simulationName).toBe('Ransomware Drill');
  });

  it('defaults simulationId and simulationName to null for an atomic test finding, whose finding_simulation is absent rather than null', () => {
    const rows = collectCveRawRows([finding()]);
    expect(rows[0].simulationId).toBeNull();
    expect(rows[0].simulationName).toBeNull();
  });
});

describe('buildExpectationEvidenceRows', () => {
  const expectation = (overrides: Partial<InjectExpectationOutput> = {}): InjectExpectationOutput => ({
    inject_expectation_id: 'exp-1',
    inject_expectation_type: 'DETECTION',
    inject_expectation_status: 'FAILED',
    inject_expectation_inject: 'inject-1',
    inject_expectation_asset: 'asset-1',
    inject_expectation_expected_score: 100,
    inject_expectation_results: [{ sourceId: 'x', sourcePlatform: 'SIEM', score: 0 }],
    ...overrides,
  });

  const baseParams = {
    assetIdMap: new Map([['asset-1', 'sa-1']]),
    exerciseInjectPatterns: new Map([['inject-1', ['T1110.001']]]),
    injectTitleMap: new Map<string, string | null>(),
    techniqueIdMap: new Map([['T1110.001', 'tech-uuid-1']]),
    scenarioId: 'scenario-1',
    scenarioName: 'Credential Harvesting',
    exerciseId: 'ex-1',
    exerciseUpdatedAt: null as string | null,
    exerciseName: null as string | null,
    connectorId: 'connector-1',
  };

  it('skips expectations whose asset has no resolved supportingAssetId', () => {
    const rows = buildExpectationEvidenceRows({ ...baseParams, relevant: [expectation({ inject_expectation_asset: 'unknown-asset' })] });
    expect(rows).toHaveLength(0);
  });

  it('skips expectations whose inject has no cached attack patterns', () => {
    const rows = buildExpectationEvidenceRows({ ...baseParams, exerciseInjectPatterns: new Map(), relevant: [expectation()] });
    expect(rows).toHaveLength(0);
  });

  it('skips expectations with an unrecognised expectation type', () => {
    const rows = buildExpectationEvidenceRows({ ...baseParams, relevant: [expectation({ inject_expectation_type: 'MANUAL' })] });
    expect(rows).toHaveLength(0);
  });

  it('reports and skips techniques not found locally', () => {
    const onSkippedTechnique = vi.fn();
    const rows = buildExpectationEvidenceRows({ ...baseParams, techniqueIdMap: new Map(), relevant: [expectation()], onSkippedTechnique });
    expect(rows).toHaveLength(0);
    expect(onSkippedTechnique).toHaveBeenCalledWith('T1110.001');
  });

  it('builds one row per (technique × security platform type)', () => {
    const rows = buildExpectationEvidenceRows({
      ...baseParams,
      exerciseInjectPatterns: new Map([['inject-1', ['T1110.001', 'T1078']]]),
      techniqueIdMap: new Map([['T1110.001', 'tech-uuid-1'], ['T1078', 'tech-uuid-2']]),
      relevant: [expectation({ inject_expectation_status: 'FAILED', inject_expectation_results: [{ sourceId: 'x', sourcePlatform: 'SIEM', score: 0 }, { sourceId: 'y', sourcePlatform: 'EDR', score: 100 }] })],
    });
    expect(rows).toHaveLength(4); // 2 techniques × 2 platform types
    expect(rows.every((row) => row.cveId === null && row.supportingAssetId === 'sa-1')).toBe(true);
    expect(rows.find((row) => row.mitreTechniqueId === 'tech-uuid-1' && row.securityPlatformType === 'SIEM')).toMatchObject({ isExposed: true, expectationType: 'detection' });
    expect(rows.find((row) => row.mitreTechniqueId === 'tech-uuid-1' && row.securityPlatformType === 'EDR')).toMatchObject({ isExposed: false });
  });

  it('derives exposure from the family score even when the global status disagrees', () => {
    const rows = buildExpectationEvidenceRows({
      ...baseParams,
      relevant: [expectation({ inject_expectation_status: 'SUCCESS', inject_expectation_results: [{ sourceId: 'x', sourcePlatform: 'SIEM', score: 0 }] })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].isExposed).toBe(true);
  });

  it('gives each family its own verdict and reason when results diverge', () => {
    const rows = buildExpectationEvidenceRows({
      ...baseParams,
      relevant: [expectation({
        inject_expectation_status: 'SUCCESS',
        inject_expectation_results: [
          { sourceId: 'x', sourcePlatform: 'EDR', score: 100 },
          { sourceId: 'y', sourcePlatform: 'SIEM', score: 0 },
        ],
      })],
    });
    expect(rows).toHaveLength(2);
    const edr = rows.find((row) => row.securityPlatformType === 'EDR');
    const siem = rows.find((row) => row.securityPlatformType === 'SIEM');
    expect(edr).toMatchObject({ isExposed: false });
    expect(edr?.reason).toMatch(/^Detected by EDR/);
    expect(siem).toMatchObject({ isExposed: true });
    expect(siem?.reason).toMatch(/^Not detected by SIEM/);
  });

  it.each([null, undefined])('falls back to the status verdict when the expected score is %s', (expectedScore) => {
    const rows = buildExpectationEvidenceRows({
      ...baseParams,
      relevant: [expectation({
        inject_expectation_status: 'FAILED',
        inject_expectation_expected_score: expectedScore,
        inject_expectation_results: [{ sourceId: 'x', sourcePlatform: 'SIEM', score: 100 }],
      })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].isExposed).toBe(true);
  });

  it('keeps the status verdict for the unknown family (no scored results)', () => {
    const rows = buildExpectationEvidenceRows({
      ...baseParams,
      relevant: [expectation({ inject_expectation_status: 'SUCCESS', inject_expectation_results: [] })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ securityPlatformType: 'unknown', isExposed: false });
  });

  it('matches a padded sourcePlatform to its aggregate instead of the status fallback', () => {
    const rows = buildExpectationEvidenceRows({
      ...baseParams,
      relevant: [expectation({
        inject_expectation_status: 'FAILED',
        inject_expectation_results: [{ sourceId: 'x', sourcePlatform: ' SIEM ', score: 100 }],
      })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ securityPlatformType: 'SIEM', isExposed: false });
  });

  it('skips pending expectations (not measured yet)', () => {
    const rows = buildExpectationEvidenceRows({
      ...baseParams,
      relevant: [expectation({ inject_expectation_status: 'PENDING' })],
    });
    expect(rows).toHaveLength(0);
  });

  it('falls back to unknown securityPlatformType when sourcePlatform is missing', () => {
    const rows = buildExpectationEvidenceRows({
      ...baseParams,
      relevant: [expectation({ inject_expectation_status: 'FAILED', inject_expectation_results: [{ sourceId: 'x', sourcePlatform: null, score: 0 }] })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].securityPlatformType).toBe('unknown');
  });

  it('stamps sourceFindingId from the scenario, the one id a replay preserves', () => {
    const rows = buildExpectationEvidenceRows({ ...baseParams, relevant: [expectation({ inject_expectation_id: 'exp-42' })] });
    expect(rows[0].sourceFindingId).toBe('scenario-scenario-1');
    expect(rows[0].scope).toBe('scenario-1');
  });

  it('uses exerciseUpdatedAt as evaluatedAt when provided', () => {
    const rows = buildExpectationEvidenceRows({ ...baseParams, exerciseUpdatedAt: '2026-02-01T08:00:00Z', relevant: [expectation()] });
    expect(rows[0].evaluatedAt).toEqual(new Date('2026-02-01T08:00:00Z'));
  });

  it('falls back to the current date when exerciseUpdatedAt is null', () => {
    const before = new Date();
    const rows = buildExpectationEvidenceRows({ ...baseParams, exerciseUpdatedAt: null, relevant: [expectation()] });
    expect(rows[0].evaluatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});

describe('buildCveEvidenceRows', () => {
  const baseParams = {
    cveIdMap: new Map([['CVE-2024-1234', 'cve-uuid-1']]),
    cveAssetIdMap: new Map([['asset-1', 'sa-1']]),
    connectorId: 'connector-1',
  };
  const rawRow = {
    cveIdentifier: 'CVE-2024-1234',
    supportingAssetId: 'asset-1',
    findingId: 'finding-1',
    injectId: 'inject-1',
    simulationId: 'ex-1' as string | null,
    simulationName: null as string | null,
    findingUpdatedAt: null as string | null,
  };

  it('skips rows whose CVE could not be resolved to a UUID', () => {
    const rows = buildCveEvidenceRows({ ...baseParams, cveIdMap: new Map(), rawCveRows: [rawRow] });
    expect(rows).toHaveLength(0);
  });

  it('skips rows whose asset could not be resolved to a UUID', () => {
    const rows = buildCveEvidenceRows({ ...baseParams, cveAssetIdMap: new Map(), rawCveRows: [rawRow] });
    expect(rows).toHaveLength(0);
  });

  it('builds an evidence row with cveId set and technique fields null', () => {
    const rows = buildCveEvidenceRows({ ...baseParams, rawCveRows: [rawRow] });
    expect(rows).toEqual([
      expect.objectContaining({
        supportingAssetId: 'sa-1',
        cveId: 'cve-uuid-1',
        mitreTechniqueId: null,
        expectationType: null,
        isExposed: true,
        securityPlatformType: null,
        sourceScenarioId: null,
        sourceScenarioName: null,
        scope: 'asset-1',
        sourceSimulationId: 'ex-1',
        sourceInjectId: 'inject-1',
        connectorId: 'connector-1',
        // Stable across replays, unlike the finding id OpenAEV rebuilds with every inject.
        sourceFindingId: 'asset-1:CVE-2024-1234',
      }),
    ]);
  });

  it('uses findingUpdatedAt as evaluatedAt when provided', () => {
    const rows = buildCveEvidenceRows({ ...baseParams, rawCveRows: [{ ...rawRow, findingUpdatedAt: '2026-03-10T12:00:00Z' }] });
    expect(rows[0].evaluatedAt).toEqual(new Date('2026-03-10T12:00:00Z'));
  });

  it('falls back to the current date when findingUpdatedAt is null', () => {
    const before = new Date();
    const rows = buildCveEvidenceRows({ ...baseParams, rawCveRows: [rawRow] });
    expect(rows[0].evaluatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('names the simulation in the reason when the row carries a named simulation', () => {
    const rows = buildCveEvidenceRows({ ...baseParams, rawCveRows: [{ ...rawRow, simulationId: 'ex-1', simulationName: 'Ransomware Drill' }] });
    expect(rows[0].sourceSimulationId).toBe('ex-1');
    expect(rows[0].reason).toBe('Reported by OpenAEV in simulation Ransomware Drill');
  });

  it('falls back to the simulation id in the reason when the simulation has no name', () => {
    const rows = buildCveEvidenceRows({ ...baseParams, rawCveRows: [{ ...rawRow, simulationId: 'ex-1', simulationName: null }] });
    expect(rows[0].reason).toBe('Reported by OpenAEV in simulation ex-1');
  });

  it('drops "in simulation" from the reason and leaves sourceSimulationId null for an atomic test row', () => {
    const rows = buildCveEvidenceRows({ ...baseParams, rawCveRows: [{ ...rawRow, simulationId: null, simulationName: null }] });
    expect(rows[0].sourceSimulationId).toBeNull();
    expect(rows[0].reason).toBe('Reported by OpenAEV');
  });
});
