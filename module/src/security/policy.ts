/*
 * Drizzle ORM's table type system requires `any` in generic type parameters
 * (e.g., PgTableWithColumns<any>, PgUUID<any>). These are structural requirements
 * of the Drizzle API surface, not unsafe runtime usages.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { newError } from '@app/utils';
import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTableWithColumns } from 'drizzle-orm/pg-core';
// The one module-specific type this layer knows: booking a job records who asked, and that
// vocabulary is the jobs module's. Type-only, so nothing cycles at runtime.
import type { TriggeredBy } from '../modules';

/**
 * The run a write was made inside. A job whose handler needs the caller's own authorization keeps
 * a `client` or `connector` origin, so the run would otherwise leave no trace on the write and its
 * notification would read as a user's own edit: this carries the run's identity alongside.
 */
export interface JobRunTag {
  readonly jobKind: string,
  readonly interactive: boolean,
}

/**
 * Who a database access is made on behalf of.
 *
 * `client` and `platform` are the two modes of one authenticated user: inside a tenant, and on the
 * tenant-less platform surface. They are separate members rather than one member with an optional
 * `tenantId` because `undefined` in a policy means "adds no predicate", so a nullable tenant would
 * make a missing tenant read the whole table.
 */
export type EventOrigin =
  /**
   * `markings` are the OpenCTI marking definitions the person may read there (opencrq #31), resolved
   * once per request with their own identity: a threat mirrored from OpenCTI is read only when all
   * its markings are among them. Absent or `null` is a person whose markings are unknown, who reads
   * no mirrored threat (fail closed). A job run borrowing the origin (`job` set) reads them all, so a
   * score blends every source whoever asked for it.
   */
  | { readonly type: 'client', readonly userId: string, readonly tenantId: string, readonly job?: JobRunTag, readonly markings?: ReadonlyArray<string> | null }
  | { readonly type: 'platform', readonly userId: string }
  | { readonly type: 'auth' }
  | { readonly type: 'system' }
  | { readonly type: 'connector', readonly serviceAccountId: string, readonly tenantId: string, readonly job?: JobRunTag }
  /**
   * A background task with nobody behind it. Scoped to its tenant, unlike `system`: a recompute
   * reading across tenants would score one estate on another's declarations. `jobKind` is what the
   * writer stamps on the run's transactions so its own change notifications can be told apart.
   * `interactive` is relayed the same way, so a run somebody is waiting on reaches the page as fast
   * as that person's own edit while a full-estate sweep does not.
   */
  | { readonly type: 'job', readonly tenantId: string, readonly jobKind: string, readonly interactive: boolean };

/** An authenticated human, in either of the two modes. */
export type UserOrigin = Extract<EventOrigin, { type: 'client' | 'platform' }>;

export type ConnectorOrigin = Extract<EventOrigin, { type: 'connector' }>;

/** `undefined` adds no predicate, so it must only ever be returned for an origin that may read everything. */
export type GatekeeperResult = SQL | undefined;

export const originUserId = (origin: EventOrigin): string | undefined =>
  (origin.type === 'client' || origin.type === 'platform' ? origin.userId : undefined);

export const originServiceAccountId = (origin: EventOrigin): string | undefined =>
  (origin.type === 'connector' ? origin.serviceAccountId : undefined);

/**
 * Who asked for a job, read off whoever books it: `user` for a request a person made, `connector`
 * for one a service account made, `system` for anything else. Attribution only — whether anybody
 * waits on the result is the separate `interactive` axis, which only the enqueue site can answer.
 */
export const originTrigger = (origin: EventOrigin): { triggeredBy: TriggeredBy, triggeredById?: string } => {
  if (origin.type === 'client' || origin.type === 'platform') {
    return { triggeredBy: 'user', triggeredById: origin.userId };
  }
  if (origin.type === 'connector') {
    return { triggeredBy: 'connector', triggeredById: origin.serviceAccountId };
  }
  return { triggeredBy: 'system' };
};

/** Whose run tagged this write, whether the origin is the run's own or a caller's it borrowed. */
export const originJobTag = (origin: EventOrigin): JobRunTag | undefined => {
  if (origin.type === 'job') {
    return { jobKind: origin.jobKind, interactive: origin.interactive };
  }
  return origin.type === 'client' || origin.type === 'connector' ? origin.job : undefined;
};

export const originTenantId = (origin: EventOrigin): string | undefined =>
  (origin.type === 'client' || origin.type === 'connector' || origin.type === 'job' ? origin.tenantId : undefined);

/** Throws on the origins carrying no tenant, so a tenant-less caller fails loudly instead of running a query that spans tenants. */
export const requireTenantId = (origin: EventOrigin): string => {
  const tenantId = originTenantId(origin);
  if (tenantId === undefined) {
    throw newError('Tenant context required', { originType: origin.type });
  }
  return tenantId;
};

/**
 * Same, for the writes a connector must never make. Their procedures refuse a service account first
 * (`userSessionOnly` in `back`), since this throw reaches an API client as an opaque 500.
 */
export const requireClientTenantId = (origin: EventOrigin): string => {
  if (origin.type !== 'client') {
    throw newError('Tenant context required', { originType: origin.type });
  }
  return origin.tenantId;
};

export type SecurityPolicyRule<T extends PgTableWithColumns<any>> = {
  read?: (origin: EventOrigin, table: T) => GatekeeperResult,
  update?: (origin: EventOrigin, table: T) => GatekeeperResult,
  delete?: (origin: EventOrigin, table: T) => GatekeeperResult,
  create?: (origin: EventOrigin, values: T['$inferInsert']) => GatekeeperResult,
  /**
   * The column whose equality with the job's tenant is the whole of `update` for a job origin, and
   * which `create` pins to that tenant. An upsert whose conflict target holds it can be certified
   * as an overwrite: the stored row matched the target, so the predicate is true by construction.
   */
  overwriteKey?: (table: T) => PgColumn,
};

const securityPolicyRegistry = new Map<any, Array<SecurityPolicyRule<any>>>();

export const defineSecurityPolicies = <T extends PgTableWithColumns<any>>(
  table: T,
  ...policies: Array<SecurityPolicyRule<T>>
) => {
  const existing = securityPolicyRegistry.get(table) || [];
  securityPolicyRegistry.set(table, [...existing, ...policies]);
};

export const getSecurityPolicies = <T extends PgTableWithColumns<any>>(table: T) => securityPolicyRegistry.get(table) || [];

/* eslint-enable @typescript-eslint/no-explicit-any */
