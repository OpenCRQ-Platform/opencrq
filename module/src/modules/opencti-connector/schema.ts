import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { OpenctiThreatVisibility } from './threat-visibility';
import { defineSecurityPolicies, reportRefMarkingPolicy, streamObjectMarkingPolicy, tenantIsolationPolicy } from '../../security';
import { serviceAccounts } from '../service-accounts/schema';
import { tenants } from '../tenants';
import { OPENCTI_THREAT_VISIBILITIES } from './threat-visibility';

const THREAT_VISIBILITY_LITERALS = sql.raw(OPENCTI_THREAT_VISIBILITIES.map((visibility) => `'${visibility}'`).join(', '));

// Per-tenant OpenCTI Live Stream connector config. Credentials (`connectors.opencti.{url,token}`)
// are deployment-wide (`config-schema.ts`). `serviceAccountId` lives here (not `integration_settings`)
// since the background connector manager writes with an explicit `tenantId`, not an `eventOrigin`.
// Configuration and health, never a checkpoint: the tenant middleware reads `threatVisibility` on
// every call, so a column a checkpoint rewrites must not join it. The stream's position is
// `openctiStreamState`.
export const openctiConnectorSettings = pgTable('opencti_connector_settings', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  serviceAccountId: uuid('service_account_id').references(() => serviceAccounts.id, { onDelete: 'set null' }),
  streamId: text('stream_id'),
  enabled: boolean('enabled').notNull().default(false),
  threatVisibility: text('threat_visibility').notNull().default('per_member').$type<OpenctiThreatVisibility>(),
  // Set on a 401/403 from OpenCTI (forces `enabled=false` too); cleared on reconfigure or `setEnabled`.
  authFailedAt: timestamp('auth_failed_at', { withTimezone: true, mode: 'date' }),
  // The OpenCTI capability the deployment's token lacks to create the Live Stream OpenCRQ manages, set
  // at boot for a tenant with nothing bound; cleared once a stream is bound, by the boot or by Configure.
  streamMissingCapability: text('stream_missing_capability'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('opencti_connector_settings_tenantid_idx').on(table.tenantId),
  check('opencti_connector_settings_threat_visibility_ck', sql`${table.threatVisibility} IN (${THREAT_VISIBILITY_LITERALS})`),
]);

defineSecurityPolicies(openctiConnectorSettings, tenantIsolationPolicy);

// Where the tenant's Live Stream consumer stands, one row per tenant bound to a stream, created by
// the binding. Every checkpoint rewrites it.
export const openctiStreamState = pgTable('opencti_stream_state', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  // Last SSE event id, used to resume via `from`/`Last-Event-ID` on reconnect.
  cursor: text('cursor'),
  // Highest event date seen so far (monotonic high-water mark, not processing time) — event ids
  // aren't strictly ordered, so this only ever moves forward. See `opencti-connector-manager.ts`.
  lastEventAt: timestamp('last_event_at', { withTimezone: true, mode: 'date' }),
  // One-way latch: first cursor persisted after a (re)configure — the timeline's start anchor.
  historyStartAt: timestamp('history_start_at', { withTimezone: true, mode: 'date' }),
  // One-way latch, set alongside `historyStartAt` — the backfill's target point in time, making
  // `(lastEventAt - historyStartAt) / (backfillTargetAt - historyStartAt)` a monotonic percentage.
  backfillTargetAt: timestamp('backfill_target_at', { withTimezone: true, mode: 'date' }),
  // One-way latch: set once an event's date is close enough to "now" that we're caught up.
  reachedLiveTailAt: timestamp('reached_live_tail_at', { withTimezone: true, mode: 'date' }),
  // Bumped by every act that throws the resume position away: a reconfigure, a reconnect, a reset. A
  // consumer carries the generation it started on and writes only while it still matches.
  streamGeneration: integer('stream_generation').notNull().default(0),
  // Objects taken off the stream, kept or dropped alike. Folded into the cursor write, so the ingestion
  // path gains no statement of its own.
  objectsRead: bigint('objects_read', { mode: 'number' }).notNull().default(0),
  // When `objectsRead` last moved, which is the rate's denominator: a configuration write does not
  // read anything and must not register as progress.
  objectsReadAt: timestamp('objects_read_at', { withTimezone: true, mode: 'date' }),
});

defineSecurityPolicies(openctiStreamState, tenantIsolationPolicy);

// Per-tenant resolve cache of STIX objects/relationships seen on the Live Stream — looked up by id,
// by source/target ref, or by producer, never bulk-reloaded. `sourceRef`/`targetRef`/`relationshipType`
// are denormalized out of `data` (relationship rows only) purely to index them; `createdByRef` is
// denormalized the same way but read on any STIX type, since `created_by_ref` is not relationship-
// specific.
//
// A STIX `delete`, and an object an upstream merge absorbed, leave a tombstone (`deletedAt` set)
// rather than removing the row: the rebuild job needs to see that the object is gone before it can
// retract what it contributed, and it purges the tombstone once it has. Every read of the mirror
// therefore filters `deletedAt is null`.
export const openctiStreamObjects = pgTable('opencti_stream_objects', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  stixId: text('stix_id').notNull(),
  stixType: text('stix_type').notNull(),
  sourceRef: text('source_ref'),
  targetRef: text('target_ref'),
  relationshipType: text('relationship_type'),
  createdByRef: text('created_by_ref'),
  // eslint-disable-next-line no-restricted-syntax -- opaque third-party STIX 2.1 object, shape defined externally by OpenCTI/STIX spec, never filtered/joined on
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  // Set by every write of the connector, cleared by the rebuild job against the `updatedAt` it read.
  // A mark per row rather than a cursor: a writer's timestamp is fixed before its commit, so two
  // writers can make a row become visible below a watermark already advanced past it, and the job
  // needs completeness, not order.
  pending: boolean('pending').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('opencti_stream_objects_tenantid_stixid_idx').on(table.tenantId, table.stixId),
  index('opencti_stream_objects_source_ref_idx').on(table.tenantId, table.sourceRef, table.relationshipType),
  index('opencti_stream_objects_target_ref_idx').on(table.tenantId, table.targetRef, table.relationshipType),
  index('opencti_stream_objects_created_by_ref_idx').on(table.tenantId, table.createdByRef),
  // Partial, and ordered as the rebuild's scan reads it, so the walk is the backlog rather than
  // the table plus a sort.
  index('opencti_stream_objects_pending_idx')
    .on(table.tenantId, table.updatedAt, table.stixId)
    .where(sql`${table.pending}`),
]);

// A person's own read sees only the objects whose markings OpenCTI lets them read (opencrq #31).
defineSecurityPolicies(openctiStreamObjects, tenantIsolationPolicy, streamObjectMarkingPolicy);

// Which threats (by STIX id) each mirrored `report` object refers to, read from its `object_refs`, so
// a report's threats are found by an indexed lookup rather than by scanning every report's `data`.
// Written by the background connector manager with an explicit `tenantId`, in the same transaction
// as the report's mirror row.
export const openctiStreamReportRefs = pgTable('opencti_stream_report_refs', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  reportStixId: text('report_stix_id').notNull(),
  threatStixId: text('threat_stix_id').notNull(),
}, (table) => [
  primaryKey({ name: 'opencti_stream_report_refs_pk', columns: [table.tenantId, table.reportStixId, table.threatStixId] }),
  index('opencti_stream_report_refs_threat_idx').on(table.tenantId, table.threatStixId),
]);

defineSecurityPolicies(openctiStreamReportRefs, tenantIsolationPolicy, reportRefMarkingPolicy);
