import { uuidv7 } from 'uuidv7';
import type {
  AiTargetConnectorProperties,
  AiTargetModality,
  AiTargetProvider,
  AssetCategory,
  AssetCriticality,
  AssetSubcategory,
  CloudProvider,
  ConnectorAssetInput,
  EndpointArch,
  ExpectationType,
  MachineConnectorProperties,
} from '@app/module';
import {
  AI_TARGET_MODALITY_VALUES,
  AI_TARGET_PROVIDER_VALUES,
  ASSET_CATEGORY_VALUES,
  ASSET_SUBCATEGORY_VALUES,
  CLOUD_PROVIDER_VALUES,
  ENDPOINT_ARCH_VALUES,
  isMdeExecutor,
} from '@app/module';
import type {
  AiTargetAsset,
  AssetInventoryRow,
  AssetOverview,
  AttackObservation,
  CveEvidenceRow,
  EndpointEntity,
  ExpectationEvidenceRow,
  OpenaevAgent,
  OpenaevUser,
  VulnerabilityObservation,
} from './openaev-types';

const isAssetCategory = (value: string): value is AssetCategory =>
  (ASSET_CATEGORY_VALUES as ReadonlyArray<string>).includes(value);

const isAssetSubcategory = (value: string): value is AssetSubcategory =>
  (ASSET_SUBCATEGORY_VALUES as ReadonlyArray<string>).includes(value);

const isEndpointArch = (value: string): value is EndpointArch =>
  (ENDPOINT_ARCH_VALUES as ReadonlyArray<string>).includes(value);

const isAiTargetProvider = (value: string): value is AiTargetProvider =>
  (AI_TARGET_PROVIDER_VALUES as ReadonlyArray<string>).includes(value);

const isAiTargetModality = (value: string): value is AiTargetModality =>
  (AI_TARGET_MODALITY_VALUES as ReadonlyArray<string>).includes(value);

const isCloudProvider = (value: string): value is CloudProvider =>
  (CLOUD_PROVIDER_VALUES as ReadonlyArray<string>).includes(value);

/** Degrades an unrecognised provider to `null`: the free-form `cloudNativeType` still carries the detail. */
const parseCloudProvider = (value: string | null | undefined): CloudProvider | null => {
  const normalized = value?.toLowerCase();
  return normalized !== undefined && isCloudProvider(normalized) ? normalized : null;
};

const mapPlatformToCategory = (platform: string | null | undefined): AssetCategory => {
  const p = (platform ?? '').toLowerCase();
  if (p === 'linux' || p === 'windows' || p === 'macos') {
    return 'host';
  }
  if (p === 'container') {
    return 'container_workload';
  }
  if (p === 'service') {
    return 'saas_application';
  }
  if (p === 'android' || p === 'ios') {
    return 'mobile_device';
  }
  return 'generic_asset'; // fallback for unrecognised platforms
};

/**
 * The asset's last contact, taken as the most recent `agent_last_seen` across its agents.
 * Agentless endpoints and non-endpoint assets report none at all, and get `null` rather than a
 * made-up date.
 */
const lastSeenFromAgents = (agents: ReadonlyArray<OpenaevAgent> | null | undefined): Date | null => {
  const times = (agents ?? [])
    .map((a) => a.agent_last_seen)
    .filter((v): v is string => !!v)
    .map((v) => new Date(v).getTime());
  return times.length > 0 ? new Date(Math.max(...times)) : null;
};

/**
 * The description OpenAEV holds on an asset. Only the detail calls serve it — `/assets/search`
 * maps through OpenAEV's own `EndpointOutput` DTO, which has no `asset_description` field at all — so the inventory
 * pass cannot fill it and the handler must carry it over from the matching detail row, or from the
 * description phase for a generic asset.
 */
export const descriptionOf = (detail: { asset_description?: string | null }): string | null =>
  detail.asset_description?.trim() || null;

/**
 * Resolves the OpenCRQ category and subcategory for an OpenAEV asset. The declared
 * `asset_category` is used directly when present; instances that do not populate it fall back to
 * the `endpoint_platform` switch, and anything unrecognised resolves to `generic_asset` rather
 * than to a connector-flavoured default. `SECURITY_PLATFORM` maps to `security_platform` like any
 * declared category: its own identity family has no matcher, so it never enters the `machine`
 * family's matching as an ordinary host, and the loss readers leave it out by
 * `isLossBearingAssetCategory`. The subcategory is read independently and degrades to `null` when
 * absent or unrecognised — OpenAEV guarantees it belongs to its own reported category, so no
 * cross-check against the resolved one is needed here.
 */
export const resolveOpenaevCategory = (asset: {
  asset_category?: string | null,
  asset_subcategory?: string | null,
  endpoint_platform?: string | null,
}): { categoryId: AssetCategory, subcategoryId: AssetSubcategory | null } => {
  const declaredCategory = asset.asset_category?.toLowerCase();
  const categoryId = declaredCategory !== undefined && isAssetCategory(declaredCategory)
    ? declaredCategory
    : mapPlatformToCategory(asset.endpoint_platform);
  const declaredSubcategory = asset.asset_subcategory?.toLowerCase();
  const subcategoryId = declaredSubcategory !== undefined && isAssetSubcategory(declaredSubcategory)
    ? declaredSubcategory
    : null;
  return { categoryId, subcategoryId };
};

/** Whether an attack-stream document is a vulnerability scan (a `VULNERABILITY` expectation), whatever its case. */
const isVulnerabilityExpectation = (rawType: string): boolean => rawType.toUpperCase() === 'VULNERABILITY';

/** One finished vulnerability scan of a known asset, as `buildScanMeasurements` reads it off the attack stream. */
export interface ScanMeasurementRow {
  supportingAssetId: string,
  scenarioId: string,
  scenarioName: string | null,
  simulationId: string | null,
  observationId: string,
  platformTypes: Array<string>,
  result: 'clean' | 'findings',
  evaluatedAt: Date,
}

/**
 * The scan measurements a page of the attack stream carries (opencrq #332): one per `VULNERABILITY`
 * document of a `FINISHED` simulation on a known asset. `SUCCESS` means the scanner found nothing
 * (`clean`); any other verdict, `PARTIAL` included, means it found something (`findings`). A
 * pending verdict, a simulation not finished, an unknown asset or an unreadable date writes
 * nothing. A measurement is never a technique finding: `buildAttackEvidenceRows` keeps skipping
 * these documents.
 */
export const buildScanMeasurements = (params: {
  observations: ReadonlyArray<AttackObservation>,
  assetIdMap: ReadonlyMap<string, string>,
}): Array<ScanMeasurementRow> => {
  const rows: Array<ScanMeasurementRow> = [];
  for (const observation of params.observations) {
    if (!isVulnerabilityExpectation(observation.expectation_type) || observation.last_simulation_status !== 'FINISHED') {
      continue;
    }
    const status = observation.expectation_status.toUpperCase();
    if (status === 'PENDING' || status === 'UNKNOWN' || status === '') {
      continue;
    }
    const supportingAssetId = params.assetIdMap.get(observation.asset_id);
    const evaluatedAt = new Date(observation.last_verified_at);
    if (!supportingAssetId || Number.isNaN(evaluatedAt.getTime())) {
      continue;
    }
    const platformTypes = [...new Set(
      observation.platform_types_reporting.map((type) => type.trim()).filter((type) => type !== ''),
    )].sort();
    rows.push({
      supportingAssetId,
      scenarioId: observation.scenario_id,
      scenarioName: observation.scenario_name,
      simulationId: observation.last_simulation_id,
      observationId: observation.id,
      platformTypes: platformTypes.length > 0 ? platformTypes : ['unknown'],
      result: status === 'SUCCESS' ? 'clean' : 'findings',
      evaluatedAt,
    });
  }
  return rows;
};

export const mapExpectationType = (rawType: string): ExpectationType | null => {
  const t = rawType.toUpperCase();
  if (t === 'DETECTION') {
    return 'detection';
  }
  if (t === 'PREVENTION') {
    return 'prevention';
  }
  return null;
};

/**
 * Prefers the agent an MDE executor registered — the one whose external reference is a Defender
 * machine id (tier 0) — falling back to the first agent carrying any reference at all, since an
 * unqualified reference is still handed to the matcher, which itself gates tier 0 on the executor.
 */
/** The executor's type, present only where OpenAEV embeds the executor rather than naming its id. */
const executorTypeOf = (agent: OpenaevAgent): string | null => (
  typeof agent.agent_executor === 'object' && agent.agent_executor !== null
    ? agent.agent_executor.executor_type ?? null
    : null
);

/**
 * Takes both agent lists because neither payload carries a whole identity — the inventory row has
 * the executor type, the detail row has the reference — and joins them on `agent_id`.
 *
 * The MDE-executed agent wins when there is one: tier 0 of the matcher is what fuses an OpenAEV
 * endpoint with the Defender device behind it.
 */
export const agentIdentityOf = (
  detailAgents: ReadonlyArray<OpenaevAgent> | null | undefined,
  inventoryAgents: ReadonlyArray<OpenaevAgent> | null | undefined,
): { reference: string | null, executorType: string | null } => {
  const detail = detailAgents ?? [];
  const typeByAgentId = new Map(
    (inventoryAgents ?? []).flatMap((a) => (a.agent_id ? [[a.agent_id, executorTypeOf(a)] as const] : [])),
  );
  const typeOf = (agent: OpenaevAgent): string | null =>
    executorTypeOf(agent) ?? (agent.agent_id ? typeByAgentId.get(agent.agent_id) ?? null : null);

  const chosen = detail.find((a) => isMdeExecutor(typeOf(a)))
    ?? detail.find((a) => a.agent_external_reference)
    ?? (inventoryAgents ?? []).find((a) => isMdeExecutor(executorTypeOf(a)));
  if (chosen === undefined) {
    return { reference: null, executorType: null };
  }
  return { reference: chosen.agent_external_reference ?? null, executorType: typeOf(chosen) };
};

const mapOpenaevExposure = (internetFacing: boolean | null | undefined): 'internet_facing' | 'internal' | 'unknown' => {
  if (internetFacing === true) {
    return 'internet_facing';
  }
  if (internetFacing === false) {
    return 'internal';
  }
  return 'unknown';
};

/** `critical` is defensive — OpenAEV's enum has no such member — and reads as the severer band. */
export const mapOpenaevCriticality = (criticality: string | null | undefined): AssetCriticality => {
  const value = (criticality ?? '').toLowerCase();
  if (value === 'very_high' || value === 'critical') {
    return 'very_high';
  }
  if (value === 'high') {
    return 'high';
  }
  if (value === 'medium') {
    return 'medium';
  }
  if (value === 'low') {
    return 'low';
  }
  return 'unknown';
};

/**
 * Which enrichment call answers for this inventory row. `/endpoints/find` is backed by the endpoint
 * repository and therefore by OpenAEV's `asset_type` discriminator, not by `asset_category`: a
 * `CLOUD_RESOURCE` stored as a generic asset is a machine-family category on an `asset` row, and
 * routing it to `/endpoints/find` on its category alone would have it come back from nothing, every
 * run, in silence.
 */
export type EnrichmentRoute = 'endpoint' | 'ai_target' | 'overview';

export const enrichmentRouteOf = (row: { asset_type?: string | null, asset_category?: string | null }): EnrichmentRoute => {
  if (row.asset_type?.toLowerCase() === 'endpoint') {
    return 'endpoint';
  }
  return row.asset_category?.toLowerCase() === 'ai_target' ? 'ai_target' : 'overview';
};

/**
 * Builds the common part of a `ConnectorAssetInput` from one row of the unified inventory
 * (`/assets/search`), plus the tag ids it resolves to through `tagIdBySourceTagId` (OpenAEV tag id
 * → our tag id). Carries no `properties` block: the machine and AI-target property rows come from
 * their own detail calls (`endpointToMachineProperties`, `aiTargetToProperties`) and are merged in
 * by the caller. A tag OpenAEV reports that has no entry in the map yet (not seen by the tag sync
 * pass) is silently dropped rather than blocking the asset. `markingStixIdByOpenaevId` is `null`
 * when OpenAEV's markings are off: OpenAEV enforces none, so the asset carries none either, whatever
 * `asset_markings` holds (a marking write is not feature-gated in OpenAEV).
 */
export const assetToConnectorInput = (
  row: AssetInventoryRow,
  connectorId: string,
  tagIdBySourceTagId: ReadonlyMap<string, string>,
  markingStixIdByOpenaevId: ReadonlyMap<string, string> | null = new Map(),
): { input: ConnectorAssetInput, tagIds: Array<string> } => {
  const { categoryId, subcategoryId } = resolveOpenaevCategory(row);
  const markingRefs = markingStixIdByOpenaevId === null ? [] : openaevMarkingRefs(row.asset_markings, markingStixIdByOpenaevId);
  return {
    input: {
      sourceAssetId: row.asset_id,
      categoryId,
      subcategoryId,
      connectorId,
      source: 'openaev',
      name: row.asset_name ?? null,
      exposure: mapOpenaevExposure(row.asset_internet_facing),
      criticality: mapOpenaevCriticality(row.asset_criticality),
      externalReference: row.asset_external_reference ?? null,
      firstSeenAt: null,
      lastSeenAt: lastSeenFromAgents(row.asset_agents),
      ...(markingRefs.length > 0 ? { markingRefs } : {}),
    },
    tagIds: (row.asset_tags ?? [])
      .map((sourceTagId) => tagIdBySourceTagId.get(sourceTagId))
      .filter((tagId): tagId is string => tagId !== undefined),
  };
};

/**
 * The tags the OpenAEV GitHub collector puts on the source-code assets of a repository it no longer
 * collects: archived on GitHub, or no longer returned (gone, or archived and left out by its
 * settings), with its workflows and packages. Such an asset is no longer part of the estate, so it
 * leaves the risk scope instead of reading as an asset nobody measures any more.
 */
export const RETIRED_SOURCE_TAG_NAMES: ReadonlySet<string> = new Set(['github-state:archived', 'github-state:deleted']);

/** Whether an inventory row is an asset its source says is archived or deleted, read from its tag names. */
export const isRetiredSourceAsset = (row: AssetInventoryRow, tagNameBySourceTagId: ReadonlyMap<string, string>): boolean =>
  (row.asset_tags ?? []).some((sourceTagId) => {
    const name = tagNameBySourceTagId.get(sourceTagId);
    return name !== undefined && RETIRED_SOURCE_TAG_NAMES.has(name.trim().toLowerCase());
  });

/**
 * The markings an OpenAEV asset carries, as STIX marking ids (CTEM marking parity, G4), so OpenCRQ
 * reads them against the same clearance as an OpenCTI marking. An OpenAEV id the tenant's
 * definitions do not resolve is kept as it is: no OpenCRQ marking carries it, so nobody but the
 * super administrator is cleared for it and the asset stays hidden (fail closed), never shown
 * unmarked.
 */
export const openaevMarkingRefs = (
  openaevMarkingIds: ReadonlyArray<string> | null | undefined,
  markingStixIdByOpenaevId: ReadonlyMap<string, string>,
): Array<string> => [...new Set((openaevMarkingIds ?? []).map((id) => markingStixIdByOpenaevId.get(id) ?? id))].sort();

/**
 * What an asset's linked person is shown as, on OpenAEV's own fallback order: a full name, then
 * the email, then nothing. The id itself is never a display value — it is an OpenAEV user id, which
 * says nothing to a reader here — so an id this lookup could not resolve leaves the field empty.
 */
export const linkedPersonNameOf = (user: OpenaevUser | undefined): string | null => {
  if (!user) {
    return null;
  }
  const fullName = [user.user_firstname, user.user_lastname].filter(Boolean).join(' ').trim();
  return fullName || user.user_email?.trim() || null;
};

/** Degrades an unrecognised or absent architecture to `null` rather than throwing (`Endpoint.PLATFORM_ARCH.Unknown` included). */
const parseEndpointArch = (value: string | null | undefined): EndpointArch | null => {
  const normalized = value?.toLowerCase();
  return normalized !== undefined && isEndpointArch(normalized) ? normalized : null;
};

/** Builds the `machine` property block from a full `Endpoint` entity (`/endpoints/find`) — the only call that serves hostname/IPs/MACs/seen-IP. */
export const endpointToMachineProperties = (
  endpoint: EndpointEntity,
  inventoryAgents?: ReadonlyArray<OpenaevAgent> | null,
): MachineConnectorProperties => {
  const { reference, executorType } = agentIdentityOf(endpoint.asset_agents, inventoryAgents);
  return {
    family: 'machine',
    hostname: endpoint.asset_hostname ?? null,
    ipAddresses: endpoint.asset_ips ?? null,
    macAddresses: endpoint.asset_mac_addresses ?? null,
    seenIp: endpoint.asset_seen_ip ?? null,
    cloudProvider: parseCloudProvider(endpoint.asset_cloud_provider),
    cloudNativeType: endpoint.asset_cloud_native_type ?? null,
    cloudRegion: endpoint.asset_cloud_region ?? null,
    platform: endpoint.endpoint_platform ?? null,
    arch: parseEndpointArch(endpoint.endpoint_arch),
    isEol: endpoint.endpoint_is_eol ?? null,
    agentExternalReference: reference,
    agentExecutorType: executorType,
  };
};

/**
 * Overlays a machine detail row (`/endpoints/find`) onto the inventory-derived input: the
 * description and the property block both arrive only on this call, never on `/assets/search`
 * (`descriptionOf`, `endpointToMachineProperties`).
 */
export const mergeMachineDetail = (
  base: ConnectorAssetInput,
  detail: EndpointEntity,
  inventoryAgents?: ReadonlyArray<OpenaevAgent> | null,
): ConnectorAssetInput => ({
  ...base,
  description: descriptionOf(detail),
  url: detail.asset_url ?? null,
  linkedPerson: detail.asset_linked_person ?? null,
  properties: endpointToMachineProperties(detail, inventoryAgents),
});

/**
 * What the generic asset overview (`GET /assets/{id}`) carries that no batch route serves: the
 * description, the url and the linked person, which is still an OpenAEV user id here (see
 * `linkedPersonNameOf`). An absent or blank field is `null`.
 */
export const overviewFieldsOf = (detail: AssetOverview): { description: string | null, url: string | null, linkedPerson: string | null } => ({
  description: descriptionOf(detail),
  url: detail.asset_url ?? null,
  linkedPerson: detail.asset_linked_person ?? null,
});

/**
 * Builds the `ai_target` property block from a full `Asset` entity restricted to
 * `category = AI_TARGET` (`/ai_targets/search`). `ai_target_token` (a credential) and
 * `ai_target_configuration` (which may itself carry one) are never read here — OpenCRQ
 * does not persist AI target secrets, and neither field is modelled on
 * `AiTargetConnectorProperties`, so there is nothing here to accidentally forward.
 */
export const aiTargetToProperties = (asset: AiTargetAsset): AiTargetConnectorProperties => {
  const provider = asset.ai_target_provider?.toLowerCase();
  const modality = asset.ai_target_modality?.toLowerCase();
  return {
    family: 'ai_target',
    provider: provider !== undefined && isAiTargetProvider(provider) ? provider : null,
    endpointUrl: asset.ai_target_endpoint ?? null,
    model: asset.ai_target_model ?? null,
    modality: modality !== undefined && isAiTargetModality(modality) ? modality : null,
    systemPrompt: asset.ai_target_system_prompt ?? null,
  };
};

/** Overlays an AI target detail row (`/ai_targets/search`) onto the inventory-derived input — same reason as `mergeMachineDetail`. */
export const mergeAiTargetDetail = (base: ConnectorAssetInput, detail: AiTargetAsset): ConnectorAssetInput => ({
  ...base,
  description: descriptionOf(detail),
  properties: aiTargetToProperties(detail),
});

const CVE_IDENTIFIER_PATTERN = /^CVE-\d{4}-\d{4,}$/i;

/**
 * Builds the evidence rows of attack observations, one per security platform type an observation
 * reports. Skips (without a row) an observation whose simulation is not `FINISHED` (a running replay
 * leaves the previous evidence standing), whose asset is not in `assetIdMap`, whose technique is not
 * in `techniqueIdMap` (reported through `onSkippedTechnique`) or whose expectation type is neither
 * detection nor prevention.
 *
 * Platform types are trimmed, deduplicated and blanks dropped; none left yields one `'unknown'` row.
 * A type is exposed unless it is in `platform_types_succeeded`; the `'unknown'` row, which has no
 * per-type verdict to look up, follows `expectation_status` (anything but `SUCCESS`, `PARTIAL`
 * included, is exposed).
 *
 * `sourceFindingId` and `scope` come from the scenario, so every replay of it lands on the same
 * evidence. A simulation or inject OpenAEV pruned stays `null`, and the reason then drops its
 * "in simulation" clause.
 */
export const buildAttackEvidenceRows = (params: {
  observations: ReadonlyArray<AttackObservation>,
  assetIdMap: ReadonlyMap<string, string>,
  techniqueIdMap: ReadonlyMap<string, string>,
  connectorId: string,
  onSkippedTechnique?: (externalId: string) => void,
}): Array<ExpectationEvidenceRow> => {
  const { observations, assetIdMap, techniqueIdMap, connectorId, onSkippedTechnique } = params;
  const rows: Array<ExpectationEvidenceRow> = [];

  for (const observation of observations) {
    if (observation.last_simulation_status !== 'FINISHED') {
      continue;
    }
    const supportingAssetId = assetIdMap.get(observation.asset_id);
    if (!supportingAssetId) {
      continue;
    }
    const expectationType = mapExpectationType(observation.expectation_type);
    if (!expectationType) {
      continue;
    }
    const mitreTechniqueId = techniqueIdMap.get(observation.attack_pattern_external_id);
    if (!mitreTechniqueId) {
      onSkippedTechnique?.(observation.attack_pattern_external_id);
      continue;
    }

    const reportingTypes = [...new Set(
      observation.platform_types_reporting.map((type) => type.trim()).filter((type) => type !== ''),
    )];
    const succeededTypes = new Set(observation.platform_types_succeeded.map((type) => type.trim()));
    const simulationLabel = observation.last_simulation_name ?? observation.last_simulation_id;
    const simulationClause = simulationLabel ? ` in simulation ${simulationLabel}` : '';

    const verdicts = reportingTypes.length > 0
      ? reportingTypes.map((type) => ({ securityPlatformType: type, isExposed: !succeededTypes.has(type) }))
      : [{ securityPlatformType: 'unknown', isExposed: observation.expectation_status !== 'SUCCESS' }];

    for (const { securityPlatformType, isExposed } of verdicts) {
      const verb = expectationType === 'prevention'
        ? (isExposed ? 'Not prevented' : 'Prevented')
        : (isExposed ? 'Not detected' : 'Detected');
      rows.push({
        id: uuidv7(),
        supportingAssetId,
        cveId: null,
        mitreTechniqueId,
        expectationType,
        isExposed,
        securityPlatformType,
        evaluatedAt: new Date(observation.last_verified_at),
        sourceScenarioId: observation.scenario_id,
        sourceScenarioName: observation.scenario_name,
        sourceSimulationId: observation.last_simulation_id,
        sourceInjectId: observation.last_inject_id,
        connectorId,
        sourceFindingId: `scenario-${observation.scenario_id}`,
        scope: observation.scenario_id,
        reason: `${verb} by ${securityPlatformType}${simulationClause}`,
      });
    }
  }

  return rows;
};

/**
 * The CVE identifier a vulnerability observation names: `finding_type` equal to `cve` in any case and
 * a `finding_value` that, trimmed and uppercased, is a well-formed CVE id. `null` for anything else.
 * The uppercase is not cosmetic: `cve_tenantid_cveid_idx` is case-sensitive, so a lowercase value
 * would create a CVE row no enrichment connector would ever find.
 */
export const cveIdentifierOfObservation = (observation: VulnerabilityObservation): string | null => {
  if (observation.finding_type.toLowerCase() !== 'cve') {
    return null;
  }
  const value = observation.finding_value.trim().toUpperCase();
  return CVE_IDENTIFIER_PATTERN.test(value) ? value : null;
};

/**
 * Builds one CVE evidence row per vulnerability observation whose CVE (`cveIdMap`, keyed by the
 * normalised identifier) and asset (`assetIdMap`) both resolve. `sourceFindingId` is stable across
 * replays (`${openaevAssetId}:${cve}`) and `scope` is the id OpenAEV gives the asset: OpenAEV
 * assets folded onto one OpenCRQ asset each keep their own source and their own enumeration, so
 * the reconciliation of one never retires what another still reports. OpenAEV's own finding id,
 * new every run, goes to `externalReference`.
 */
export const buildVulnerabilityEvidenceRows = (params: {
  observations: ReadonlyArray<VulnerabilityObservation>,
  cveIdMap: ReadonlyMap<string, string>,
  assetIdMap: ReadonlyMap<string, string>,
  connectorId: string,
}): Array<CveEvidenceRow> => {
  const { observations, cveIdMap, assetIdMap, connectorId } = params;
  const rows: Array<CveEvidenceRow> = [];

  for (const observation of observations) {
    const cveIdentifier = cveIdentifierOfObservation(observation);
    const cveUuid = cveIdentifier === null ? undefined : cveIdMap.get(cveIdentifier);
    if (cveIdentifier === null || !cveUuid) {
      continue;
    }
    const supportingAssetId = assetIdMap.get(observation.asset_id);
    if (!supportingAssetId) {
      continue;
    }
    const simulationLabel = observation.last_simulation_name ?? observation.last_simulation_id;
    rows.push({
      id: uuidv7(),
      supportingAssetId,
      cveId: cveUuid,
      mitreTechniqueId: null,
      expectationType: null,
      isExposed: true,
      securityPlatformType: null,
      evaluatedAt: new Date(observation.last_verified_at),
      sourceScenarioId: null,
      sourceScenarioName: null,
      sourceSimulationId: observation.last_simulation_id,
      sourceInjectId: null,
      connectorId,
      sourceFindingId: `${observation.asset_id}:${cveIdentifier}`,
      externalReference: observation.last_finding_id,
      scope: observation.asset_id,
      reason: simulationLabel ? `Reported by OpenAEV in simulation ${simulationLabel}` : 'Reported by OpenAEV',
    });
  }

  return rows;
};
