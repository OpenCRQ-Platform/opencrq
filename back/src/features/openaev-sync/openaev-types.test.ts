import { describe, expect, it } from 'vitest';
import { aiTargetAssetSchema, assetInventoryRowSchema, attackObservationSchema, endpointEntitySchema, snapshotSearchOutputSchema, vulnerabilityObservationSchema } from './openaev-types';

/**
 * OpenAEV serialises with Jackson's default inclusion (no `@JsonInclude(NON_NULL)` on the
 * models, no `default-property-inclusion` in its config), so every unset field arrives as an
 * explicit JSON null rather than being omitted. These fixtures mirror that wire format.
 */
describe('snapshot observation schemas', () => {
  const envelope = {
    has_more: false,
    snapshot_window_end: '2026-10-05T10:00:00Z',
    indexed_through: '2026-10-05T10:00:01.123Z',
    server_time: '2026-10-05T10:02:00Z',
    consistency_mode: 'eventual',
    snapshot_ready: true,
  };

  const attackObservation = {
    id: '5d41402abc4b2a76b9719d911017c592',
    updated_at: '2026-10-05T09:58:00Z',
    asset_id: 'asset-1',
    scenario_id: 'scenario-1',
    scenario_name: 'Ransomware chain',
    last_simulation_id: 'sim-2',
    last_simulation_name: 'Ransomware chain #2',
    last_simulation_start_date: '2026-10-04T08:00:00Z',
    last_simulation_status: 'FINISHED',
    last_inject_id: 'inject-1',
    attack_pattern_external_id: 'T1059.001',
    attack_pattern_name: 'PowerShell',
    expectation_type: 'DETECTION',
    expectation_status: 'PARTIAL',
    attempts_total: 2,
    attempts_success: 1,
    coverage_ratio: 0.5,
    platforms_reporting: ['sp-1', 'sp-2'],
    platforms_succeeded: ['sp-1'],
    platform_types_reporting: ['EDR', 'SIEM'],
    platform_types_succeeded: ['EDR'],
    last_verified_at: '2026-10-04T08:30:00Z',
    asset_name: 'srv-01',
    endpoint_hostname: 'srv-01.corp',
    endpoint_platform: 'Windows',
    tenant_name: 'Acme',
  };

  const vulnerabilityObservation = {
    id: '7d793037a0760186574b0282f2f435e7',
    updated_at: '2026-10-05T09:58:00Z',
    asset_id: 'asset-1',
    last_finding_id: 'finding-1',
    last_scenario_id: 'scenario-1',
    last_scenario_name: 'Scan',
    last_simulation_id: 'sim-1',
    last_simulation_name: 'Scan #1',
    finding_type: 'CVE',
    finding_value: ' cve-2024-1234 ',
    vulnerability_external_id: ' cve-2024-1234 ',
    last_verified_at: '2026-10-05T09:58:00Z',
    asset_name: 'srv-01',
    endpoint_hostname: 'srv-01.corp',
    endpoint_platform: 'Linux',
    tenant_name: 'Acme',
  };

  it('parses an attack page and keeps its envelope', () => {
    const page = snapshotSearchOutputSchema(attackObservationSchema).parse({
      ...envelope, observations: [attackObservation], next_cursor: 'opaque-cursor',
    });

    expect(page).toMatchObject({ has_more: false, next_cursor: 'opaque-cursor', snapshot_ready: true, consistency_mode: 'eventual' });
    expect(page.observations).toEqual([attackObservation]);
  });

  it('accepts the nulls of an attack document whose simulation or inject was deleted, or whose asset is not an endpoint', () => {
    const page = snapshotSearchOutputSchema(attackObservationSchema).parse({
      ...envelope,
      next_cursor: 'opaque-cursor',
      observations: [{
        ...attackObservation,
        last_simulation_id: null,
        last_simulation_start_date: null,
        last_inject_id: null,
        platforms_reporting: null,
        endpoint_hostname: null,
        endpoint_platform: null,
      }],
    });

    expect(page.observations[0]).toMatchObject({ last_simulation_id: null, last_simulation_start_date: null, last_inject_id: null, platforms_reporting: null });
  });

  it('accepts next_cursor null, as sent for a cursor-less request that matched nothing', () => {
    const page = snapshotSearchOutputSchema(attackObservationSchema).parse({ ...envelope, observations: [], next_cursor: null });

    expect(page.next_cursor).toBeNull();
    expect(page.observations).toEqual([]);
  });

  it('accepts a platform type, status and expectation type OpenAEV may add later', () => {
    const page = snapshotSearchOutputSchema(attackObservationSchema).parse({
      ...envelope,
      next_cursor: null,
      observations: [{
        ...attackObservation,
        platform_types_reporting: ['EDR', 'QUANTUM_FIREWALL'],
        platform_types_succeeded: ['QUANTUM_FIREWALL'],
        last_simulation_status: 'ARCHIVED',
        expectation_type: 'VULNERABILITY',
      }],
    });

    expect(page.observations[0].platform_types_reporting).toEqual(['EDR', 'QUANTUM_FIREWALL']);
    expect(page.observations[0].last_simulation_status).toBe('ARCHIVED');
  });

  it('defaults absent platform_types_* to empty arrays', () => {
    const { platform_types_reporting: _reporting, platform_types_succeeded: _succeeded, ...withoutTypes } = attackObservation;

    const parsed = attackObservationSchema.parse(withoutTypes);

    expect(parsed.platform_types_reporting).toEqual([]);
    expect(parsed.platform_types_succeeded).toEqual([]);
  });

  it('rejects an attack document without an asset or a scenario', () => {
    const { asset_id: _asset, ...withoutAsset } = attackObservation;
    const { scenario_id: _scenario, ...withoutScenario } = attackObservation;

    expect(attackObservationSchema.safeParse(withoutAsset).success).toBe(false);
    expect(attackObservationSchema.safeParse(withoutScenario).success).toBe(false);
  });

  it('accepts an attack document missing or nulling every field the connector never reads', () => {
    const { attack_pattern_name: _name, attempts_total: _total, attempts_success: _success, coverage_ratio: _ratio, platforms_succeeded: _succeeded, asset_name: _asset, tenant_name: _tenant, ...read } = attackObservation;

    expect(attackObservationSchema.safeParse({ ...read, platforms_reporting: null, scenario_name: null, last_simulation_name: null }).success).toBe(true);
  });

  it('keeps the fields it does not type', () => {
    expect(attackObservationSchema.parse({ ...attackObservation, future_field: 1 })).toHaveProperty('future_field', 1);
  });

  it('parses a vulnerability page, with finding_value as OpenAEV stores it', () => {
    const page = snapshotSearchOutputSchema(vulnerabilityObservationSchema).parse({
      ...envelope, observations: [vulnerabilityObservation], next_cursor: 'opaque-cursor',
    });

    expect(page.observations).toEqual([vulnerabilityObservation]);
  });

  it('accepts the nulls of a vulnerability found outside any scenario or on a non-endpoint asset', () => {
    const parsed = vulnerabilityObservationSchema.parse({
      ...vulnerabilityObservation,
      last_finding_id: null,
      last_scenario_id: null,
      last_scenario_name: null,
      last_simulation_id: null,
      last_simulation_name: null,
      endpoint_hostname: null,
      endpoint_platform: null,
    });

    expect(parsed).toMatchObject({ last_finding_id: null, last_scenario_id: null, last_simulation_id: null, endpoint_hostname: null });
  });

  it('accepts a finding_type other than CVE: the filter belongs to the mapping', () => {
    const parsed = vulnerabilityObservationSchema.parse({ ...vulnerabilityObservation, finding_type: 'Vulnerability' });

    expect(parsed.finding_type).toBe('Vulnerability');
  });

  it('rejects a vulnerability document without a finding_value', () => {
    const { finding_value: _value, ...withoutValue } = vulnerabilityObservation;

    expect(vulnerabilityObservationSchema.safeParse(withoutValue).success).toBe(false);
  });

  it('rejects a page whose envelope is incomplete', () => {
    const { has_more: _hasMore, ...withoutHasMore } = envelope;

    expect(snapshotSearchOutputSchema(attackObservationSchema).safeParse({ ...withoutHasMore, observations: [], next_cursor: null }).success).toBe(false);
  });
});

describe('raw-entity schemas', () => {
  it('strips the AI target credential fields OpenAEV serves on every asset, endpoints included', () => {
    const wire = {
      asset_id: 'asset-1',
      asset_hostname: 'srv-01',
      ai_target_token: 'sk-live-must-not-survive',
      ai_target_configuration: '{"api_key":"must-not-survive"}',
    };
    const endpoint = endpointEntitySchema.parse(wire);
    expect(endpoint).not.toHaveProperty('ai_target_token');
    expect(endpoint).not.toHaveProperty('ai_target_configuration');
    expect(endpoint.asset_hostname).toBe('srv-01');

    const aiTarget = aiTargetAssetSchema.parse({ ...wire, ai_target_model: 'gpt-4o' });
    expect(aiTarget).not.toHaveProperty('ai_target_token');
    expect(aiTarget).not.toHaveProperty('ai_target_configuration');
    expect(aiTarget.ai_target_model).toBe('gpt-4o');
  });
});

describe('agent shapes', () => {
  it('parses an agent whose executor is a bare id, as /endpoints/find serves it', () => {
    // The raw `Endpoint` entity serialises the executor relation as its id; the DTO behind
    // /assets/search embeds it. Rejecting the string form failed the whole enrichment phase.
    const entity = endpointEntitySchema.parse({
      asset_id: 'asset-1',
      asset_agents: [{
        agent_id: 'agent-1',
        agent_executor: '2f9a0936-c327-4e95-b406-d161d32a2501',
        agent_external_reference: 'f209424bef6e20a7',
      }],
    });
    expect(entity.asset_agents?.[0]?.agent_executor).toBe('2f9a0936-c327-4e95-b406-d161d32a2501');
  });

  it('parses an agent whose executor is embedded, as /assets/search serves it', () => {
    const row = assetInventoryRowSchema.parse({
      asset_id: 'asset-1',
      asset_agents: [{ agent_id: 'agent-1', agent_executor: { executor_id: 'e-1', executor_type: 'openaev_agent' } }],
    });
    expect(row.asset_agents?.[0]?.agent_executor).toEqual({ executor_id: 'e-1', executor_type: 'openaev_agent' });
  });
});
