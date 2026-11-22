import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { boolean, check, foreignKey, index, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { AiTargetModality, AiTargetProvider, AssetCategory, AssetCriticality, AssetCriticalityRule, AssetIdentityProvider, AssetManualAttribute, AssetRelationKind, AssetRelationSource, AssetSourceOrigin, AssetSubcategory, CloudProvider, DismissalReasonCode, DismissalType, EndpointArch, EvidenceHistoryOrigin, EvidenceState, ExpectationType } from './constants';
import type { AssetOwnerSource } from './owner-resolution';
import { defineSecurityPolicies, nativeMarkingPolicy, supportingAssetMarkingPolicy, tenantIsolationPolicy } from '../../security';
import { supportingAssetTenantIsolationPolicy } from '../../security/policies/tenant-policies';
import { mitreTechniques } from '../mitre-attack/schema';
import { integrationSettings } from '../integration-settings/schema';
import { cve } from '../cve/schema';
import { tenants } from '../tenants';
import { users } from '../users';
import { ASSET_CRITICALITY_RULE_VALUES, ASSET_RELATION_KIND_VALUES, ASSET_RELATION_SOURCE_VALUES, DEFAULT_EVIDENCE_STATE } from './constants';

export {
  AI_TARGET_MODALITY_VALUES,
  AI_TARGET_PROVIDER_VALUES,
  ASSET_CATEGORY_VALUES,
  ASSET_CRITICALITY_RULE_VALUES,
  ASSET_CRITICALITY_VALUES,
  ASSET_IDENTITY_PROVIDER_VALUES,
  ASSET_MANUAL_ATTRIBUTE_VALUES,
  ASSET_RELATION_KIND_VALUES,
  ASSET_RELATION_SOURCE_VALUES,
  ASSET_SORT_KEYS,
  ASSET_SOURCE_ORIGIN_VALUES,
  ASSET_SUBCATEGORY_VALUES,
  CLOUD_PROVIDER_VALUES,
  ENDPOINT_ARCH_VALUES,
  EXPECTATION_TYPE_VALUES,
  SUBCATEGORY_TO_CATEGORY,
} from './constants';
export type { AiTargetModality, AiTargetProvider, AssetCategory, AssetCriticality, AssetCriticalityRule, AssetIdentityProvider, AssetManualAttribute, AssetRelationKind, AssetRelationSource, AssetSortKey, AssetSourceOrigin, AssetSubcategory, CloudProvider, EndpointArch, EvidenceHistoryOrigin, EvidenceState, ExpectationType } from './constants';

const literals = (values: ReadonlyArray<string>) => sql.raw(values.map((value) => `'${value}'`).join(', '));

export type SupportingAssetExposure = 'internet_facing' | 'internal' | 'unknown';
export type DeclaredExposure = Exclude<SupportingAssetExposure, 'unknown'>;

export const ASSET_EVIDENCE_UNIQUE = 'asset_evidence_uq';
/**
 * The columns of `asset_evidence_uq`, in its order, each with its type: what the sync's upsert
 * conflicts on and dedupes by, and the order findings are locked in (`finding-lock-order.ts`).
 * `finding-lock-order.test.ts` checks it against the constraint.
 */
export const ASSET_EVIDENCE_KEY = [
  { column: 'supportingAssetId', type: 'uuid' },
  { column: 'cveId', type: 'uuid' },
  { column: 'mitreTechniqueId', type: 'uuid' },
  { column: 'expectationType', type: 'text' },
  { column: 'securityPlatformType', type: 'text' },
  { column: 'sourceScenarioId', type: 'text' },
] as const;
export const TAG_NAME_UNIQUE = 'tags_tenant_name_uq';
export const EVIDENCE_HISTORY_TENANT_FK = 'asset_evidence_history_evidence_tenant_fk';

/**
 * The canonical asset: one row per real machine, whatever number of connectors report it.
 * `name`/`exposure`/`categoryId`/`criticality`/`firstSeenAt`/`lastSeenAt` are derived values,
 * materialised here from `supportingAssetSources` by `reprojectSupportingAssets` so every
 * existing reader (CRQ, finding scores, dashboards) keeps reading the consolidated estate
 * without being rewritten. A value a user set by hand is recorded in
 * `supportingAssetManualValues` and outranks the derivation.
 */
export const supportingAssets = pgTable('supporting_assets', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name'),
  description: text('description'),
  ownerId: uuid('owner_id').references(() => users.id),
  /** Who set `owner_id`: `manual` (a person) or `resolved` (a push matched an owner name); null without an owner. */
  ownerSource: text('owner_source').$type<AssetOwnerSource>(),
  exposure: text('exposure').$type<SupportingAssetExposure>().notNull().default('unknown'),
  categoryId: text('category_id').notNull().$type<AssetCategory>(),
  subcategoryId: text('subcategory_id').$type<AssetSubcategory>(),
  criticality: text('criticality').notNull().default('unknown').$type<AssetCriticality>(),
  /** The id the customer's own system gave the asset (OpenAEV's `asset_external_reference`). */
  externalReference: text('external_reference'),
  /**
   * Two fields OpenAEV carries on the asset itself rather than on a category block, and shows in
   * its own generic Information card: the address a web-facing asset answers on, and the person an
   * identity asset stands for. Descriptive only — no matcher tier reads either, which is why they
   * live here rather than in a per-family property table.
   */
  url: text('url'),
  linkedPerson: text('linked_person'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  /** A name deduced from the resolved properties, kept whether or not `name` is set; never a person's or a connector's own word. */
  derivedName: text('derived_name'),
  /**
   * The OpenCRQ markings the asset carries, by STIX id (CTEM marking parity, G2): a person reads it
   * only when they are cleared for all of them (`nativeMarkingPolicy`). Unmarked by default.
   */
  markingRefs: text('marking_refs').array().notNull().default(sql`'{}'::text[]`),
  /** What lists sort and search on: `name`, or the derived one when the asset has none. */
  displayName: text('display_name').generatedAlwaysAs(sql`coalesce(name, derived_name)`),
  /** `display_name` folded for search and order; a generated column cannot read another one, hence the repeated expression. */
  displayNameFolded: text('display_name_folded').generatedAlwaysAs(sql`fold_text(coalesce(name, derived_name))`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Redundant with the primary key, and what a composite foreign key naming the tenant can point at.
  unique('supporting_assets_id_tenant_id_uq').on(table.id, table.tenantId),
  // Every list of the estate is one tenant's, ordered by folded display name and tied on the id: the whole
  // order comes from this index instead of sorting the park.
  index('supporting_assets_tenant_display_name_idx').on(table.tenantId, table.displayNameFolded, sql`${table.displayName} collate "C"`, table.id),
]);

defineSecurityPolicies(supportingAssets, tenantIsolationPolicy, nativeMarkingPolicy);

/**
 * One row per connector reporting an asset. This table carries the identity that used to sit
 * on `supporting_assets` itself: `(tenantId, connectorId, sourceAssetId)` is the per-source key
 * ingestion upserts on, and the normalised identity columns are what the matcher in
 * `asset-identity.ts` reads to decide whether two observations describe the same machine.
 * A hand-created asset has no row here.
 */
export const supportingAssetSources = pgTable('supporting_asset_sources', {
  id: uuid('id').primaryKey(),
  supportingAssetId: uuid('supporting_asset_id').notNull().references(() => supportingAssets.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  connectorId: uuid('connector_id').references(() => integrationSettings.id, { onDelete: 'set null' }),
  /**
   * What produced this row: a connector's own observation, or a person's manual entry.
   *
   * `connectorId IS NULL` cannot answer this: deleting a connector sets it null too (`onDelete:
   * 'set null'`), so a null `connectorId` reads the same for a hand-typed row and for an
   * observation whose connector no longer exists. Same reasoning as `EvidenceHistoryOrigin`.
   */
  origin: text('origin').notNull().default('connector').$type<AssetSourceOrigin>(),
  sourceAssetId: text('source_asset_id').notNull(),
  reportedName: text('reported_name'),
  reportedCategoryId: text('reported_category_id').notNull().$type<AssetCategory>(),
  reportedSubcategoryId: text('reported_subcategory_id').$type<AssetSubcategory>(),
  reportedDescription: text('reported_description'),
  reportedExposure: text('reported_exposure').$type<SupportingAssetExposure>().notNull().default('unknown'),
  reportedCriticality: text('reported_criticality').$type<AssetCriticality>().notNull().default('unknown'),
  /** The rule that produced `reportedCriticality`; null when the source states no reason, or no reading. */
  reportedCriticalityRule: text('reported_criticality_rule').$type<AssetCriticalityRule>(),
  /** The id the customer's own system gave the asset (OpenAEV's `asset_external_reference`) — the only cross-family identifier a source may report. */
  externalReference: text('external_reference'),
  reportedUrl: text('reported_url'),
  reportedLinkedPerson: text('reported_linked_person'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('supporting_asset_sources_tenant_source_uq').on(table.tenantId, table.connectorId, table.sourceAssetId).nullsNotDistinct(),
  index('supporting_asset_sources_asset_idx').on(table.supportingAssetId),
  check('supporting_asset_sources_criticality_rule_ck', sql`${table.reportedCriticalityRule} IN (${literals(ASSET_CRITICALITY_RULE_VALUES)})`),
]);

defineSecurityPolicies(supportingAssetSources, tenantIsolationPolicy);

/**
 * What one connector observed about a `machine`-family asset: host, container workload, cloud
 * resource, mobile device, network device or IoT/OT device. One-to-one with its
 * `supportingAssetSources` row — `id` reuses that row's own id (see the migration) rather than a
 * freshly generated one, since the two are always written and read together.
 *
 * `tenantId` is denormalised from the parent row so this table can carry `tenantIsolationPolicy`
 * directly and keep its own tenant-scoped indexes, which is what the identity matcher queries.
 */
export const supportingAssetMachineProperties = pgTable('supporting_asset_machine_properties', {
  id: uuid('id').primaryKey(),
  // Explicit, short constraint names below: the default ones drizzle would generate share one
  // 63-character truncated prefix (table name + column name are both long) and collide in Postgres.
  supportingAssetSourceId: uuid('supporting_asset_source_id').notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  // Identity, normalised at ingestion time (see normalization.ts): lower-cased hostname,
  // separator-stripped lower-cased MACs, denylisted values dropped before they reach here.
  hostname: text('hostname'),
  ipAddresses: text('ip_addresses').array(),
  macAddresses: text('mac_addresses').array(),
  /** The single address the connector last observed the asset reachable on — OpenAEV's `asset_seen_ip`, distinct from the full `ipAddresses` set. */
  seenIp: text('seen_ip'),
  hardwareUuid: text('hardware_uuid'),
  directoryDeviceId: text('directory_device_id'),
  cloudVmId: text('cloud_vm_id'),
  cloudResourceId: text('cloud_resource_id'),
  /**
   * What hosts a cloud resource, as OpenAEV's own *Cloud* card reads it. Descriptive, unlike the
   * two cloud ids above: thousands of assets share one provider and one region, so no matcher tier
   * reads them. They sit here because `cloud_resource` is a `machine`-family category and the
   * identifiers they describe are already on this row.
   */
  cloudProvider: text('cloud_provider').$type<CloudProvider>(),
  cloudNativeType: text('cloud_native_type'),
  cloudRegion: text('cloud_region'),
  platform: text('platform'),
  arch: text('arch').$type<EndpointArch>(),
  /** Hardware maker and product, as the connector words them: descriptive, no matcher tier reads either. */
  vendor: text('vendor'),
  model: text('model'),
  /** The release as people name it ("Windows 11 25H2"), beside the family `platform` the matcher reads. */
  operatingSystem: text('operating_system'),
  osVersion: text('os_version'),
  isEol: boolean('is_eol'),
  agentExternalReference: text('agent_external_reference'),
  agentExecutorType: text('agent_executor_type'),
}, (table) => [
  unique('supporting_asset_machine_properties_source_unique').on(table.supportingAssetSourceId),
  foreignKey({ name: 'supporting_asset_machine_properties_source_fk', columns: [table.supportingAssetSourceId], foreignColumns: [supportingAssetSources.id] }).onDelete('cascade'),
  index('supporting_asset_machine_properties_tenant_hostname_idx').on(table.tenantId, table.hostname),
  index('supporting_asset_machine_properties_tenant_hw_uuid_idx').on(table.tenantId, table.hardwareUuid),
  index('supporting_asset_machine_properties_tenant_agent_ref_idx').on(table.tenantId, table.agentExternalReference),
]);

defineSecurityPolicies(supportingAssetMachineProperties, tenantIsolationPolicy);

/**
 * What one connector observed about an `ai_target`-family asset: an LLM model, AI
 * agent, MCP server or RAG pipeline. One-to-one with its `supportingAssetSources` row, on the same
 * id-reuse and denormalised-`tenantId` conventions as `supportingAssetMachineProperties`.
 */
export const supportingAssetAiTargetProperties = pgTable('supporting_asset_ai_target_properties', {
  id: uuid('id').primaryKey(),
  supportingAssetSourceId: uuid('supporting_asset_source_id').notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  provider: text('provider').$type<AiTargetProvider>(),
  endpointUrl: text('endpoint_url'),
  /** `normalizeEndpointUrl(endpointUrl)`, stored rather than computed at read time so the matcher's index is built directly from it. */
  normalizedEndpointUrl: text('normalized_endpoint_url'),
  model: text('model'),
  modality: text('modality').$type<AiTargetModality>(),
  systemPrompt: text('system_prompt'),
}, (table) => [
  unique('supporting_asset_ai_target_properties_source_unique').on(table.supportingAssetSourceId),
  foreignKey({ name: 'supporting_asset_ai_target_properties_source_fk', columns: [table.supportingAssetSourceId], foreignColumns: [supportingAssetSources.id] }).onDelete('cascade'),
  index('supporting_asset_ai_target_properties_tenant_endpoint_idx').on(table.tenantId, table.normalizedEndpointUrl),
]);

defineSecurityPolicies(supportingAssetAiTargetProperties, tenantIsolationPolicy);

/**
 * What one connector observed about an `identity`-family asset: a user account, a service account,
 * a service principal or a managed identity. One-to-one with its `supportingAssetSources` row, on
 * the same id-reuse and denormalised-`tenantId` conventions as `supportingAssetMachineProperties`.
 *
 * The three identifier columns are kept beside the parent's `sourceAssetId` rather than derived
 * from it: that key is the Entra object id for a directory record and a SID for an account first
 * seen in a logon event, so only these columns let the matcher join the two shapes onto one asset.
 *
 * `department` and `jobTitle` are descriptive. No rule reads them — an identity's criticality is
 * technical privilege, and business role is a question this model does not answer.
 */
export const supportingAssetIdentityProperties = pgTable('supporting_asset_identity_properties', {
  id: uuid('id').primaryKey(),
  supportingAssetSourceId: uuid('supporting_asset_source_id').notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** The Entra object id (`IdentityInfo.AccountObjectId`), absent on an account known only from logon events. */
  directoryObjectId: text('directory_object_id'),
  cloudSid: text('cloud_sid'),
  onPremSid: text('on_prem_sid'),
  userPrincipalName: text('user_principal_name'),
  accountDomain: text('account_domain'),
  accountName: text('account_name'),
  /** The vendor's own `IdentityInfo.Type`, kept verbatim: `subcategoryId` is the aligned vocabulary and this is the precision it rounds off. */
  directoryType: text('directory_type'),
  identityProvider: text('identity_provider').$type<AssetIdentityProvider>(),
  department: text('department'),
  jobTitle: text('job_title'),
  isEnabled: boolean('is_enabled'),
  assignedRoles: text('assigned_roles').array(),
  privilegedPimRoles: text('privileged_pim_roles').array(),
}, (table) => [
  unique('supporting_asset_identity_properties_source_unique').on(table.supportingAssetSourceId),
  foreignKey({ name: 'supporting_asset_identity_properties_source_fk', columns: [table.supportingAssetSourceId], foreignColumns: [supportingAssetSources.id] }).onDelete('cascade'),
  index('supporting_asset_identity_properties_tenant_object_idx').on(table.tenantId, table.directoryObjectId),
  index('supporting_asset_identity_properties_tenant_cloud_sid_idx').on(table.tenantId, table.cloudSid),
  index('supporting_asset_identity_properties_tenant_onprem_sid_idx').on(table.tenantId, table.onPremSid),
]);

defineSecurityPolicies(supportingAssetIdentityProperties, tenantIsolationPolicy);

/**
 * The canonical tag vocabulary, brought across rather than one row per asset: manual tagging and
 * filtering are the announced next step and both need a closed list to offer. Identity is the name
 * within the tenant: filtering on "production" must return everything tagged production
 * whatever reported it, which a per-reporter row could not do. What each reporter calls the tag,
 * and under what id, lives in `tagSources`.
 */
export const tags = pgTable('tags', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /**
   * The tag this one is merged into, nullable for a root. A merge only moves this pointer, so the
   * asset links and origins stay where they were and unmerging restores them exactly; readers
   * follow the pointer to the root. The cascade makes deleting a root delete what was merged into it.
   */
  mergedIntoTagId: uuid('merged_into_tag_id').references((): AnyPgColumn => tags.id, { onDelete: 'cascade' }),
  mergedAt: timestamp('merged_at', { withTimezone: true }),
}, (table) => [
  unique(TAG_NAME_UNIQUE).on(table.tenantId, table.name),
  // Redundant with the primary key, and what a composite foreign key naming the tenant can point at.
  unique('tags_id_tenant_id_uq').on(table.id, table.tenantId),
  index('tags_merged_into_idx').on(table.mergedIntoTagId),
  check('tags_merged_pair_ck', sql`(${table.mergedIntoTagId} IS NULL) = (${table.mergedAt} IS NULL)`),
]);

defineSecurityPolicies(tags, tenantIsolationPolicy);

/**
 * One row per origin of a canonical tag: a connector's own vocabulary entry, or a person's manual
 * tag (`connectorId` null). `sourceTagId` is the id that origin gives the tag — null for a manual
 * origin, which has none — and is what a resync matches on so a rename is resolved by splitting or
 * merging instead of creating a duplicate. `reportedColor` is the hex the origin reports, and is
 * what a chip paints: the newest origin reporting one wins, so a tag reads the same in both
 * products. It lives here rather than on the canonical row because two origins can disagree on it.
 */
export const tagSources = pgTable('tag_sources', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  connectorId: uuid('connector_id').references(() => integrationSettings.id, { onDelete: 'set null' }),
  sourceTagId: text('source_tag_id'),
  reportedName: text('reported_name').notNull(),
  reportedColor: text('reported_color'),
  /**
   * True for the origin an XTM One push gave the tag (#3152, section 2): like a manual origin it has
   * no connector and no source-given id, and this flag is what tells the two apart, so a tag pushed
   * by XTM One reads as XTM One's and not as a person's.
   */
  pushedByXtmOne: boolean('pushed_by_xtm_one').notNull().default(false),
}, (table) => [
  // The id an origin gives a tag designates at most one canonical tag (invariant): a
  // second row for the same (connector, source tag id) would make the id-based lookup ambiguous.
  // A manual origin's null connectorId/sourceTagId never collides here — Postgres never considers
  // two NULLs equal in a unique index.
  unique('tag_sources_tenant_connector_source_uq').on(table.tenantId, table.connectorId, table.sourceTagId),
  // At most one manual origin and one XTM One origin per tag (invariant): both are identified by
  // having no source-given id, which survives its connector being deleted (connectorId is set null
  // then, but sourceTagId is untouched) — so a former connector origin never masquerades as manual here.
  uniqueIndex('tag_sources_manual_per_tag_uq').on(table.tagId, table.pushedByXtmOne).where(sql`${table.sourceTagId} IS NULL`),
  index('tag_sources_tag_idx').on(table.tagId),
]);

defineSecurityPolicies(tagSources, tenantIsolationPolicy);

/**
 * One row per **author** asserting a tag on an asset — not one per (asset, tag): two connectors
 * (or a connector and a person) can each assert the same tag on the same asset, and each keeps its
 * own row, or the second sync would overwrite the first's authorship on every run and a split could
 * not tell which asserter's link belongs on which resulting tag. `connectorId` is who
 * asserted it — null for a manual link — so a resync can replace only the links its own connector
 * made. A reader rendering an asset's tags dedupes on `tagId`: several authors of the same tag must
 * still show as one.
 */
export const supportingAssetTags = pgTable('supporting_asset_tags', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  supportingAssetId: uuid('supporting_asset_id').notNull(),
  tagId: uuid('tag_id').notNull(),
  connectorId: uuid('connector_id').references(() => integrationSettings.id, { onDelete: 'set null' }),
  /**
   * True for a link an XTM One push asserted (#3152, section 2): it has no connector either, and a
   * person's edit and an XTM One push each replace only their own links, never the other's.
   */
  pushedByXtmOne: boolean('pushed_by_xtm_one').notNull().default(false),
}, (table) => [
  // Nulls distinct (not `nullsNotDistinct`): connector deletion sets `connectorId` null here, and a
  // pre-existing manual link on the same (asset, tag) must not make that deletion fail on a unique
  // violation. The orphaned row and the manual one coexist until the next `setAssetTagsBatch` with no
  // connector sweeps both together.
  unique('supporting_asset_tags_asset_tag_connector_uq').on(table.supportingAssetId, table.tagId, table.connectorId, table.pushedByXtmOne),
  index('supporting_asset_tags_asset_idx').on(table.supportingAssetId),
  // The tag counts read a tag's assets across the tenant, in order, from this index alone.
  index('supporting_asset_tags_tenant_tag_idx').on(table.tenantId, table.tagId, table.supportingAssetId),
  foreignKey({
    name: 'supporting_asset_tags_asset_tenant_fk',
    columns: [table.supportingAssetId, table.tenantId],
    foreignColumns: [supportingAssets.id, supportingAssets.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'supporting_asset_tags_tag_tenant_fk',
    columns: [table.tagId, table.tenantId],
    foreignColumns: [tags.id, tags.tenantId],
  }).onDelete('cascade'),
]);

defineSecurityPolicies(supportingAssetTags, tenantIsolationPolicy);

/** Who asserted an asset's membership of a group: a person, a connector's sync, or an XTM One push. */
export const ASSET_GROUP_MEMBER_SOURCE_VALUES = ['manual', 'connector', 'xtm_one'] as const;
export type AssetGroupMemberSource = typeof ASSET_GROUP_MEMBER_SOURCE_VALUES[number];

/**
 * A named set of supporting assets (#3152, section 2): OpenAEV's asset groups, and the groups an XTM
 * One push names. `connectorId` and `sourceGroupId` say which connector reported the group and under
 * what id, so a resync updates the same row instead of creating a duplicate; both are null for a group
 * a person or XTM One created, which is matched by `name` or `externalReference` instead.
 */
export const assetGroups = pgTable('asset_groups', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  /** The id the customer's own system gave the group, what an XTM One push matches on before the name. */
  externalReference: text('external_reference'),
  connectorId: uuid('connector_id').references(() => integrationSettings.id, { onDelete: 'set null' }),
  sourceGroupId: text('source_group_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Redundant with the primary key, and what a composite foreign key naming the tenant can point at.
  unique('asset_groups_id_tenant_id_uq').on(table.id, table.tenantId),
  // The id a connector gives a group designates at most one group; nulls stay distinct for the groups no connector reported.
  unique('asset_groups_tenant_connector_source_uq').on(table.tenantId, table.connectorId, table.sourceGroupId),
  index('asset_groups_tenant_name_idx').on(table.tenantId, table.name),
]);

defineSecurityPolicies(assetGroups, tenantIsolationPolicy);

/**
 * One row per author asserting an asset's static membership of a group, as `supportingAssetTags` keeps
 * one per author of a tag: a connector resync replaces only the rows of its own connector, so it never
 * removes a member a person or XTM One added. A dynamic OpenAEV group is stored with the members its
 * filter resolved at sync time, authored by that connector. A reader listing a group's members dedupes
 * on the asset.
 */
export const assetGroupMembers = pgTable('asset_group_members', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  assetGroupId: uuid('asset_group_id').notNull(),
  supportingAssetId: uuid('supporting_asset_id').notNull(),
  source: text('source').notNull().$type<AssetGroupMemberSource>(),
  /** The connector that asserted it, set exactly when `source` is `connector`; its rows go with it. */
  connectorId: uuid('connector_id').references(() => integrationSettings.id, { onDelete: 'cascade' }),
  /** The person who added it by hand, or on whose behalf XTM One pushed it; null for a connector. */
  authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // One row per (group, asset, author): a manual or XTM One row has no connector, hence nulls not distinct.
  unique('asset_group_members_group_asset_author_uq').on(table.assetGroupId, table.supportingAssetId, table.source, table.connectorId).nullsNotDistinct(),
  index('asset_group_members_asset_idx').on(table.supportingAssetId),
  index('asset_group_members_tenant_group_idx').on(table.tenantId, table.assetGroupId, table.supportingAssetId),
  check('asset_group_members_source_ck', sql`${table.source} IN ('manual', 'connector', 'xtm_one')`),
  check('asset_group_members_connector_ck', sql`(${table.source} = 'connector') = (${table.connectorId} IS NOT NULL)`),
  foreignKey({
    name: 'asset_group_members_group_tenant_fk',
    columns: [table.assetGroupId, table.tenantId],
    foreignColumns: [assetGroups.id, assetGroups.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'asset_group_members_asset_tenant_fk',
    columns: [table.supportingAssetId, table.tenantId],
    foreignColumns: [supportingAssets.id, supportingAssets.tenantId],
  }).onDelete('cascade'),
]);

defineSecurityPolicies(assetGroupMembers, tenantIsolationPolicy);

/**
 * A value a person set on a consolidated asset, outranking every resolution rule until the
 * asset is resynced with its connectors. One row per attribute the user has touched.
 */
export const supportingAssetManualValues = pgTable('supporting_asset_manual_values', {
  supportingAssetId: uuid('supporting_asset_id').notNull().references(() => supportingAssets.id, { onDelete: 'cascade' }),
  attribute: text('attribute').notNull().$type<AssetManualAttribute>(),
  /** The value the person set, stored here so resolution stays a pure function of its inputs. */
  value: text('value').notNull(),
  setByUserId: uuid('set_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  setAt: timestamp('set_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.supportingAssetId, table.attribute] }),
]);

defineSecurityPolicies(supportingAssetManualValues, supportingAssetTenantIsolationPolicy);

/**
 * A link a connector observed between two assets, one row per (connector, from, to, kind). Both
 * ends are foreign keys on `(id, tenant_id)`, so a relation can never join two tenants' assets.
 * The connector owns its relations and reconciles them, which is why they go with it.
 */
export const supportingAssetRelations = pgTable('supporting_asset_relations', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  connectorId: uuid('connector_id').notNull().references(() => integrationSettings.id, { onDelete: 'cascade' }),
  fromAssetId: uuid('from_asset_id').notNull(),
  toAssetId: uuid('to_asset_id').notNull(),
  kind: text('kind').notNull().$type<AssetRelationKind>(),
  source: text('source').notNull().$type<AssetRelationSource>(),
  /** What showed the relation at its last report, when the source names one: the OpenAEV simulation of an attack-path hop. */
  evidenceRef: text('evidence_ref'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
  lastReportedAt: timestamp('last_reported_at', { withTimezone: true }).notNull(),
}, (table) => [
  unique('supporting_asset_relations_uq').on(table.tenantId, table.connectorId, table.fromAssetId, table.toAssetId, table.kind),
  foreignKey({
    name: 'supporting_asset_relations_from_fk',
    columns: [table.fromAssetId, table.tenantId],
    foreignColumns: [supportingAssets.id, supportingAssets.tenantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'supporting_asset_relations_to_fk',
    columns: [table.toAssetId, table.tenantId],
    foreignColumns: [supportingAssets.id, supportingAssets.tenantId],
  }).onDelete('cascade'),
  check('supporting_asset_relations_kind_ck', sql`${table.kind} IN (${literals(ASSET_RELATION_KIND_VALUES)})`),
  check('supporting_asset_relations_source_ck', sql`${table.source} IN (${literals(ASSET_RELATION_SOURCE_VALUES)})`),
  index('supporting_asset_relations_from_idx').on(table.tenantId, table.fromAssetId),
  index('supporting_asset_relations_to_idx').on(table.tenantId, table.toAssetId),
]);

defineSecurityPolicies(supportingAssetRelations, tenantIsolationPolicy);

/**
 * The band a device takes from the identity it is assigned to, one below that identity's, written by
 * the criticality lift job alone and folded by every reprojection beside the connectors' readings.
 * The identity is not cascaded: a lift that vanished with it would leave the device's band lifted,
 * since nothing would reproject it, where a lift left behind is one the job sees and removes.
 */
export const supportingAssetCriticalityLifts = pgTable('supporting_asset_criticality_lifts', {
  supportingAssetId: uuid('supporting_asset_id').notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  criticality: text('criticality').$type<AssetCriticality>().notNull(),
  fromAssetId: uuid('from_asset_id'),
}, (table) => [
  // `tenantId` leads, so the job's upsert can name the key as a certified `onConflictDoOverwrite` target.
  primaryKey({ name: 'supporting_asset_criticality_lifts_pk', columns: [table.tenantId, table.supportingAssetId] }),
  // The key leads with `tenantId`: a cascade from either asset is checked on its column alone.
  index('supporting_asset_criticality_lifts_asset_idx').on(table.supportingAssetId),
  index('supporting_asset_criticality_lifts_from_idx').on(table.fromAssetId),
  foreignKey({
    name: 'supporting_asset_criticality_lifts_asset_fk',
    columns: [table.supportingAssetId, table.tenantId],
    foreignColumns: [supportingAssets.id, supportingAssets.tenantId],
  }).onDelete('cascade'),
  // On `id` alone, unlike the device's key: a composite `set null` would null `tenant_id` with it,
  // and Drizzle cannot name the one column `ON DELETE SET NULL (from_asset_id)` clears. Only the
  // job writes a lift, from relations whose two ends already share the tenant.
  foreignKey({
    name: 'supporting_asset_criticality_lifts_from_fk',
    columns: [table.fromAssetId],
    foreignColumns: [supportingAssets.id],
  }).onDelete('set null'),
]);

defineSecurityPolicies(supportingAssetCriticalityLifts, tenantIsolationPolicy);

export const assetEvidence = pgTable('asset_evidence', {
  id: uuid('id').primaryKey(),
  supportingAssetId: uuid('supporting_asset_id').notNull().references(() => supportingAssets.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  // Exactly one of cveId or mitreTechniqueId must be non-null (enforced by check constraint below)
  cveId: uuid('cve_id'),
  mitreTechniqueId: uuid('mitre_technique_id').references(() => mitreTechniques.id, { onDelete: 'cascade' }),
  // null when cveId is set; 'detection' or 'prevention' when mitreTechniqueId is set
  expectationType: text('expectation_type').$type<ExpectationType>(),
  securityPlatformType: text('security_platform_type'),
  evaluatedAt: timestamp('evaluated_at', { withTimezone: true }),
  sourceScenarioId: text('source_scenario_id'),
  sourceScenarioName: text('source_scenario_name'),
  sourceSimulationId: text('source_simulation_id'),
  sourceInjectId: text('source_inject_id'),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  /**
   * The OpenCRQ markings the finding carries, by STIX id (CTEM marking parity, G2): a person reads it
   * only when they are cleared for all of them and can read its supporting asset. Unmarked by default.
   */
  markingRefs: text('marking_refs').array().notNull().default(sql`'{}'::text[]`),
  /**
   * The finding's latest history row, re-derived from its whole history (`asset_evidence_derived_state`)
   * by `asset_evidence_history_refresh_state` after every insert into or delete from
   * `asset_evidence_history`: the state it is in, the date of that row, and when the state was entered
   * (a date `historyRowEnteredAt` computes with the same function, for one history list). A change of
   * cause alone moves the date, never the entry. A finding with no history reads the defaults.
   */
  currentState: text('current_state').notNull().default(DEFAULT_EVIDENCE_STATE).$type<EvidenceState>(),
  currentStateChangedAt: timestamp('current_state_changed_at', { withTimezone: true }).notNull().defaultNow(),
  currentStateSince: timestamp('current_state_since', { withTimezone: true }).notNull().defaultNow(),
  /**
   * The finding's latest test verdict (latest `recorded_at`, then `observed_at`, then `id` of
   * `asset_evidence_verdicts`), re-read by `asset_evidence_verdicts_refresh_latest` after every insert
   * into that table. Both are null while no test has spoken about the finding, which is what tells a
   * state a person set apart from a measurement.
   */
  latestVerdictExposed: boolean('latest_verdict_exposed'),
  latestVerdictObservedAt: timestamp('latest_verdict_observed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check(
    'asset_evidence_fk_exclusive_chk',
    sql`(${table.cveId} IS NOT NULL AND ${table.mitreTechniqueId} IS NULL AND ${table.expectationType} IS NULL) OR (${table.cveId} IS NULL AND ${table.mitreTechniqueId} IS NOT NULL AND ${table.expectationType} IS NOT NULL)`,
  ),
  // connectorId left the identity: the same CVE or technique on the same asset is one finding
  // whatever number of connectors report it (CAP-3). Per-connector provenance now lives on
  // assetEvidenceSources.
  unique(ASSET_EVIDENCE_UNIQUE).on(
    table.supportingAssetId,
    table.cveId,
    table.mitreTechniqueId,
    table.expectationType,
    table.securityPlatformType,
    table.sourceScenarioId,
  ).nullsNotDistinct(),
  // The CVE and technique pages read the findings of one flaw. A CVE row belongs to one tenant; a
  // technique is shared by every tenant, hence the tenant beside it. They prefix the state indexes
  // below and stay: a count of one flaw's findings reads them, and is dearer on the wider ones.
  index('asset_evidence_cve_idx').on(table.cveId).where(sql`${table.cveId} IS NOT NULL`),
  index('asset_evidence_technique_tenant_idx').on(table.mitreTechniqueId, table.tenantId).where(sql`${table.mitreTechniqueId} IS NOT NULL`),
  // A unique finding's members are looked up by its technique and expectation type, which the unique key above leads with the asset.
  index('asset_evidence_technique_expectation_idx').on(table.mitreTechniqueId, table.expectationType),
  // The affected-assets pages cut a page of one flaw's findings in the order of its state or of its
  // last change. The id closes each key, so a backward scan serves the descending order too.
  index('asset_evidence_cve_state_idx').on(table.cveId, table.currentState, table.id).where(sql`${table.cveId} IS NOT NULL`),
  index('asset_evidence_cve_changed_idx').on(table.cveId, table.currentStateChangedAt, table.id).where(sql`${table.cveId} IS NOT NULL`),
  index('asset_evidence_technique_state_idx').on(table.mitreTechniqueId, table.tenantId, table.currentState, table.id).where(sql`${table.mitreTechniqueId} IS NOT NULL`),
  index('asset_evidence_technique_changed_idx').on(table.mitreTechniqueId, table.tenantId, table.currentStateChangedAt, table.id).where(sql`${table.mitreTechniqueId} IS NOT NULL`),
  // Redundant with the primary key, and what a composite foreign key naming the tenant can point at.
  unique('asset_evidence_id_tenant_id_uq').on(table.id, table.tenantId),
  foreignKey({
    name: 'asset_evidence_cve_tenant_fk',
    columns: [table.cveId, table.tenantId],
    foreignColumns: [cve.id, cve.tenantId],
  }).onDelete('cascade'),
]);

// A finding carries its own markings and follows its asset's (CTEM marking parity, G2 slice 3c).
defineSecurityPolicies(assetEvidence, tenantIsolationPolicy, nativeMarkingPolicy, supportingAssetMarkingPolicy);

/**
 * One row per connector reporting a finding on a canonical `asset_evidence` row: its own first
 * seen, last seen and reported severity, per CAP-4/CAP-5. A hand-attached finding has no row here.
 */
export const assetEvidenceSources = pgTable('asset_evidence_sources', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  assetEvidenceId: uuid('asset_evidence_id').notNull(),
  connectorId: uuid('connector_id').references(() => integrationSettings.id, { onDelete: 'set null' }),
  /**
   * Stable across replays, unlike the ids OpenAEV hands out: a scenario rerun builds new injects,
   * so its `finding_id` and `inject_expectation_id` change every time and would insert a new row
   * here instead of refreshing this one.
   */
  sourceFindingId: text('source_finding_id'),
  /**
   * Which repeated probe made this assertion, matching `assetEnumerations.scope`: the scenario for
   * OpenAEV, empty for a connector whose sync walks an asset whole.
   */
  scope: text('scope').notNull().default(''),
  /**
   * What this connector last asserted, which the canonical state aggregates: a source that says
   * the finding is gone must not be confused with one that stopped talking about it, and only the
   * first is an assertion the connector stands behind.
   */
  isExposed: boolean('is_exposed').notNull().default(true),
  /** The connector's own wording of that verdict, which the history row it causes carries. */
  reason: text('reason'),
  /** The connector's own id for this finding, kept out of the key precisely because it is volatile: only a deep link back reads it. */
  externalReference: text('external_reference'),
  reportedSeverity: text('reported_severity'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  /** The sync clock, unlike `lastSeenAt` which carries the connector's own observation time. */
  lastReportedAt: timestamp('last_reported_at', { withTimezone: true }).notNull().defaultNow(),
  evaluatedAt: timestamp('evaluated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('asset_evidence_sources_uq').on(table.assetEvidenceId, table.connectorId, table.sourceFindingId).nullsNotDistinct(),
  // Redundant with the primary key, and what a composite foreign key naming the tenant can point at.
  unique('asset_evidence_sources_id_tenant_id_uq').on(table.id, table.tenantId),
  // The tenant-wide reads count and join a tenant's findings from this index alone.
  index('asset_evidence_sources_tenant_evidence_idx').on(table.tenantId, table.assetEvidenceId),
  foreignKey({
    name: 'asset_evidence_sources_evidence_tenant_fk',
    columns: [table.assetEvidenceId, table.tenantId],
    foreignColumns: [assetEvidence.id, assetEvidence.tenantId],
  }).onDelete('cascade'),
]);

defineSecurityPolicies(assetEvidenceSources, tenantIsolationPolicy);

/** One row per product version a source names as carrying its finding. A source naming no software has none. */
export const assetEvidenceSourceSoftware = pgTable('asset_evidence_source_software', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  assetEvidenceSourceId: uuid('asset_evidence_source_id').notNull(),
  vendor: text('vendor'),
  name: text('name').notNull(),
  version: text('version').notNull(),
}, (table) => [
  foreignKey({
    name: 'asset_evidence_source_software_source_fk',
    columns: [table.assetEvidenceSourceId, table.tenantId],
    foreignColumns: [assetEvidenceSources.id, assetEvidenceSources.tenantId],
  }).onDelete('cascade'),
  unique('asset_evidence_source_software_uq')
    .on(table.assetEvidenceSourceId, table.vendor, table.name, table.version)
    .nullsNotDistinct(),
]);

defineSecurityPolicies(assetEvidenceSourceSoftware, tenantIsolationPolicy);

/**
 * When a connector last walked one asset's findings whole, which is what turns its silence about a
 * finding into evidence that the finding is gone. A run does not always walk the whole estate —
 * OpenAEV mostly reads the observations changed since its cursor — so this is recorded per asset
 * and never per connector. The scope splits it further where a run only probes part of an asset:
 * an OpenAEV scenario says nothing about what another scenario found, so it enumerates under its
 * own scenario id.
 */
export const assetEnumerations = pgTable('asset_enumerations', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  connectorId: uuid('connector_id').notNull().references(() => integrationSettings.id, { onDelete: 'cascade' }),
  supportingAssetId: uuid('supporting_asset_id').notNull().references(() => supportingAssets.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull().default(''),
  lastReportedAt: timestamp('last_reported_at', { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.connectorId, table.supportingAssetId, table.scope] }),
  // The primary key leads with the connector, so it cannot serve the cascade from a deleted asset.
  index('asset_enumerations_supporting_asset_idx').on(table.supportingAssetId),
]);

defineSecurityPolicies(assetEnumerations, tenantIsolationPolicy);

/**
 * A finding's state, one row per change of its state or cause. A row is dated when the change was
 * learned, never back-dated: a history once shown is never rewritten.
 */
export const assetEvidenceHistory = pgTable('asset_evidence_history', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  assetEvidenceId: uuid('asset_evidence_id').notNull(),
  stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull(),
  /**
   * When the test behind a sync row was made, which a late result puts before `stateChangedAt`.
   * Null on a person's row and a handover, which no test caused.
   */
  observedAt: timestamp('observed_at', { withTimezone: true }),
  state: text('state').notNull().$type<EvidenceState>(),
  /** The free-text rationale, mandatory when a person sets a finding aside and never a code. */
  reason: text('reason'),
  /** Set only on a dismissed row a person wrote; a connector verdict carries neither half. */
  dismissalType: text('dismissal_type').$type<DismissalType>(),
  dismissalReasonCode: text('dismissal_reason_code').$type<DismissalReasonCode>(),
  changedByUserId: uuid('changed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  origin: text('origin').notNull().$type<EvidenceHistoryOrigin>(),
}, (table) => [
  foreignKey({
    name: EVIDENCE_HISTORY_TENANT_FK,
    columns: [table.assetEvidenceId, table.tenantId],
    foreignColumns: [assetEvidence.id, assetEvidence.tenantId],
  }).onDelete('cascade'),
  // Leads with the tenant the views filter on, and holds every column the tenant-wide reads take, so
  // they read the index alone rather than a finding's rows scattered across the heap.
  index('asset_evidence_history_tenant_evidence_idx')
    .on(table.tenantId, table.assetEvidenceId, table.stateChangedAt.desc().nullsFirst(), table.id.desc().nullsFirst(), table.state, table.origin, table.observedAt),
]);

defineSecurityPolicies(assetEvidenceHistory, tenantIsolationPolicy);

/**
 * The test results behind a finding, one row each time one of its sources changed verdict: what
 * control validation, the test tallies and the proven posture measure, apart from the state the
 * history derives from the sources. A late result older than its source's current verdict is not
 * a change and is not logged.
 */
export const assetEvidenceVerdicts = pgTable('asset_evidence_verdicts', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  assetEvidenceId: uuid('asset_evidence_id').notNull(),
  /** Null on a verdict logged before sources were told apart, and once the connector is deleted. */
  connectorId: uuid('connector_id').references(() => integrationSettings.id, { onDelete: 'set null' }),
  sourceFindingId: text('source_finding_id'),
  isExposed: boolean('is_exposed').notNull(),
  /** When the test was made. */
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  /** When the sync delivered it: what a reading of the past at a given instant filters on. */
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
}, (table) => [
  foreignKey({
    name: 'asset_evidence_verdicts_evidence_tenant_fk',
    columns: [table.assetEvidenceId, table.tenantId],
    foreignColumns: [assetEvidence.id, assetEvidence.tenantId],
  }).onDelete('cascade'),
  index('asset_evidence_verdicts_evidence_recorded_idx')
    .on(table.assetEvidenceId, table.recordedAt.desc().nullsFirst()),
]);

defineSecurityPolicies(assetEvidenceVerdicts, tenantIsolationPolicy);
