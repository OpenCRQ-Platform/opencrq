import { describe, expect, it, vi } from 'vitest';
import type { ConnectorAssetInput } from '@app/module';
import type { AiTargetAsset, AssetInventoryRow, AttackObservation, EndpointEntity, VulnerabilityObservation } from './openaev-types';
import {
  agentIdentityOf,
  aiTargetToProperties,
  assetToConnectorInput,
  buildAttackEvidenceRows,
  buildVulnerabilityEvidenceRows,
  cveIdentifierOfObservation,
  descriptionOf,
  endpointToMachineProperties,
  enrichmentRouteOf,
  mapExpectationType,
  mapOpenaevCriticality,
  mergeAiTargetDetail,
  mergeMachineDetail,
  resolveOpenaevCategory,
} from './openaev-mapping-utils';

describe('resolveOpenaevCategory', () => {
  const ep = (overrides: Partial<AssetInventoryRow> = {}): AssetInventoryRow => ({
    asset_id: 'asset-1',
    ...overrides,
  });

  it.each([
    'host',
    'container_workload',
    'cloud_resource',
    'web_application',
    'network_device',
    'mobile_device',
    'iot_ot_device',
    'identity',
    'saas_application',
    'ai_target',
    'security_platform',
    'generic_asset',
  ])('reads the declared asset_category %s verbatim', (category) => {
    expect(resolveOpenaevCategory(ep({ asset_category: category })).categoryId).toBe(category);
  });

  it('accepts the declared asset_category in any case', () => {
    expect(resolveOpenaevCategory(ep({ asset_category: 'IOT_OT_DEVICE' })).categoryId).toBe('iot_ot_device');
  });

  it('lets the declared asset_category win over endpoint_platform', () => {
    expect(resolveOpenaevCategory(ep({ asset_category: 'identity', endpoint_platform: 'Linux' })).categoryId)
      .toBe('identity');
  });

  it('syncs a SECURITY_PLATFORM asset as security_platform with its subcategory, never as a host from its platform', () => {
    expect(resolveOpenaevCategory(ep({ asset_category: 'SECURITY_PLATFORM', asset_subcategory: 'EDR', endpoint_platform: 'Linux' })))
      .toEqual({ categoryId: 'security_platform', subcategoryId: 'edr' });
  });

  it.each([
    ['Linux', 'host'],
    ['Windows', 'host'],
    ['MacOS', 'host'],
    ['macos', 'host'],
    ['Container', 'container_workload'],
    ['Service', 'saas_application'],
    ['Android', 'mobile_device'],
    ['iOS', 'mobile_device'],
  ])('falls back to the endpoint_platform switch: %s → %s', (platform, expected) => {
    expect(resolveOpenaevCategory(ep({ endpoint_platform: platform })).categoryId).toBe(expected);
  });

  it('falls through to the platform switch when asset_category is unknown', () => {
    expect(resolveOpenaevCategory(ep({ asset_category: 'not_a_family', endpoint_platform: 'Windows' })).categoryId)
      .toBe('host');
  });

  it('returns generic_asset when neither field is usable', () => {
    expect(resolveOpenaevCategory(ep({ asset_category: 'not_a_family', endpoint_platform: 'Unknown' })).categoryId)
      .toBe('generic_asset');
    expect(resolveOpenaevCategory(ep({ endpoint_platform: null })).categoryId).toBe('generic_asset');
    expect(resolveOpenaevCategory(ep()).categoryId).toBe('generic_asset');
  });

  it.each([
    ['SERVER', 'server'],
    ['LLM_MODEL', 'llm_model'],
  ])('reads the declared asset_subcategory %s verbatim', (subcategory, expected) => {
    expect(resolveOpenaevCategory(ep({ asset_subcategory: subcategory })).subcategoryId).toBe(expected);
  });

  it('resolves subcategoryId to null when absent or unrecognised', () => {
    expect(resolveOpenaevCategory(ep()).subcategoryId).toBeNull();
    expect(resolveOpenaevCategory(ep({ asset_subcategory: 'not_a_subcategory' })).subcategoryId).toBeNull();
  });
});

describe('mapExpectationType', () => {
  it('maps DETECTION → detection', () => {
    expect(mapExpectationType('DETECTION')).toBe('detection');
  });

  it('maps PREVENTION → prevention', () => {
    expect(mapExpectationType('PREVENTION')).toBe('prevention');
  });

  it('is case-insensitive', () => {
    expect(mapExpectationType('detection')).toBe('detection');
    expect(mapExpectationType('prevention')).toBe('prevention');
    expect(mapExpectationType('Detection')).toBe('detection');
  });

  it('returns null for unknown types', () => {
    expect(mapExpectationType('VULNERABILITY')).toBeNull();
    expect(mapExpectationType('MANUAL')).toBeNull();
    expect(mapExpectationType('')).toBeNull();
  });
});

describe('mapOpenaevCriticality', () => {
  it('keeps very_high apart from high', () => {
    expect(mapOpenaevCriticality('VERY_HIGH')).toBe('very_high');
    expect(mapOpenaevCriticality('HIGH')).toBe('high');
  });

  it('reads an unforeseen critical as the severer of the two top bands', () => {
    expect(mapOpenaevCriticality('CRITICAL')).toBe('very_high');
  });

  it('maps medium and low verbatim', () => {
    expect(mapOpenaevCriticality('MEDIUM')).toBe('medium');
    expect(mapOpenaevCriticality('LOW')).toBe('low');
  });

  it('is case-insensitive', () => {
    expect(mapOpenaevCriticality('very_high')).toBe('very_high');
  });

  it('defaults to unknown for null, undefined or an unrecognised value', () => {
    expect(mapOpenaevCriticality(null)).toBe('unknown');
    expect(mapOpenaevCriticality(undefined)).toBe('unknown');
    expect(mapOpenaevCriticality('not_a_level')).toBe('unknown');
  });
});

describe('assetToConnectorInput', () => {
  const row = (overrides: Partial<AssetInventoryRow> = {}): AssetInventoryRow => ({
    asset_id: 'asset-1',
    asset_name: 'my-asset',
    asset_category: 'ai_target',
    ...overrides,
  });

  it('builds the common part with no properties block', () => {
    const { input } = assetToConnectorInput(row(), 'connector-1', new Map());
    expect(input).toMatchObject({
      sourceAssetId: 'asset-1',
      categoryId: 'ai_target',
      connectorId: 'connector-1',
      source: 'openaev',
      name: 'my-asset',
    });
    expect(input.properties).toBeUndefined();
  });

  it('maps exposure, criticality, subcategory and externalReference', () => {
    const { input } = assetToConnectorInput(row({
      asset_internet_facing: true,
      asset_criticality: 'VERY_HIGH',
      asset_subcategory: 'LLM_MODEL',
      asset_external_reference: 'ext-42',
    }), 'connector-1', new Map());
    expect(input.exposure).toBe('internet_facing');
    expect(input.criticality).toBe('very_high');
    expect(input.subcategoryId).toBe('llm_model');
    expect(input.externalReference).toBe('ext-42');
  });

  it('resolves reported tag ids through the tag map, dropping ids the map has no entry for', () => {
    const tagMap = new Map([['openaev-tag-1', 'our-tag-1'], ['openaev-tag-2', 'our-tag-2']]);
    const { tagIds } = assetToConnectorInput(
      row({ asset_tags: ['openaev-tag-1', 'openaev-tag-unknown', 'openaev-tag-2'] }),
      'connector-1',
      tagMap,
    );
    expect(tagIds).toEqual(['our-tag-1', 'our-tag-2']);
  });

  it('returns an empty tagIds array when the asset reports none', () => {
    const { tagIds } = assetToConnectorInput(row(), 'connector-1', new Map());
    expect(tagIds).toEqual([]);
  });

  it('takes lastSeenAt from the most recent agent_last_seen, as the findings-driven path did', () => {
    const { input } = assetToConnectorInput(row({
      asset_agents: [{ agent_last_seen: '2026-01-01T00:00:00Z' }, { agent_last_seen: '2026-03-01T00:00:00Z' }],
    }), 'connector-1', new Map());
    expect(input.lastSeenAt).toEqual(new Date('2026-03-01T00:00:00Z'));
  });

  it('leaves lastSeenAt null for an asset reporting no agent at all', () => {
    expect(assetToConnectorInput(row(), 'connector-1', new Map()).input.lastSeenAt).toBeNull();
  });
});

describe('descriptionOf', () => {
  it('reads the description the detail calls serve, trimming it', () => {
    expect(descriptionOf({ asset_description: '  The payroll batch server.  ' })).toBe('The payroll batch server.');
  });

  it('reads a blank or absent description as null', () => {
    expect(descriptionOf({ asset_description: '   ' })).toBeNull();
    expect(descriptionOf({})).toBeNull();
  });
});

describe('endpointToMachineProperties', () => {
  const endpointEntity = (overrides: Partial<EndpointEntity> = {}): EndpointEntity => ({
    asset_id: 'asset-1',
    ...overrides,
  });

  it('carries hostname, IPs, MACs and seen IP — the fields /assets/search never serves', () => {
    const properties = endpointToMachineProperties(endpointEntity({
      asset_hostname: 'srv01',
      asset_ips: ['10.0.0.5'],
      asset_mac_addresses: ['aa:bb:cc:dd:ee:ff'],
      asset_seen_ip: '10.0.0.6',
    }));
    expect(properties).toMatchObject({
      family: 'machine',
      hostname: 'srv01',
      ipAddresses: ['10.0.0.5'],
      macAddresses: ['aa:bb:cc:dd:ee:ff'],
      seenIp: '10.0.0.6',
    });
  });

  it('maps a recognised arch and degrades an unrecognised one to null', () => {
    expect(endpointToMachineProperties(endpointEntity({ endpoint_arch: 'x86_64' })).arch).toBe('x86_64');
    expect(endpointToMachineProperties(endpointEntity({ endpoint_arch: 'Unknown' })).arch).toBeNull();
    expect(endpointToMachineProperties(endpointEntity({ endpoint_arch: null })).arch).toBeNull();
  });

  it('prefers the MDE-qualified agent for the external reference', () => {
    const properties = endpointToMachineProperties(endpointEntity({
      asset_agents: [
        { agent_external_reference: 'crowdstrike-ref', agent_executor: { executor_type: 'crowdstrike' } },
        { agent_external_reference: 'defender-device-id', agent_executor: { executor_type: 'mde_executor' } },
      ],
    }));
    expect(properties.agentExternalReference).toBe('defender-device-id');
    expect(properties.agentExecutorType).toBe('mde_executor');
  });

  it('leaves isEol null when the field is absent', () => {
    expect(endpointToMachineProperties(endpointEntity()).isEol).toBeNull();
  });

  it('carries endpoint_is_eol through when reported', () => {
    expect(endpointToMachineProperties(endpointEntity({ endpoint_is_eol: true })).isEol).toBe(true);
  });
});

describe('aiTargetToProperties', () => {
  const aiTarget = (overrides: Partial<AiTargetAsset> = {}): AiTargetAsset => ({
    asset_id: 'asset-1',
    ...overrides,
  });

  it('maps provider, endpoint, model, modality and system prompt', () => {
    const properties = aiTargetToProperties(aiTarget({
      ai_target_provider: 'ANTHROPIC',
      ai_target_endpoint: 'https://api.anthropic.com/v1/messages',
      ai_target_model: 'claude-opus-5',
      ai_target_modality: 'TEXT',
      ai_target_system_prompt: 'You are a helpful assistant.',
    }));
    expect(properties).toEqual({
      family: 'ai_target',
      provider: 'anthropic',
      endpointUrl: 'https://api.anthropic.com/v1/messages',
      model: 'claude-opus-5',
      modality: 'text',
      systemPrompt: 'You are a helpful assistant.',
    });
  });

  it('degrades an unrecognised provider or modality to null instead of throwing', () => {
    const properties = aiTargetToProperties(aiTarget({ ai_target_provider: 'NOT_A_PROVIDER', ai_target_modality: 'NOT_A_MODALITY' }));
    expect(properties.provider).toBeNull();
    expect(properties.modality).toBeNull();
  });

  it('never carries a token or configuration field — the type has none to hold them', () => {
    const properties = aiTargetToProperties(aiTarget({ ai_target_provider: 'OPENAI_COMPATIBLE' }));
    expect(properties).not.toHaveProperty('ai_target_token');
    expect(properties).not.toHaveProperty('ai_target_configuration');
  });
});

describe('enrichmentRouteOf', () => {
  it('routes an endpoint row to the batch endpoint call, whatever its category', () => {
    (['HOST', 'CLOUD_RESOURCE', 'NETWORK_DEVICE', 'WEB_APPLICATION'] as const).forEach((category) => {
      expect(enrichmentRouteOf({ asset_type: 'endpoint', asset_category: category })).toBe('endpoint');
    });
  });

  it('routes a machine-family category stored as a generic asset to the overview call, not to /endpoints/find', () => {
    expect(enrichmentRouteOf({ asset_type: 'asset', asset_category: 'CLOUD_RESOURCE' })).toBe('overview');
    expect(enrichmentRouteOf({ asset_type: 'asset', asset_category: 'NETWORK_DEVICE' })).toBe('overview');
  });

  it('routes an AI target to its own batch call', () => {
    expect(enrichmentRouteOf({ asset_type: 'ai_target', asset_category: 'AI_TARGET' })).toBe('ai_target');
  });

  it('falls back to the overview call when the discriminator is absent', () => {
    expect(enrichmentRouteOf({ asset_category: 'IDENTITY' })).toBe('overview');
    expect(enrichmentRouteOf({})).toBe('overview');
  });
});

describe('mergeMachineDetail', () => {
  const base: ConnectorAssetInput = {
    sourceAssetId: 'asset-1',
    categoryId: 'host',
    connectorId: 'connector-1',
    source: 'openaev',
    name: 'srv-01',
    exposure: 'internal',
    criticality: 'unknown',
    lastSeenAt: new Date('2026-01-01T00:00:00Z'),
  };
  const detail: EndpointEntity = {
    asset_id: 'asset-1',
    asset_description: '  A description  ',
    asset_hostname: 'srv-01.internal',
    asset_ips: ['10.0.0.5'],
  };

  it('carries the description and the machine property block from the detail row', () => {
    const merged = mergeMachineDetail(base, detail);
    expect(merged.description).toBe('A description');
    expect(merged.properties).toMatchObject({ family: 'machine', hostname: 'srv-01.internal', ipAddresses: ['10.0.0.5'] });
  });

  it('leaves every other field of the inventory-derived input untouched, lastSeenAt included', () => {
    const merged = mergeMachineDetail(base, detail);
    expect(merged.sourceAssetId).toBe('asset-1');
    expect(merged.categoryId).toBe('host');
    expect(merged.lastSeenAt).toEqual(new Date('2026-01-01T00:00:00Z'));
  });
});

describe('mergeAiTargetDetail', () => {
  const base: ConnectorAssetInput = {
    sourceAssetId: 'asset-2',
    categoryId: 'ai_target',
    connectorId: 'connector-1',
    source: 'openaev',
    name: 'gpt-agent',
    exposure: 'internal',
    criticality: 'unknown',
    lastSeenAt: null,
  };
  const detail: AiTargetAsset = {
    asset_id: 'asset-2',
    asset_description: 'An AI target',
    ai_target_provider: 'ANTHROPIC',
    ai_target_endpoint: 'https://api.anthropic.com/v1',
    ai_target_model: 'claude',
  };

  it('carries the description and the AI target property block from the detail row', () => {
    const merged = mergeAiTargetDetail(base, detail);
    expect(merged.description).toBe('An AI target');
    expect(merged.properties).toMatchObject({ family: 'ai_target', provider: 'anthropic', model: 'claude' });
  });

  it('leaves the inventory-derived lastSeenAt untouched, even though the detail row carries none', () => {
    expect(mergeAiTargetDetail(base, detail).lastSeenAt).toBeNull();
  });
});

describe('buildAttackEvidenceRows', () => {
  const observation = (overrides: Partial<AttackObservation> = {}): AttackObservation => ({
    id: 'obs-1',
    updated_at: '2026-05-02T10:00:00Z',
    asset_id: 'asset-1',
    scenario_id: 'scenario-1',
    scenario_name: 'Credential Harvesting',
    last_simulation_id: 'sim-1',
    last_simulation_name: 'Spring Drill',
    last_simulation_start_date: '2026-05-01T09:00:00Z',
    last_simulation_status: 'FINISHED',
    last_inject_id: 'inject-1',
    attack_pattern_external_id: 'T1110.001',
    expectation_type: 'DETECTION',
    expectation_status: 'FAILED',
    platform_types_reporting: ['SIEM'],
    platform_types_succeeded: [],
    last_verified_at: '2026-05-02T09:30:00Z',
    ...overrides,
  });

  const baseParams = {
    assetIdMap: new Map([['asset-1', 'sa-1']]),
    techniqueIdMap: new Map([['T1110.001', 'tech-uuid-1']]),
    connectorId: 'connector-1',
  };

  it('builds the evidence row with the scenario identity and the simulation provenance', () => {
    const rows = buildAttackEvidenceRows({ ...baseParams, observations: [observation()] });
    expect(rows).toEqual([{
      id: expect.any(String),
      supportingAssetId: 'sa-1',
      cveId: null,
      mitreTechniqueId: 'tech-uuid-1',
      expectationType: 'detection',
      isExposed: true,
      securityPlatformType: 'SIEM',
      evaluatedAt: new Date('2026-05-02T09:30:00Z'),
      sourceScenarioId: 'scenario-1',
      sourceScenarioName: 'Credential Harvesting',
      sourceSimulationId: 'sim-1',
      sourceInjectId: 'inject-1',
      connectorId: 'connector-1',
      sourceFindingId: 'scenario-scenario-1',
      scope: 'scenario-1',
      reason: 'Not detected by SIEM in simulation Spring Drill',
    }]);
  });

  it('gives every row its own id', () => {
    const rows = buildAttackEvidenceRows({
      ...baseParams,
      observations: [observation({ platform_types_reporting: ['SIEM', 'EDR'] })],
    });
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  });

  it.each(['RUNNING', 'SCHEDULED', 'PAUSED', 'CANCELED'])('skips an observation whose simulation is %s', (status) => {
    const rows = buildAttackEvidenceRows({ ...baseParams, observations: [observation({ last_simulation_status: status })] });
    expect(rows).toHaveLength(0);
  });

  it('skips an observation whose asset has no resolved supportingAssetId', () => {
    const rows = buildAttackEvidenceRows({ ...baseParams, observations: [observation({ asset_id: 'unknown-asset' })] });
    expect(rows).toHaveLength(0);
  });

  it('skips an observation with an unrecognised expectation type', () => {
    const rows = buildAttackEvidenceRows({ ...baseParams, observations: [observation({ expectation_type: 'MANUAL' })] });
    expect(rows).toHaveLength(0);
  });

  it('reports and skips a technique not found locally', () => {
    const onSkippedTechnique = vi.fn();
    const rows = buildAttackEvidenceRows({
      ...baseParams,
      techniqueIdMap: new Map(),
      observations: [observation()],
      onSkippedTechnique,
    });
    expect(rows).toHaveLength(0);
    expect(onSkippedTechnique).toHaveBeenCalledExactlyOnceWith('T1110.001');
  });

  it('does not report a technique for an observation skipped earlier', () => {
    const onSkippedTechnique = vi.fn();
    buildAttackEvidenceRows({
      ...baseParams,
      techniqueIdMap: new Map(),
      observations: [observation({ last_simulation_status: 'RUNNING' }), observation({ asset_id: 'unknown-asset' })],
      onSkippedTechnique,
    });
    expect(onSkippedTechnique).not.toHaveBeenCalled();
  });

  it('accepts a prevention expectation in any case and words the reason accordingly', () => {
    const rows = buildAttackEvidenceRows({
      ...baseParams,
      observations: [
        observation({ id: 'a', expectation_type: 'prevention', platform_types_reporting: ['EDR'], platform_types_succeeded: ['EDR'] }),
        observation({ id: 'b', expectation_type: 'PREVENTION', platform_types_reporting: ['EDR'], platform_types_succeeded: [] }),
      ],
    });
    expect(rows.map((row) => [row.expectationType, row.isExposed, row.reason])).toEqual([
      ['prevention', false, 'Prevented by EDR in simulation Spring Drill'],
      ['prevention', true, 'Not prevented by EDR in simulation Spring Drill'],
    ]);
  });

  it('gives each platform type its own verdict: EDR succeeded and SIEM missed', () => {
    const rows = buildAttackEvidenceRows({
      ...baseParams,
      observations: [observation({
        expectation_status: 'PARTIAL',
        platform_types_reporting: ['EDR', 'SIEM'],
        platform_types_succeeded: ['EDR'],
      })],
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.securityPlatformType === 'EDR')).toMatchObject({
      isExposed: false,
      reason: 'Detected by EDR in simulation Spring Drill',
    });
    expect(rows.find((row) => row.securityPlatformType === 'SIEM')).toMatchObject({
      isExposed: true,
      reason: 'Not detected by SIEM in simulation Spring Drill',
    });
  });

  it('trims platform types in both lists before comparing them', () => {
    const rows = buildAttackEvidenceRows({
      ...baseParams,
      observations: [observation({ platform_types_reporting: [' EDR '], platform_types_succeeded: ['EDR  '] })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ securityPlatformType: 'EDR', isExposed: false });
  });

  it('collapses duplicate platform types and ignores blank ones', () => {
    const rows = buildAttackEvidenceRows({
      ...baseParams,
      observations: [observation({ platform_types_reporting: ['EDR', ' EDR', '', '   ', 'EDR'] })],
    });
    expect(rows.map((row) => row.securityPlatformType)).toEqual(['EDR']);
  });

  it('writes one row per technique-bearing observation, not per observation of the same scenario', () => {
    const rows = buildAttackEvidenceRows({
      ...baseParams,
      techniqueIdMap: new Map([['T1110.001', 'tech-uuid-1'], ['T1078', 'tech-uuid-2']]),
      observations: [
        observation({ id: 'a' }),
        observation({ id: 'b', attack_pattern_external_id: 'T1078' }),
      ],
    });
    expect(rows.map((row) => row.mitreTechniqueId)).toEqual(['tech-uuid-1', 'tech-uuid-2']);
  });

  describe('with no platform type reporting', () => {
    it.each(['PARTIAL', 'FAILED'])('writes one exposed unknown row for a %s expectation', (status) => {
      const rows = buildAttackEvidenceRows({
        ...baseParams,
        observations: [observation({ expectation_status: status, platform_types_reporting: [], platform_types_succeeded: [] })],
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ securityPlatformType: 'unknown', isExposed: true });
    });

    it('writes one non-exposed unknown row for a SUCCESS expectation', () => {
      const rows = buildAttackEvidenceRows({
        ...baseParams,
        observations: [observation({ expectation_status: 'SUCCESS', platform_types_reporting: [], platform_types_succeeded: [] })],
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ securityPlatformType: 'unknown', isExposed: false });
      expect(rows[0].reason).toBe('Detected by unknown in simulation Spring Drill');
    });

    it('treats a list of blanks as no platform type', () => {
      const rows = buildAttackEvidenceRows({
        ...baseParams,
        observations: [observation({ expectation_status: 'SUCCESS', platform_types_reporting: [' ', ''] })],
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ securityPlatformType: 'unknown', isExposed: false });
    });
  });

  describe('reason', () => {
    it('falls back to the simulation id when the simulation has no name', () => {
      const rows = buildAttackEvidenceRows({ ...baseParams, observations: [observation({ last_simulation_name: null })] });
      expect(rows[0].reason).toBe('Not detected by SIEM in simulation sim-1');
    });

    it('drops the simulation clause and keeps the provenance null when the simulation was pruned', () => {
      const rows = buildAttackEvidenceRows({
        ...baseParams,
        observations: [observation({ last_simulation_id: null, last_simulation_name: null, last_inject_id: null })],
      });
      expect(rows[0]).toMatchObject({
        reason: 'Not detected by SIEM',
        sourceSimulationId: null,
        sourceInjectId: null,
      });
    });

    it('never names an inject', () => {
      const rows = buildAttackEvidenceRows({ ...baseParams, observations: [observation()] });
      expect(rows[0].reason).not.toMatch(/inject/i);
    });
  });

  it('keeps a null scenario name null', () => {
    const rows = buildAttackEvidenceRows({ ...baseParams, observations: [observation({ scenario_name: null })] });
    expect(rows[0].sourceScenarioName).toBeNull();
  });
});

describe('cveIdentifierOfObservation', () => {
  const vulnerability = (overrides: Partial<VulnerabilityObservation> = {}): VulnerabilityObservation => ({
    id: 'vobs-1',
    updated_at: '2026-05-02T10:00:00Z',
    asset_id: 'asset-1',
    last_finding_id: 'finding-1',
    last_scenario_id: 'scenario-1',
    last_simulation_id: 'sim-1',
    last_simulation_name: 'Spring Drill',
    finding_type: 'CVE',
    finding_value: 'CVE-2024-1234',
    last_verified_at: '2026-05-02T09:30:00Z',
    ...overrides,
  });

  it('reads a well-formed CVE identifier', () => {
    expect(cveIdentifierOfObservation(vulnerability())).toBe('CVE-2024-1234');
  });

  it('trims and uppercases the value', () => {
    expect(cveIdentifierOfObservation(vulnerability({ finding_value: ' cve-2024-1234 ' }))).toBe('CVE-2024-1234');
  });

  it.each(['cve', 'Cve', 'CVE'])('compares finding_type %s case-insensitively', (type) => {
    expect(cveIdentifierOfObservation(vulnerability({ finding_type: type }))).toBe('CVE-2024-1234');
  });

  it.each(['VULNERABILITY', 'CWE', ''])('ignores finding_type %j', (type) => {
    expect(cveIdentifierOfObservation(vulnerability({ finding_type: type }))).toBeNull();
  });

  it.each(['', '   ', 'CVE-24-1', 'CVE-2024-123', 'not a cve', 'Missing patch CVE-2024-1234', 'CVE-2024-1234 [not vulnerable]'])(
    'rejects the malformed value %j',
    (value) => {
      expect(cveIdentifierOfObservation(vulnerability({ finding_value: value }))).toBeNull();
    },
  );
});

describe('buildVulnerabilityEvidenceRows', () => {
  const vulnerability = (overrides: Partial<VulnerabilityObservation> = {}): VulnerabilityObservation => ({
    id: 'vobs-1',
    updated_at: '2026-05-02T10:00:00Z',
    asset_id: 'asset-1',
    last_finding_id: 'finding-1',
    last_scenario_id: 'scenario-1',
    last_simulation_id: 'sim-1',
    last_simulation_name: 'Spring Drill',
    finding_type: 'CVE',
    finding_value: 'CVE-2024-1234',
    last_verified_at: '2026-05-02T09:30:00Z',
    ...overrides,
  });

  const baseParams = {
    cveIdMap: new Map([['CVE-2024-1234', 'cve-uuid-1']]),
    assetIdMap: new Map([['asset-1', 'sa-1']]),
    connectorId: 'connector-1',
  };

  it('builds an exposed CVE row keyed and scoped by the id OpenAEV gives the asset', () => {
    const rows = buildVulnerabilityEvidenceRows({ ...baseParams, observations: [vulnerability()] });
    expect(rows).toEqual([{
      id: expect.any(String),
      supportingAssetId: 'sa-1',
      cveId: 'cve-uuid-1',
      mitreTechniqueId: null,
      expectationType: null,
      isExposed: true,
      securityPlatformType: null,
      evaluatedAt: new Date('2026-05-02T09:30:00Z'),
      sourceScenarioId: null,
      sourceScenarioName: null,
      sourceSimulationId: 'sim-1',
      sourceInjectId: null,
      connectorId: 'connector-1',
      sourceFindingId: 'asset-1:CVE-2024-1234',
      externalReference: 'finding-1',
      scope: 'asset-1',
      reason: 'Reported by OpenAEV in simulation Spring Drill',
    }]);
  });

  it('resolves a padded lowercase value to the normalised CVE', () => {
    const rows = buildVulnerabilityEvidenceRows({ ...baseParams, observations: [vulnerability({ finding_value: ' cve-2024-1234 ' })] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cveId: 'cve-uuid-1', sourceFindingId: 'asset-1:CVE-2024-1234' });
  });

  it('gives each OpenAEV asset folded onto one OpenCRQ asset its own source key and scope', () => {
    const rows = buildVulnerabilityEvidenceRows({
      ...baseParams,
      assetIdMap: new Map([['asset-1', 'sa-1'], ['asset-2', 'sa-1']]),
      observations: [vulnerability({ asset_id: 'asset-1' }), vulnerability({ asset_id: 'asset-2' })],
    });
    expect(rows.map((row) => [row.supportingAssetId, row.sourceFindingId, row.scope])).toEqual([
      ['sa-1', 'asset-1:CVE-2024-1234', 'asset-1'],
      ['sa-1', 'asset-2:CVE-2024-1234', 'asset-2'],
    ]);
  });

  it('skips an observation whose finding_type is not CVE', () => {
    const rows = buildVulnerabilityEvidenceRows({ ...baseParams, observations: [vulnerability({ finding_type: 'VULNERABILITY' })] });
    expect(rows).toHaveLength(0);
  });

  it('skips a value that is not a CVE identifier', () => {
    const rows = buildVulnerabilityEvidenceRows({ ...baseParams, observations: [vulnerability({ finding_value: 'not a cve' })] });
    expect(rows).toHaveLength(0);
  });

  it('skips a CVE that could not be resolved to a UUID', () => {
    const rows = buildVulnerabilityEvidenceRows({ ...baseParams, cveIdMap: new Map(), observations: [vulnerability()] });
    expect(rows).toHaveLength(0);
  });

  it('skips an observation whose asset could not be resolved to a UUID', () => {
    const rows = buildVulnerabilityEvidenceRows({ ...baseParams, assetIdMap: new Map(), observations: [vulnerability()] });
    expect(rows).toHaveLength(0);
  });

  it('falls back to the simulation id in the reason when the simulation has no name', () => {
    const rows = buildVulnerabilityEvidenceRows({ ...baseParams, observations: [vulnerability({ last_simulation_name: null })] });
    expect(rows[0].reason).toBe('Reported by OpenAEV in simulation sim-1');
  });

  it('drops "in simulation" and leaves sourceSimulationId null when the simulation was pruned', () => {
    const rows = buildVulnerabilityEvidenceRows({
      ...baseParams,
      observations: [vulnerability({ last_simulation_id: null, last_simulation_name: null })],
    });
    expect(rows[0]).toMatchObject({ sourceSimulationId: null, reason: 'Reported by OpenAEV' });
  });

  it('keeps a null last_finding_id as a null externalReference', () => {
    const rows = buildVulnerabilityEvidenceRows({ ...baseParams, observations: [vulnerability({ last_finding_id: null })] });
    expect(rows[0].externalReference).toBeNull();
  });
});

describe('agentIdentityOf', () => {
  // The two payloads as OpenAEV really serves them: the detail row names the executor by id and
  // carries the external reference, the inventory row embeds the executor and carries no reference.
  const detailAgent = { agent_id: 'agent-1', agent_executor: 'executor-uuid', agent_external_reference: 'mde-device-1' };
  const inventoryAgent = { agent_id: 'agent-1', agent_executor: { executor_id: 'executor-uuid', executor_type: 'openaev_agent' } };

  it('joins the reference from the detail row to the executor type from the inventory row', () => {
    expect(agentIdentityOf([detailAgent], [inventoryAgent])).toEqual({
      reference: 'mde-device-1',
      executorType: 'openaev_agent',
    });
  });

  it('prefers the MDE-executed agent, which is what tier 0 of the matcher gates on', () => {
    const other = { agent_id: 'agent-2', agent_executor: 'e-2', agent_external_reference: 'other-ref' };
    const inventory = [
      inventoryAgent,
      { agent_id: 'agent-2', agent_executor: { executor_id: 'e-2', executor_type: 'openbas_implant' } },
    ];
    const mde = { agent_id: 'agent-3', agent_executor: 'e-3', agent_external_reference: 'mde-ref' };
    const withMde = [...inventory, { agent_id: 'agent-3', agent_executor: { executor_id: 'e-3', executor_type: 'mde_executor' } }];
    expect(agentIdentityOf([detailAgent, other, mde], withMde).reference).toBe('mde-ref');
  });

  it('falls back to the first agent carrying a reference when no executor type is known', () => {
    expect(agentIdentityOf([detailAgent], undefined)).toEqual({ reference: 'mde-device-1', executorType: null });
  });

  it('reports nothing for an agentless endpoint', () => {
    expect(agentIdentityOf([], [])).toEqual({ reference: null, executorType: null });
  });
});
