import type { AiTargetModality, AiTargetProvider, AssetCategory, AssetCriticality, AssetCriticalityRule, AssetIdentityProvider, AssetManualAttribute, AssetSourceOrigin, AssetSubcategory, CloudProvider, EndpointArch } from './constants';
import type { SupportingAssetExposure } from './schema';

/**
 * What a `machine`-family observation carries — a host, container workload, cloud resource,
 * mobile device, network device or IoT/OT device. Nothing here is meaningful on any other family,
 * which is the point of a discriminated block rather than a flat bag of optional fields: an
 * `ai_target` matcher reading `hostname` off an observation that carries none is a type error, not
 * a silent `undefined`.
 */
export interface MachineAssetProperties {
  family: 'machine',
  hostname: string | null,
  ipAddresses: ReadonlyArray<string>,
  macAddresses: ReadonlyArray<string>,
  seenIp: string | null,
  hardwareUuid: string | null,
  directoryDeviceId: string | null,
  cloudVmId: string | null,
  cloudResourceId: string | null,
  cloudProvider: CloudProvider | null,
  cloudNativeType: string | null,
  cloudRegion: string | null,
  /** The OS family (`normalizePlatform`), never a connector's own spelling: two of them never agree. */
  platform: string | null,
  arch: EndpointArch | null,
  vendor: string | null,
  model: string | null,
  operatingSystem: string | null,
  osVersion: string | null,
  isEol: boolean | null,
  agentExternalReference: string | null,
  agentExecutorType: string | null,
}

/**
 * What an `ai_target`-family observation carries — an LLM model, AI agent, MCP server or RAG
 * pipeline. `systemPrompt` is prose, not an identifier, and plays no part in matching: only
 * `normalizedEndpointUrl` and `model` do, and only together.
 */
export interface AiTargetAssetProperties {
  family: 'ai_target',
  provider: AiTargetProvider | null,
  endpointUrl: string | null,
  normalizedEndpointUrl: string | null,
  model: string | null,
  modality: AiTargetModality | null,
  systemPrompt: string | null,
}

/**
 * What an `identity`-family observation carries — a user account, a service account, a service
 * principal or a managed identity. The three identifiers are what the matcher joins on, and they
 * are kept apart rather than folded into one key because a directory record and an account first
 * seen in a logon event arrive under different ones.
 *
 * `department` and `jobTitle` are descriptive: no rule reads them, since an identity's criticality
 * is technical privilege and business role is a question this model does not answer.
 */
export interface IdentityAssetProperties {
  family: 'identity',
  directoryObjectId: string | null,
  cloudSid: string | null,
  onPremSid: string | null,
  userPrincipalName: string | null,
  accountDomain: string | null,
  accountName: string | null,
  directoryType: string | null,
  identityProvider: AssetIdentityProvider | null,
  department: string | null,
  jobTitle: string | null,
  isEnabled: boolean | null,
  assignedRoles: ReadonlyArray<string>,
  privilegedPimRoles: ReadonlyArray<string>,
}

/**
 * The per-family block, discriminated on `family` (one identity family, one property table, one
 * matcher). Optional on both `AssetObservation` and `ConnectorAssetInput`: a family with no
 * property table (`application`, `unclassified`) simply carries none — there is no empty variant to
 * match on, since an empty case exists only to be forgotten in a switch.
 */
export type AssetObservationProperties = MachineAssetProperties | AiTargetAssetProperties | IdentityAssetProperties;

/**
 * The `machine` block as a connector hands it over: every field optional, pre-normalisation —
 * unlike `MachineAssetProperties`, which is what the platform derives *from* it (arrays default to
 * `[]`, identifiers are trimmed). A connector that does not yet serve one field simply leaves it out.
 */
export interface MachineConnectorProperties {
  family: 'machine',
  hostname?: string | null,
  ipAddresses?: ReadonlyArray<string> | null,
  macAddresses?: ReadonlyArray<string> | null,
  seenIp?: string | null,
  hardwareUuid?: string | null,
  directoryDeviceId?: string | null,
  cloudVmId?: string | null,
  cloudResourceId?: string | null,
  cloudProvider?: CloudProvider | null,
  cloudNativeType?: string | null,
  cloudRegion?: string | null,
  platform?: string | null,
  arch?: EndpointArch | null,
  vendor?: string | null,
  model?: string | null,
  operatingSystem?: string | null,
  osVersion?: string | null,
  isEol?: boolean | null,
  agentExternalReference?: string | null,
  agentExecutorType?: string | null,
}

/**
 * The `ai_target` block as a connector hands it over: every field optional, and `endpointUrl` is
 * the raw address — `normalizedEndpointUrl` is derived by the platform (`normalizeEndpointUrl`),
 * never supplied by a connector.
 */
export interface AiTargetConnectorProperties {
  family: 'ai_target',
  provider?: AiTargetProvider | null,
  endpointUrl?: string | null,
  model?: string | null,
  modality?: AiTargetModality | null,
  systemPrompt?: string | null,
}

/**
 * The `identity` block as a connector hands it over: every field optional, and `identityProvider`
 * is derived by the platform from which SID is present, never supplied by a connector.
 */
export interface IdentityConnectorProperties {
  family: 'identity',
  directoryObjectId?: string | null,
  cloudSid?: string | null,
  onPremSid?: string | null,
  userPrincipalName?: string | null,
  accountDomain?: string | null,
  accountName?: string | null,
  directoryType?: string | null,
  department?: string | null,
  jobTitle?: string | null,
  isEnabled?: boolean | null,
  assignedRoles?: ReadonlyArray<string> | null,
  privilegedPimRoles?: ReadonlyArray<string> | null,
}

export type ConnectorAssetProperties = MachineConnectorProperties | AiTargetConnectorProperties | IdentityConnectorProperties;

/**
 * An identity's block as a person types it: the directory it lives in is stated, where a
 * connector's is derived from the SID it read.
 */
export type IdentityManualProperties = IdentityConnectorProperties & { identityProvider?: AssetIdentityProvider | null };

/** The blocks a person can type by hand, one per family. */
export type ManualAssetProperties = MachineConnectorProperties | AiTargetConnectorProperties | IdentityManualProperties;

/**
 * The single shape every connector must produce for an inventory asset.
 * `categoryId` is mandatory and non-nullable: a connector that cannot interpret
 * its source resolves to `generic_asset` rather than handing over an
 * unclassified asset. Provenance is stamped by the platform, not the connector.
 *
 * The identity fields are all optional: a connector that does not yet serve one simply leaves it
 * out, and the matcher's tiers degrade silently — a tier that needs the field never fires for
 * that row.
 */
export interface ConnectorAssetInput {
  sourceAssetId: string,
  categoryId: AssetCategory,
  subcategoryId?: AssetSubcategory | null,
  connectorId: string,
  /** The connector's stable slug (`integration_settings.source`, e.g. `'microsoft_graph'`) — what gates tier 0. */
  source: string,
  name?: string | null,
  description?: string | null,
  exposure?: SupportingAssetExposure,
  criticality?: AssetCriticality,
  /** The rule behind `criticality`, so the detail can say why the asset reads it. */
  criticalityRule?: AssetCriticalityRule | null,
  /** The id the customer's own system gave the asset (OpenAEV's `asset_external_reference`) — the only cross-family identifier a source may report. */
  externalReference?: string | null,
  url?: string | null,
  linkedPerson?: string | null,
  firstSeenAt?: Date | null,
  lastSeenAt?: Date | null,
  /** The Defender machine id this device was merged into, when Defender reports a self-merge. */
  mergedIntoSourceAssetId?: string | null,
  /**
   * The markings the source states on the asset, as STIX marking ids (CTEM marking parity, G4). Left
   * out by a source that marks nothing; the asset carries the union over its sources.
   */
  markingRefs?: ReadonlyArray<string>,
  properties?: ConnectorAssetProperties,
}

/**
 * One connector's report about one canonical asset — the shape the identity matcher and the
 * attribute resolver both read. `source` is the connector's stable slug (`integration_settings.source`,
 * e.g. `'microsoft_graph'`), resolved by the caller so the pure logic here never touches the DB.
 */
export interface AssetObservation {
  id: string,
  connectorId: string | null,
  /** What produced this observation — see `supportingAssetSources.origin` (schema.ts). */
  origin: AssetSourceOrigin,
  source: string | null,
  sourceAssetId: string,
  reportedName: string | null,
  reportedCategoryId: AssetCategory,
  reportedSubcategoryId: AssetSubcategory | null,
  reportedDescription: string | null,
  reportedExposure: SupportingAssetExposure,
  reportedCriticality: AssetCriticality,
  externalReference: string | null,
  reportedUrl: string | null,
  reportedLinkedPerson: string | null,
  firstSeenAt: Date | null,
  lastSeenAt: Date | null,
  /** The later of this source's last change and its last sighting of the asset, for arbitration between sources (`sourceLastActivityAt`, repository.ts). */
  sourceLastActivityAt: Date,
  properties?: AssetObservationProperties,
}

/** A value a person set by hand on the asset, outranking every resolution rule. */
export interface AssetManualValue {
  attribute: AssetManualAttribute,
  value: string,
}

/** Spelled as the source spells it, never normalised: one product carries a different name per platform. */
export interface ReportedSoftware {
  vendor: string | null,
  name: string,
  version: string,
}
