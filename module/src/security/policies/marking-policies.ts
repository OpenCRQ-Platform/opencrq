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
 * `null` is a person whose markings OpenCTI did not answer: they read no mirrored object.
 */
export const originMarkingScope = (origin: EventOrigin): ReadonlyArray<string> | null | undefined => {
  if (origin.type !== 'client' || origin.job !== undefined) {
    return undefined;
  }
  return origin.markings;
};

const markingArray = (markings: ReadonlyArray<string>): SQL =>
  (markings.length === 0
    ? sql`'{}'::text[]`
    : sql`array[${sql.join(markings.map((marking) => sql`${marking}`), sql`, `)}]::text[]`);

/**
 * A threat row a reader holding `markings` may see: anything the tenant owns (an import, the
 * default catalog), or a row mirrored from OpenCTI whose markings are all among the reader's. A
 * mirrored row whose markings are unknown (`null`, ingested before they were stored) is hidden.
 */
const readableThreat = (kind: SQL | PgColumn, markingRefs: SQL | PgColumn, markings: ReadonlyArray<string> | null): SQL =>
  (markings === null
    ? sql`(${kind} <> 'connector')`
    : sql`(${kind} <> 'connector' or (${markingRefs} is not null and ${markingRefs} <@ ${markingArray(markings)}))`);

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

/* eslint-enable @typescript-eslint/no-explicit-any */
