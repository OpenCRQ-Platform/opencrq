/*
 * Drizzle ORM's table type system requires `any` in generic type parameters
 * (e.g., PgTableWithColumns<any>, PgText<any>). These are structural requirements
 * of the Drizzle API surface, not unsafe runtime usages.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { exists, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTableWithColumns, PgUUID } from 'drizzle-orm/pg-core';
import type { EventOrigin, GatekeeperResult, SecurityPolicyRule } from '../policy';

/**
 * The OpenCTI markings a client origin may read, or `undefined` when the origin carries no marking
 * scope (a job, a job run borrowing a person's origin, a connector, an internal read, a tenant with
 * no OpenCTI connection): only a person's own request is narrowed, and only by the tenant procedure
 * that asked OpenCTI, so a score still blends every mirrored object (opencrq #31, a stated limit).
 * `null` is a person whose markings OpenCTI did not answer: they hold no clearance, so they read only
 * the unmarked mirrored objects (OpenAEV ADR-009: failing closed means seeing less, never nothing).
 */
export const originMarkingScope = (origin: EventOrigin): ReadonlyArray<string> | null | undefined => {
  if (origin.type !== 'client' || origin.job !== undefined) {
    return undefined;
  }
  return origin.markings;
};

/** The reader's clearance as a SQL array; no answer from OpenCTI is no clearance. */
const markingArray = (markings: ReadonlyArray<string> | null): SQL =>
  (markings === null || markings.length === 0
    ? sql`'{}'::text[]`
    : sql`array[${sql.join(markings.map((marking) => sql`${marking}`), sql`, `)}]::text[]`);

/**
 * A threat row a reader holding `markings` may see: anything the tenant owns (an import, the
 * default catalog), or a row mirrored from OpenCTI whose markings are all among the reader's
 * (multi-marking is AND; an unmarked row is visible to all). A mirrored row whose markings are
 * unknown (`null`, ingested before they were stored) is hidden.
 */
const readableThreat = (kind: SQL | PgColumn, markingRefs: SQL | PgColumn, markings: ReadonlyArray<string> | null): SQL =>
  sql`(${kind} <> 'connector' or (${markingRefs} is not null and ${markingRefs} <@ ${markingArray(markings)}))`;

type TableWithThreatMarkings = PgTableWithColumns<any> & {
  kind: PgColumn,
  markingRefs: PgColumn,
};

/**
 * The writer falls back to `read` for a missing `update` / `delete`: both are spelled out as no
 * predicate so the writes keep exactly their tenant rules (an import upserting a STIX id the reader
 * cannot see must not turn into a silent no-op).
 */
const noWritePredicate = (): GatekeeperResult => undefined;

/** Read-only: writes keep their tenant rules, and the background jobs that score read everything. */
export const threatMarkingPolicy: SecurityPolicyRule<TableWithThreatMarkings> = {
  read: (origin, table): GatekeeperResult => {
    const markings = originMarkingScope(origin);
    return markings === undefined ? undefined : readableThreat(table.kind, table.markingRefs, markings);
  },
  update: noWritePredicate,
  delete: noWritePredicate,
};

type TableWithAnalysisId = PgTableWithColumns<any> & { analysisId: PgUUID<any> };

/**
 * The same rule for a table hanging off a threat: its rows follow their threat. The parent is
 * named in raw SQL, as in `tenant-policies.ts`, since the threat schema imports this module.
 */
export const threatAnalysisMarkingPolicy: SecurityPolicyRule<TableWithAnalysisId> = {
  read: (origin, table): GatekeeperResult => {
    const markings = originMarkingScope(origin);
    if (markings === undefined) {
      return undefined;
    }
    return exists(sql`(select 1 from threat_analyses as marked where marked.id = ${table.analysisId} and ${readableThreat(sql`marked.kind`, sql`marked.marking_refs`, markings)})`);
  },
  update: noWritePredicate,
  delete: noWritePredicate,
};

/**
 * The markings a mirrored STIX body carries, read from its `object_marking_refs`; a body whose
 * markings are not an array (absent included) carries none, as OpenCTI writes an unmarked object.
 */
const bodyMarkings = (data: SQL | PgColumn): SQL =>
  sql`(case when jsonb_typeof(${data}->'object_marking_refs') = 'array' then array(select jsonb_array_elements_text(${data}->'object_marking_refs')) else '{}'::text[] end)`;

const readableBody = (data: SQL | PgColumn, markings: ReadonlyArray<string> | null): SQL =>
  sql`(${bodyMarkings(data)} <@ ${markingArray(markings)})`;

type TableWithStixBody = PgTableWithColumns<any> & { data: PgColumn };

/**
 * A raw mirrored object (a report, a relationship, an identity) a reader may see: all its markings
 * are among the reader's. Read-only, as above: the connector writes and the rebuild job reads all.
 */
export const streamObjectMarkingPolicy: SecurityPolicyRule<TableWithStixBody> = {
  read: (origin, table): GatekeeperResult => {
    const markings = originMarkingScope(origin);
    return markings === undefined ? undefined : readableBody(table.data, markings);
  },
  update: noWritePredicate,
  delete: noWritePredicate,
};

type TableWithReportRef = PgTableWithColumns<any> & { tenantId: PgUUID<any>, reportStixId: PgColumn };

/**
 * Which threats a report cites follows the report: a reader who cannot read the report in OpenCTI
 * does not learn what it cites. A report with no mirror body left is hidden from a narrowed reader.
 */
export const reportRefMarkingPolicy: SecurityPolicyRule<TableWithReportRef> = {
  read: (origin, table): GatekeeperResult => {
    const markings = originMarkingScope(origin);
    if (markings === undefined) {
      return undefined;
    }
    return exists(sql`(select 1 from opencti_stream_objects as cited_report where cited_report.tenant_id = ${table.tenantId} and cited_report.stix_id = ${table.reportStixId} and ${readableBody(sql`cited_report.data`, markings)})`);
  },
  update: noWritePredicate,
  delete: noWritePredicate,
};

/* eslint-enable @typescript-eslint/no-explicit-any */
