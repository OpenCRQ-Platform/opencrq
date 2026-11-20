import { boolean, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, tenantIsolationPolicy } from '../../security';
import { integrationSettings } from '../integration-settings/schema';
import { tenants } from '../tenants';

export const OPENAEV_STREAMS = ['attack', 'vulnerability'] as const;
export type OpenaevStream = (typeof OPENAEV_STREAMS)[number];

// One row per (connector, OpenAEV tenant, snapshot stream): where the differential read resumes and
// where the weekly full walk stands. The three walk timestamps are the full walk's only memory, so it
// survives a crashed or aborted run.
export const openaevSyncStreams = pgTable('openaev_sync_streams', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  connectorId: uuid('connector_id').notNull().references(() => integrationSettings.id, { onDelete: 'cascade' }),
  openaevTenantId: text('openaev_tenant_id').notNull(),
  stream: text('stream').notNull().$type<OpenaevStream>(),
  cursor: text('cursor'),
  // Non-null for as long as a full walk is in progress.
  fullWalkStartedAt: timestamp('full_walk_started_at', { withTimezone: true, mode: 'date' }),
  lastFullWalkCompletedAt: timestamp('last_full_walk_completed_at', { withTimezone: true, mode: 'date' }),
  lastFullWalkAttemptedAt: timestamp('last_full_walk_attempted_at', { withTimezone: true, mode: 'date' }),
  // Start of the oldest run whose reads of this stream have not been reconciled into evidence yet;
  // null once everything read has been.
  unreconciledSince: timestamp('unreconciled_since', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('openaev_sync_streams_connector_tenant_stream_idx').on(table.connectorId, table.openaevTenantId, table.stream),
]);

defineSecurityPolicies(openaevSyncStreams, tenantIsolationPolicy);

// Minimal local copy of the attack observations OpenAEV serves, one row per document: just enough to
// tell which documents are still current for an (asset, scenario) once the differential stream
// carries no deletion. `evidenceWrittenAt` and `evidencePlatformTypes` say when, and with which
// security platform types, the document's evidence was last written; the upsert of a document
// leaves both alone, so a replay in progress keeps the types of the last `FINISHED` verdict.
export const openaevAttackObservations = pgTable('openaev_attack_observations', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  connectorId: uuid('connector_id').notNull().references(() => integrationSettings.id, { onDelete: 'cascade' }),
  openaevTenantId: text('openaev_tenant_id').notNull(),
  observationId: text('observation_id').notNull(),
  sourceAssetId: text('source_asset_id').notNull(),
  scenarioId: text('scenario_id').notNull(),
  attackPatternExternalId: text('attack_pattern_external_id').notNull(),
  expectationType: text('expectation_type').notNull(),
  simulationStartDate: timestamp('simulation_start_date', { withTimezone: true, mode: 'date' }),
  simulationStatus: text('simulation_status').notNull(),
  lastReportedAt: timestamp('last_reported_at', { withTimezone: true, mode: 'date' }).notNull(),
  evidenceWrittenAt: timestamp('evidence_written_at', { withTimezone: true, mode: 'date' }),
  evidencePlatformTypes: text('evidence_platform_types').array(),
}, (table) => [
  primaryKey({ name: 'openaev_attack_observations_pk', columns: [table.connectorId, table.observationId] }),
  index('openaev_attack_observations_asset_scenario_idx').on(table.connectorId, table.sourceAssetId, table.scenarioId),
  index('openaev_attack_observations_tenant_reported_idx').on(table.connectorId, table.openaevTenantId, table.lastReportedAt),
]);

defineSecurityPolicies(openaevAttackObservations, tenantIsolationPolicy);

// The OpenAEV assets the connector has seen, keyed by the id OpenAEV gives them: drives the budget
// of description fetches and tells which OpenAEV tenant an asset belongs to.
export const openaevAssets = pgTable('openaev_assets', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  connectorId: uuid('connector_id').notNull().references(() => integrationSettings.id, { onDelete: 'cascade' }),
  sourceAssetId: text('source_asset_id').notNull(),
  openaevTenantId: text('openaev_tenant_id').notNull(),
  // The asset's description is only served by `GET /assets/{id}` (the `overview` enrichment route).
  needsDescriptionFetch: boolean('needs_description_fetch').notNull(),
  descriptionFetchedAt: timestamp('description_fetched_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  primaryKey({ name: 'openaev_assets_pk', columns: [table.connectorId, table.sourceAssetId] }),
]);

defineSecurityPolicies(openaevAssets, tenantIsolationPolicy);
