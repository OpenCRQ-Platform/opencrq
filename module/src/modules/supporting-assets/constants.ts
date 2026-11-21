export const ASSET_CATEGORY_VALUES = [
  'host', 'container_workload', 'cloud_resource', 'web_application',
  'network_device', 'mobile_device', 'iot_ot_device', 'identity',
  'saas_application', 'ai_target', 'security_platform', 'generic_asset',
] as const;
export type AssetCategory = (typeof ASSET_CATEGORY_VALUES)[number];

/**
 * The to-classify bucket: an asset waiting to be categorised, never something a control runs on.
 * The control x family matrix deliberately never names it, so any family-scoped reading needs its
 * own rule for assets still sitting here.
 */
export const UNCLASSIFIED_ASSET_CATEGORY: AssetCategory = 'generic_asset';

/**
 * A detection or prevention source (EDR, SIEM, email gateway...). It is inventoried like any other
 * asset, but the CRQ readers do not count it as a loss-bearing target: see
 * `isLossBearingAssetCategory`.
 */
const SECURITY_PLATFORM_ASSET_CATEGORY: AssetCategory = 'security_platform';

/**
 * Whether a reader that weighs loss counts an asset of this category as a target. A security platform
 * is the tooling that observes the targets: it is kept in the inventory and counted in the asset mix,
 * has its own identity family with no matcher (never fused with a host), carries no applicable
 * technique, and is left out of the family gaps the attack paths set aside. Every such exclusion is
 * this rule on the reader, never a missing category.
 */
export const isLossBearingAssetCategory = (category: AssetCategory): boolean =>
  category !== SECURITY_PLATFORM_ASSET_CATEGORY;

/** OpenAEV's `AssetSubCategory`, lower-cased, the same keys across OpenAEV, XTM One and OpenCRQ. */
export const ASSET_SUBCATEGORY_VALUES = [
  'server', 'workstation', 'laptop', 'virtual_machine', 'hypervisor', 'mainframe', 'thin_client',
  'container', 'container_image', 'kubernetes_pod', 'kubernetes_cluster', 'kubernetes_node', 'serverless_function',
  'compute', 'storage', 'database', 'networking', 'serverless', 'container_registry', 'kubernetes',
  'iam_principal', 'secrets_key_mgmt', 'messaging_queue', 'analytics_data', 'ai_ml_service', 'iac_template', 'cloud_other',
  'website', 'web_api', 'single_page_app', 'graphql_api', 'web_service', 'microservice',
  'router', 'switch', 'firewall', 'load_balancer', 'vpn_gateway', 'wireless_ap', 'proxy', 'dns_server', 'dhcp_server', 'san_nas', 'network_other',
  'smartphone', 'tablet',
  'iot_sensor', 'ip_camera', 'gateway', 'point_of_sale', 'media_device', 'plc', 'rtu', 'hmi', 'scada_historian', 'medical_device', 'printer_peripheral', 'building_mgmt',
  'user_account', 'service_account', 'group', 'role', 'shared_mailbox', 'non_human_identity',
  'saas_app', 'saas_tenant',
  'llm_model', 'ai_agent', 'mcp_server', 'rag_pipeline',
  'edr', 'xdr', 'siem', 'soar', 'ndr', 'ispm', 'email_security', 'llm_firewall', 'ai_gateway', 'vulnerability_scanner',
] as const;
export type AssetSubcategory = (typeof ASSET_SUBCATEGORY_VALUES)[number];

/** Which category a subcategory belongs to — the same pairing OpenAEV's own enum carries. */
export const SUBCATEGORY_TO_CATEGORY: Record<AssetSubcategory, AssetCategory> = {
  server: 'host', workstation: 'host', laptop: 'host', virtual_machine: 'host', hypervisor: 'host', mainframe: 'host', thin_client: 'host',
  container: 'container_workload', container_image: 'container_workload', kubernetes_pod: 'container_workload', kubernetes_cluster: 'container_workload', kubernetes_node: 'container_workload', serverless_function: 'container_workload',
  compute: 'cloud_resource', storage: 'cloud_resource', database: 'cloud_resource', networking: 'cloud_resource', serverless: 'cloud_resource', container_registry: 'cloud_resource', kubernetes: 'cloud_resource',
  iam_principal: 'cloud_resource', secrets_key_mgmt: 'cloud_resource', messaging_queue: 'cloud_resource', analytics_data: 'cloud_resource', ai_ml_service: 'cloud_resource', iac_template: 'cloud_resource', cloud_other: 'cloud_resource',
  website: 'web_application', web_api: 'web_application', single_page_app: 'web_application', graphql_api: 'web_application', web_service: 'web_application', microservice: 'web_application',
  router: 'network_device', switch: 'network_device', firewall: 'network_device', load_balancer: 'network_device', vpn_gateway: 'network_device', wireless_ap: 'network_device', proxy: 'network_device', dns_server: 'network_device', dhcp_server: 'network_device', san_nas: 'network_device', network_other: 'network_device',
  smartphone: 'mobile_device', tablet: 'mobile_device',
  iot_sensor: 'iot_ot_device', ip_camera: 'iot_ot_device', gateway: 'iot_ot_device', point_of_sale: 'iot_ot_device', media_device: 'iot_ot_device', plc: 'iot_ot_device', rtu: 'iot_ot_device', hmi: 'iot_ot_device', scada_historian: 'iot_ot_device', medical_device: 'iot_ot_device', printer_peripheral: 'iot_ot_device', building_mgmt: 'iot_ot_device',
  user_account: 'identity', service_account: 'identity', group: 'identity', role: 'identity', shared_mailbox: 'identity', non_human_identity: 'identity',
  saas_app: 'saas_application', saas_tenant: 'saas_application',
  llm_model: 'ai_target', ai_agent: 'ai_target', mcp_server: 'ai_target', rag_pipeline: 'ai_target',
  edr: 'security_platform', xdr: 'security_platform', siem: 'security_platform', soar: 'security_platform', ndr: 'security_platform',
  ispm: 'security_platform', email_security: 'security_platform', llm_firewall: 'security_platform', ai_gateway: 'security_platform', vulnerability_scanner: 'security_platform',
};

/** OpenAEV's `Endpoint.PLATFORM_ARCH`, minus `Unknown`: an unrecognised or absent arch is `null`. */
export const ENDPOINT_ARCH_VALUES = ['x86_64', 'arm64'] as const;
export type EndpointArch = (typeof ENDPOINT_ARCH_VALUES)[number];

/**
 * Which directory an identity lives in, named after the `identity_provider` OpenAEV carries on its
 * own identity assets so the two products read the same word. OpenAEV leaves it free text; a closed
 * union here is what makes a new provider fail the build at every exhaustive site instead of
 * arriving as an unrecognised string. A directory neither value describes is `null`.
 */
export const ASSET_IDENTITY_PROVIDER_VALUES = ['entra', 'active_directory'] as const;
export type AssetIdentityProvider = (typeof ASSET_IDENTITY_PROVIDER_VALUES)[number];

/** OpenAEV's `Asset.AI_TARGET_PROVIDER`, lower-cased. */
export const AI_TARGET_PROVIDER_VALUES = [
  'openai_compatible', 'anthropic', 'azure_openai', 'aws_bedrock', 'google_vertex',
  'huggingface', 'ollama', 'custom_http', 'mcp_server', 'agent_http', 'xtm_one',
] as const;
export type AiTargetProvider = (typeof AI_TARGET_PROVIDER_VALUES)[number];

/**
 * OpenAEV's `CloudProvider`, lower-cased. Pairs with the free-form `cloudNativeType` (`ec2`,
 * `s3_bucket`, …) rather than standing alone, which is why only the provider is a closed set.
 */
export const CLOUD_PROVIDER_VALUES = ['aws', 'azure', 'gcp', 'oci', 'alibaba', 'kubernetes', 'other'] as const;
export type CloudProvider = (typeof CLOUD_PROVIDER_VALUES)[number];

/** OpenAEV's `Asset.AI_TARGET_MODALITY`, lower-cased. */
export const AI_TARGET_MODALITY_VALUES = ['text', 'vision', 'audio', 'multimodal'] as const;
export type AiTargetModality = (typeof AI_TARGET_MODALITY_VALUES)[number];

/** `mapped` orders on membership of a risk scope's mapping, and falls back to the name without one. */
export const ASSET_SORT_KEYS = ['name', 'categoryId', 'subcategoryId', 'exposure', 'criticality', 'lastSeenAt', 'posture', 'mapped'] as const;
export type AssetSortKey = (typeof ASSET_SORT_KEYS)[number];

/** The orderings of the findings of one CVE, each on the asset it is found on. */
export const CVE_AFFECTED_ASSET_SORT_KEYS = ['assetName', 'assetCategoryId', 'assetCriticality', 'currentState', 'stateChangedAt'] as const;
/** A technique adds how each result was tested. */
export const TECHNIQUE_AFFECTED_ASSET_SORT_KEYS = [...CVE_AFFECTED_ASSET_SORT_KEYS, 'expectationType', 'securityPlatformType'] as const;
export type AffectedAssetSortKey = (typeof TECHNIQUE_AFFECTED_ASSET_SORT_KEYS)[number];
/** The longest search a findings list takes. */
export const FINDINGS_SEARCH_MAX_LENGTH = 200;
/** The longest ATT&CK technique id a findings filter takes. */
export const TECHNIQUE_EXTERNAL_ID_MAX_LENGTH = 32;
/** A CVE by its identifier (`CVE-2021-44228`), a technique by its row id. */
export type AffectedAssetsFlaw = { cveId: string } | { mitreTechniqueId: string };
/** What an activity heatmap counts the findings of: a flaw across the estate, or one asset. */
export type EvidenceActivityScope = AffectedAssetsFlaw | { supportingAssetId: string };
/** The 52 weeks an activity heatmap draws, today included. */
export const EVIDENCE_ACTIVITY_DAYS = 364;

/**
 * What produced a `supporting_asset_sources` row: a connector's own observation, or a person's
 * manual entry — recorded as one more observation so it can be adopted by a matching connector
 * later, same as any other source. See `supportingAssetSources.origin` (schema.ts) for why this
 * cannot be read off `connectorId` instead.
 */
export const ASSET_SOURCE_ORIGIN_VALUES = ['connector', 'user'] as const;
export type AssetSourceOrigin = (typeof ASSET_SOURCE_ORIGIN_VALUES)[number];

/**
 * A typed link a connector observes between two assets, read from its first end to its second.
 * `primary_user_of` runs from an identity to the device it is the primary user of. It is not a
 * dependency: nothing fails along it, which is why it never shares the dependency link tables.
 * `reachable_from` runs from an asset an attack path reached to the asset it was reached from, as
 * OpenAEV showed it in a simulation: it is not a dependency either, it is a way in.
 */
export const ASSET_RELATION_KIND_VALUES = ['primary_user_of', 'reachable_from'] as const;
export type AssetRelationKind = (typeof ASSET_RELATION_KIND_VALUES)[number];

/** Which of a connector's reads produced a relation: they are not equally strong, and the detail names it. */
export const ASSET_RELATION_SOURCE_VALUES = [
  'entra_registered_owner',
  'intune_primary_user',
  // An attack-path hop an OpenAEV execution ran and nothing prevented.
  'openaev_attack_path_proven',
  // An attack-path hop OpenAEV drew with no verdict on it yet: the conditions are met, no execution proved it.
  'openaev_attack_path_inferred',
] as const;
export type AssetRelationSource = (typeof ASSET_RELATION_SOURCE_VALUES)[number];

/**
 * An attack-path hop OpenAEV has not confirmed for this long reads as stale: it is kept, never
 * deleted by the sync, and no longer counts towards what a finding can reach.
 */
export const ATTACK_PATH_STALE_AFTER_DAYS = 30;

/**
 * The attributes a resolution rule can produce and a person can therefore override by hand.
 * `ownerId` is excluded: the platform owns it, no source reports it, and there is no rule to hold
 * against a resync.
 */
export const ASSET_MANUAL_ATTRIBUTE_VALUES = ['name', 'category', 'exposure', 'criticality', 'description', 'subcategory', 'url', 'linkedPerson'] as const;
export type AssetManualAttribute = (typeof ASSET_MANUAL_ATTRIBUTE_VALUES)[number];

/** Ordered from least to most severe: several readers render the bands in declaration order. */
export const DECLARED_CRITICALITY_VALUES = ['low', 'medium', 'high', 'very_high'] as const;
export type DeclaredCriticality = (typeof DECLARED_CRITICALITY_VALUES)[number];

export const ASSET_CRITICALITY_VALUES = ['unknown', ...DECLARED_CRITICALITY_VALUES] as const;
export type AssetCriticality = (typeof ASSET_CRITICALITY_VALUES)[number];

/** The criticality an asset counts as, an unknown one being what the tenant setting says. */
export const countedCriticality = (
  criticality: AssetCriticality,
  unknownCriticalityCountsAs: DeclaredCriticality,
): DeclaredCriticality => (criticality === 'unknown' ? unknownCriticalityCountsAs : criticality);

/** Each band's rank, least severe first: the one ladder every comparison of two bands reads. */
export const ASSET_CRITICALITY_SEVERITY: Readonly<Record<AssetCriticality, number>> = {
  unknown: 0, low: 1, medium: 2, high: 3, very_high: 4,
};

/**
 * The rule behind a connector's criticality reading, so a band says why it reads what it reads. The
 * role rules come first, in the order that names a reading when two of them yield the same band.
 */
export const ASSET_CRITICALITY_RULE_VALUES = [
  'domain_controller', 'certificate_services', 'federation_services', 'entra_connect', 'hypervisor', 'backup',
  'asset_value_very_high', 'asset_value_high', 'asset_value_low',
] as const;
export type AssetCriticalityRule = (typeof ASSET_CRITICALITY_RULE_VALUES)[number];

export const EXPECTATION_TYPE_VALUES = ['detection', 'prevention'] as const;
export type ExpectationType = (typeof EXPECTATION_TYPE_VALUES)[number];

/**
 * Why a finding was set aside, in two levels.
 *
 * One dismissed state carries two statements and the type is what tells them apart: a real finding
 * the organisation chooses to live with, which is reversible and wants review, against a finding
 * that is not true here, which wants an ingestion fix. The reason code below it serves reporting,
 * and every type keeps an `other` escape hatch because no closed list foresees everything.
 */
export const DISMISSAL_TYPE_VALUES = ['risk_accepted', 'false_positive'] as const;
export type DismissalType = (typeof DISMISSAL_TYPE_VALUES)[number];

export const DISMISSAL_REASON_CODE_VALUES = [
  'wont_fix',
  'patch_unavailable',
  'downtime_not_permitted',
  'application_incompatibility',
  'compensatory_control_applied',
  'technical_debt_or_eol',
  'not_externally_exposed',
  'business_exception',
  'vendor_dependency',
  'detection_error',
  'not_applicable',
  'other',
] as const;
export type DismissalReasonCode = (typeof DISMISSAL_REASON_CODE_VALUES)[number];

/**
 * Which codes a type accepts. A code is only meaningful under its own type, so the pair is
 * validated together rather than each half on its own.
 */
export const DISMISSAL_REASON_CODES_BY_TYPE: Record<DismissalType, ReadonlyArray<DismissalReasonCode>> = {
  risk_accepted: [
    'wont_fix',
    'patch_unavailable',
    'downtime_not_permitted',
    'application_incompatibility',
    'compensatory_control_applied',
    'technical_debt_or_eol',
    'not_externally_exposed',
    'business_exception',
    'vendor_dependency',
    'other',
  ],
  false_positive: ['detection_error', 'not_applicable', 'other'],
};

export const EVIDENCE_STATES = ['applicable', 'dismissed'] as const;

export type EvidenceState = (typeof EVIDENCE_STATES)[number];

/** The state of a finding no history row has spoken for yet. */
export const DEFAULT_EVIDENCE_STATE: EvidenceState = 'applicable';

/**
 * Why a finding is in the state its history row records. The three sync causes are derived from the
 * finding's sources: one still reports it exposed (`exposed`), one still reports it and none exposed
 * (`not_exposed`), or none reports it any more (`no_longer_reported`). The other two are a person's
 * decision (`user`) and a person handing the finding back to its sources (`reset`).
 *
 * A history row is never a test run: those are `asset_evidence_verdicts`.
 */
export const EVIDENCE_HISTORY_ORIGINS = ['exposed', 'not_exposed', 'no_longer_reported', 'user', 'reset'] as const;
export type EvidenceHistoryOrigin = (typeof EVIDENCE_HISTORY_ORIGINS)[number];

/** The causes derived from a finding's sources, as opposed to a person's decision or handover. */
export const SYNC_ORIGINS = ['exposed', 'not_exposed', 'no_longer_reported'] as const satisfies ReadonlyArray<EvidenceHistoryOrigin>;
