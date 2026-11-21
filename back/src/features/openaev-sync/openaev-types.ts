import { z } from 'zod';
import type { ExpectationType } from '@app/module';
import type { OpenaevLegacyResumeState } from './legacy/openaev-legacy-types';

export const openaevPageSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    content: z.array(itemSchema),
    totalElements: z.number(),
    totalPages: z.number(),
    number: z.number(),
    size: z.number(),
    last: z.boolean(),
  });

export const tenantOutputSchema = z.object({
  tenant_id: z.string(),
  tenant_name: z.string(),
});
export type TenantOutput = z.infer<typeof tenantOutputSchema>;

const agentExecutorSchema = z.looseObject({
  executor_type: z.string().nullable().optional(),
});

/** `agent_executor` is a union because the payload is: the inventory DTO embeds the executor, the raw entity names it by id. */
export const agentSchema = z.looseObject({
  agent_id: z.string().nullable().optional(),
  agent_external_reference: z.string().nullable().optional(),
  agent_executor: z.union([agentExecutorSchema, z.string()]).nullable().optional(),
  agent_last_seen: z.string().nullable().optional(),
});
export type OpenaevAgent = z.infer<typeof agentSchema>;

/** One row of the unified inventory (`POST /assets/search`), separate from the detail schemas below because it carries neither machine identity nor description. */
export const assetInventoryRowSchema = z.looseObject({
  asset_id: z.string(),
  /**
   * OpenAEV's single-table discriminator (`endpoint`, `asset`, `ai_target`), not the category:
   * `/endpoints/find` is backed by the endpoint repository, so it answers for `endpoint` rows and
   * silently omits every other one. A `CLOUD_RESOURCE` created as a generic asset is a `MACHINE`
   * family category on an `asset` row, which is why the enrichment pass routes on this and not on
   * `asset_category`.
   */
  asset_type: z.string().nullable().optional(),
  asset_name: z.string().nullable().optional(),
  asset_external_reference: z.string().nullable().optional(),
  asset_category: z.string().nullable().optional(),
  asset_subcategory: z.string().nullable().optional(),
  asset_criticality: z.string().nullable().optional(),
  asset_internet_facing: z.boolean().nullable().optional(),
  asset_tags: z.array(z.string()).nullable().optional(),
  endpoint_platform: z.string().nullable().optional(),
  asset_agents: z.array(agentSchema).nullable().optional(),
});
export type AssetInventoryRow = z.infer<typeof assetInventoryRowSchema>;

/**
 * A full `Endpoint` entity (`POST /endpoints/find`).
 *
 * Strict rather than `looseObject`, unlike every other schema here: the raw entity carries
 * `ai_target_token` on every asset, and a permissive schema would keep that unknown key in the
 * parsed object instead of dropping it at the boundary.
 */
export const endpointEntitySchema = z.object({
  asset_id: z.string(),
  asset_description: z.string().nullable().optional(),
  // Descriptive attributes OpenAEV carries on `Asset` and serialises on every raw entity. They cost
  // nothing here — the call is already made for the machine identity below.
  asset_url: z.string().nullable().optional(),
  asset_linked_person: z.string().nullable().optional(),
  asset_cloud_provider: z.string().nullable().optional(),
  asset_cloud_native_type: z.string().nullable().optional(),
  asset_cloud_region: z.string().nullable().optional(),
  asset_hostname: z.string().nullable().optional(),
  asset_ips: z.array(z.string()).nullable().optional(),
  asset_mac_addresses: z.array(z.string()).nullable().optional(),
  asset_seen_ip: z.string().nullable().optional(),
  endpoint_platform: z.string().nullable().optional(),
  endpoint_arch: z.string().nullable().optional(),
  endpoint_is_eol: z.boolean().nullable().optional(),
  asset_agents: z.array(agentSchema).nullable().optional(),
});
export type EndpointEntity = z.infer<typeof endpointEntitySchema>;

/** A full `Asset` entity restricted to `category = AI_TARGET` (`POST /ai_targets/search`), strict for the same reason as the schema above. */
export const aiTargetAssetSchema = z.object({
  asset_id: z.string(),
  asset_name: z.string().nullable().optional(),
  asset_description: z.string().nullable().optional(),
  asset_external_reference: z.string().nullable().optional(),
  asset_category: z.string().nullable().optional(),
  asset_subcategory: z.string().nullable().optional(),
  asset_criticality: z.string().nullable().optional(),
  asset_internet_facing: z.boolean().nullable().optional(),
  asset_tags: z.array(z.string()).nullable().optional(),
  ai_target_provider: z.string().nullable().optional(),
  ai_target_endpoint: z.string().nullable().optional(),
  ai_target_model: z.string().nullable().optional(),
  ai_target_modality: z.string().nullable().optional(),
  ai_target_system_prompt: z.string().nullable().optional(),
});
export type AiTargetAsset = z.infer<typeof aiTargetAssetSchema>;

/** `POST /users/find`, the batch lookup that turns an asset's `asset_linked_person` id into a name. */
export const openaevUserSchema = z.looseObject({
  user_id: z.string(),
  user_email: z.string().nullable().optional(),
  user_firstname: z.string().nullable().optional(),
  user_lastname: z.string().nullable().optional(),
});
export type OpenaevUser = z.infer<typeof openaevUserSchema>;

export const openaevTagSchema = z.looseObject({
  tag_id: z.string(),
  tag_name: z.string(),
  tag_color: z.string().nullable().optional(),
});
export type OpenaevTag = z.infer<typeof openaevTagSchema>;

/**
 * `GET /asset_groups` (the `AssetGroup` entity): its static members in `asset_group_assets` and the
 * members its dynamic filter resolves to at read time in `asset_group_dynamic_assets`, both as ids.
 */
export const openaevAssetGroupSchema = z.looseObject({
  asset_group_id: z.string(),
  asset_group_name: z.string(),
  asset_group_description: z.string().nullable().optional(),
  asset_group_assets: z.array(z.string()).nullable().optional(),
  asset_group_dynamic_assets: z.array(z.string()).nullable().optional(),
});
export type OpenaevAssetGroup = z.infer<typeof openaevAssetGroupSchema>;

/** `GET /attack-path/simulations`: the simulations of the tenant that hold attack-path executions. */
export const attackPathSimulationSchema = z.looseObject({
  simulationId: z.string(),
  endpointCount: z.number().optional(),
  executionCount: z.number().optional(),
});
export type AttackPathSimulation = z.infer<typeof attackPathSimulationSchema>;

/**
 * `GET /attack-path/simulations/{id}/graph?mode=collapsed`, the parts the sync reads: the nodes with
 * their type, the OpenAEV id they stand for (`ref`, the asset id for an asset node) and the worst
 * verdict of the executions that reached them (`status`: RED neither prevented nor detected, ORANGE
 * detected only, GREEN prevented), and the source-to-target edges between them.
 */
export const attackPathGraphSchema = z.looseObject({
  attackPathNodes: z.array(z.looseObject({
    id: z.string(),
    type: z.string().nullable().optional(),
    ref: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
  })).nullable().optional(),
  attackPathEdges: z.array(z.looseObject({
    edgeSourceId: z.string(),
    edgeTargetId: z.string(),
  })).nullable().optional(),
});
export type AttackPathGraph = z.infer<typeof attackPathGraphSchema>;

/**
 * `GET /assets/{id}` (`EndpointOverviewOutput`), the only route serving a description for an asset
 * that is neither an endpoint nor an AI target — one call per asset, which is why it is reserved
 * for exactly those.
 *
 * Its mapper has two branches and only the endpoint one fills `asset_url`, the cloud block and
 * `asset_linked_person`; a generic asset comes back without them however they are stored. They are
 * read here all the same, since the same route answers for both and an endpoint reaching this pass
 * should not lose them.
 *
 * Strict rather than `looseObject`, like the other detail schemas: this DTO omits `ai_target_token`
 * by construction, and the strictness keeps that true if it ever stops omitting it.
 */
export const assetOverviewSchema = z.object({
  asset_id: z.string(),
  asset_description: z.string().nullable().optional(),
  asset_url: z.string().nullable().optional(),
  asset_linked_person: z.string().nullable().optional(),
  asset_cloud_provider: z.string().nullable().optional(),
  asset_cloud_native_type: z.string().nullable().optional(),
  asset_cloud_region: z.string().nullable().optional(),
});
export type AssetOverview = z.infer<typeof assetOverviewSchema>;

/** Envelope shared by both snapshot streams (`POST /snapshot/{attack,vulnerability}-observations/search`). */
export const snapshotSearchOutputSchema = <T extends z.ZodType>(observationSchema: T) =>
  z.looseObject({
    observations: z.array(observationSchema),
    /** Echoes the received cursor on an empty page; `null` only for a cursor-less request that matched nothing. */
    next_cursor: z.string().nullable(),
    /** `true` on an exactly-full last page too: the next page is then empty. */
    has_more: z.boolean(),
    snapshot_ready: z.boolean(),
  });

/** Spelled out because `Omit` over the loose envelope drops its known keys together with `observations`. */
export interface SnapshotPage<T> {
  observations: Array<T>,
  next_cursor: string | null,
  has_more: boolean,
  snapshot_ready: boolean,
}

/**
 * One (asset, technique, expectation type, scenario) document of the attack stream, typed on the
 * fields the connector reads and loose on the rest, so a field OpenAEV adds, drops or nulls elsewhere
 * never fails a page. Status, type and platform-type fields stay plain strings: an unknown value
 * reaches the mapping, which ignores it. The `last_*` fields and names are nullable because OpenAEV
 * prunes them without re-emitting the document when the simulation or inject is deleted.
 */
export const attackObservationSchema = z.looseObject({
  id: z.string(),
  updated_at: z.string(),
  asset_id: z.string(),
  scenario_id: z.string(),
  scenario_name: z.string().nullable(),
  last_simulation_id: z.string().nullable(),
  last_simulation_name: z.string().nullable(),
  last_simulation_start_date: z.string().nullable(),
  last_simulation_status: z.string(),
  last_inject_id: z.string().nullable(),
  attack_pattern_external_id: z.string(),
  expectation_type: z.string(),
  expectation_status: z.string(),
  platform_types_reporting: z.array(z.string()).default([]),
  platform_types_succeeded: z.array(z.string()).default([]),
  last_verified_at: z.string(),
});
export type AttackObservation = z.infer<typeof attackObservationSchema>;

/** One (asset, finding type, finding value) document of the vulnerability stream; OpenAEV does not normalise `finding_value`. */
export const vulnerabilityObservationSchema = z.looseObject({
  id: z.string(),
  updated_at: z.string(),
  asset_id: z.string(),
  last_finding_id: z.string().nullable(),
  last_scenario_id: z.string().nullable(),
  last_simulation_id: z.string().nullable(),
  last_simulation_name: z.string().nullable(),
  finding_type: z.string(),
  finding_value: z.string(),
  last_verified_at: z.string(),
});
export type VulnerabilityObservation = z.infer<typeof vulnerabilityObservationSchema>;

export interface OpenaevSyncPayload extends Record<string, unknown> {
  serviceAccountId: string,
}

export interface OpenaevSyncState extends Record<string, unknown>, Partial<OpenaevLegacyResumeState> {
  /**
   * Set once the whole-inventory pass (every OpenAEV tenant: tags, assets, machine and AI target
   * properties) has completed, so a resumed job rebuilds its
   * `sourceAssetId → supportingAssetId` map from `supporting_asset_sources`
   * (`supportingAssets.getInventoryAssetIdMap`) instead of re-paginating the inventory or carrying
   * that map — which can run to megabytes on a large estate — through every state snapshot of the
   * run.
   */
  inventoryComplete: boolean,
}

export interface ExpectationEvidenceRow {
  id: string,
  supportingAssetId: string,
  cveId: null,
  mitreTechniqueId: string,
  expectationType: ExpectationType,
  isExposed: boolean,
  securityPlatformType: string,
  evaluatedAt: Date,
  sourceScenarioId: string,
  sourceScenarioName: string | null,
  sourceSimulationId: string | null,
  sourceInjectId: string | null,
  connectorId: string,
  sourceFindingId: string,
  scope: string,
  reason: string | null,
}

export interface CveEvidenceRow {
  id: string,
  supportingAssetId: string,
  cveId: string,
  mitreTechniqueId: null,
  expectationType: null,
  isExposed: boolean,
  securityPlatformType: null,
  evaluatedAt: Date,
  sourceScenarioId: null,
  sourceScenarioName: null,
  sourceSimulationId: string | null,
  sourceInjectId: string | null,
  connectorId: string,
  sourceFindingId: string,
  externalReference: string | null,
  scope: string,
  reason: string | null,
}
