/*
 * Drizzle ORM's table type system requires `any` in generic type parameters
 * (e.g., PgTableWithColumns<any>, PgUUID<any>). These are structural requirements
 * of the Drizzle API surface, not unsafe runtime usages.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { newError } from '@app/utils';
import { and, eq, exists, getTableName, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PgTableWithColumns, PgUUID } from 'drizzle-orm/pg-core';
import type { EventOrigin, GatekeeperResult, SecurityPolicyRule } from '../policy';
import type { users } from '../../modules';
import { Capability_ManageSecurity, PlatformCapability_CreateTenants, tenantUsers } from '../../modules';
import { capabilityHeldInTenant } from './capability-policies';
import { hasManageUsers, platformCapabilityHeld } from './platform-policies';
import { userIsSuperAdmin } from './super-admin-policies';

const saActiveCheck = (serviceAccountId: string, tenantId: string) =>
  exists(sql`(select 1 from service_accounts where id = ${serviceAccountId} and tenant_id = ${tenantId} and active = true)`);

/** What an origin must satisfy beyond tenant scope: a service account can be deactivated, a job cannot. */
const originLiveness = (origin: Extract<EventOrigin, { type: 'connector' | 'job' }>): GatekeeperResult =>
  (origin.type === 'connector' ? saActiveCheck(origin.serviceAccountId, origin.tenantId) : undefined);

/**
 * Kept apart from any reference to the row: uncorrelated, Postgres evaluates it once, whereas
 * correlated to the row it runs as a semi-join on every row and keeps a tenant-wide read from
 * going parallel.
 */
const callerIsMember = (origin: Extract<EventOrigin, { type: 'client' }>): SQL =>
  exists(
    sql`(select 1
         from ${tenantUsers}
         where ${and(
            eq(tenantUsers.tenantId, origin.tenantId),
            eq(tenantUsers.userId, origin.userId),
          )})`,
  );

/** A member of the origin's tenant, or the super administrator, who reaches every tenant without being one. */
const callerReachesTenant = (origin: Extract<EventOrigin, { type: 'client' }>): SQL =>
  sql`(${userIsSuperAdmin(origin.userId)} or ${callerIsMember(origin)})`;

export type TableWithTenantUUID = PgTableWithColumns<any> & {
  tenantId: PgUUID<any>,
};

const RUDRule: (origin: EventOrigin, table: any) => GatekeeperResult = (origin, table) => {
  switch (origin.type) {
    case 'auth':
    case 'system':
      return undefined;
    case 'connector':
    case 'job':
      return and(
        eq(table.tenantId, origin.tenantId),
        originLiveness(origin),
      );
    case 'platform':
      return sql`false`;
    case 'client':
      return and(eq(table.tenantId, origin.tenantId), callerReachesTenant(origin));
  }
};

export const tenantIsolationPolicy: SecurityPolicyRule<TableWithTenantUUID> = {
  read: RUDRule,
  update: RUDRule,
  delete: RUDRule,
  overwriteKey: (table) => table.tenantId,
  create: (origin, values) => {
    switch (origin.type) {
      case 'auth':
      case 'system':
        return undefined;
      case 'connector':
      case 'job':
        if (values.tenantId && values.tenantId !== origin.tenantId) {
          throw newError('Cannot create for another tenant');
        }
        return originLiveness(origin);
      case 'platform':
        return sql`false`;
      case 'client':
        if (values.tenantId && values.tenantId !== origin.tenantId) {
          throw newError('Cannot create for another tenant');
        }
        return callerReachesTenant(origin);
    }
  },
};

type TableWithUUIDColumn<K extends string> = PgTableWithColumns<any> & Record<K, PgUUID<any>>;

/** Proves that a parent row belongs to a tenant, given the parent id as a column or a value. */
type ParentInTenant = (parentId: unknown, tenantId: string) => SQL;

const parentScopedRule = (origin: EventOrigin, parentInTenant: (tenantId: string) => SQL): GatekeeperResult => {
  switch (origin.type) {
    case 'auth':
    case 'system':
      return undefined;
    case 'connector':
    case 'job':
      return and(parentInTenant(origin.tenantId), originLiveness(origin));
    case 'platform':
      return sql`false`;
    case 'client':
      return and(parentInTenant(origin.tenantId), callerReachesTenant(origin));
  }
};

/**
 * For a table with no `tenant_id` of its own, scoped through the parent its `key` column names.
 * Parents are named in raw SQL: their schema files import this module, so a table symbol would
 * close an import cycle.
 */
const parentScopedPolicy = <K extends string>(key: K, parentInTenant: ParentInTenant): SecurityPolicyRule<TableWithUUIDColumn<K>> => {
  const rule = (origin: EventOrigin, row: Record<K, unknown>): GatekeeperResult =>
    parentScopedRule(origin, (tenantId) => parentInTenant(row[key], tenantId));
  return { read: rule, update: rule, delete: rule, create: rule };
};

const organizationInTenant: ParentInTenant = (id, tenantId) =>
  exists(sql`(select 1 from organizations where id = ${id} and tenant_id = ${tenantId})`);

const supportingAssetInTenant: ParentInTenant = (id, tenantId) =>
  exists(sql`(select 1 from supporting_assets where id = ${id} and tenant_id = ${tenantId})`);

export const organizationTenantIsolationPolicy = parentScopedPolicy('organizationId', organizationInTenant);

export const riskScenarioTenantIsolationPolicy = parentScopedPolicy('riskScenarioId', (id, tenantId) =>
  exists(sql`(select 1 from risk_scenarios where id = ${id} and tenant_id = ${tenantId})`));

export const primaryAssetTenantIsolationPolicy = parentScopedPolicy('primaryAssetId', (id, tenantId) =>
  exists(sql`(select 1 from primary_assets inner join organizations on primary_assets.organization_id = organizations.id where primary_assets.id = ${id} and organizations.tenant_id = ${tenantId})`));

export const supportingAssetTenantIsolationPolicy = parentScopedPolicy('supportingAssetId', supportingAssetInTenant);

export type TableWithOrganizationAndSupportingAssetUUID = TableWithUUIDColumn<'organizationId'> & TableWithUUIDColumn<'supportingAssetId'>;

/**
 * For a junction pairing a risk scope with an asset: its own `tenant_id` proves nothing about the
 * scope it names, so without this a crafted write maps another tenant's scope. Only the scope end
 * is proved here, because every row of one batch carries the same scope and the writer then runs
 * the proof once; a rule naming each row's `supportingAssetId` renders a distinct statement per
 * row, so a save mapping five thousand assets would issue five thousand round trips inside the
 * transaction. The asset end is proved by the organizations service instead, in one query over
 * `views.supportingAssets` before the insert, and refuses the whole write the same way.
 * This carries no read rule, so the mapping a reader joins on stays a single tenant predicate over
 * rows that may number in the hundreds of thousands.
 */
export const organizationAssetPairingPolicy: SecurityPolicyRule<TableWithOrganizationAndSupportingAssetUUID> = {
  create: (origin, values) => organizationTenantIsolationPolicy.create?.(origin, values),
};

export const crqIndicatorRunTenantIsolationPolicy = parentScopedPolicy('runId', (id, tenantId) =>
  exists(sql`(select 1 from crq_indicator_runs inner join risk_scenarios on crq_indicator_runs.risk_scenario_id = risk_scenarios.id where crq_indicator_runs.id = ${id} and risk_scenarios.tenant_id = ${tenantId})`));

export const attackOutcomeTenantIsolationPolicy = parentScopedPolicy('attackOutcomeId', (id, tenantId) =>
  exists(sql`(select 1 from attack_outcomes where id = ${id} and tenant_id = ${tenantId})`));

export const threatAnalysisTenantIsolationPolicy = parentScopedPolicy('analysisId', (id, tenantId) =>
  exists(sql`(select 1 from threat_analyses where id = ${id} and tenant_id = ${tenantId})`));

export const jobChildTenantIsolationPolicy = parentScopedPolicy('jobId', (id, tenantId) =>
  exists(sql`(select 1 from jobs where id = ${id} and tenant_id = ${tenantId})`));

export const attackSurfaceTenantIsolationPolicy = parentScopedPolicy('attackSurfaceId', (id, tenantId) =>
  exists(sql`(select 1 from attack_surfaces where id = ${id} and tenant_id = ${tenantId})`));

export const treatmentPlanTenantIsolationPolicy = parentScopedPolicy('planId', (id, tenantId) =>
  exists(sql`(select 1 from treatment_plans inner join organizations on treatment_plans.organization_id = organizations.id where treatment_plans.id = ${id} and organizations.tenant_id = ${tenantId})`));

export const budgetReviewTenantIsolationPolicy = parentScopedPolicy('reviewId', (id, tenantId) =>
  exists(sql`(select 1 from budget_reviews inner join organizations on budget_reviews.organization_id = organizations.id where budget_reviews.id = ${id} and organizations.tenant_id = ${tenantId})`));

// Policy for the tenants table itself: the tenants the user is a member of, every tenant for the super administrator
export type TableWithIdUUID = PgTableWithColumns<any> & {
  id: PgUUID<any>,
};

const tenantMembershipRule: (origin: EventOrigin, table: TableWithIdUUID) => GatekeeperResult = (origin, table) => {
  switch (origin.type) {
    case 'auth':
    case 'system':
      return undefined;
    case 'connector':
    case 'job':
      return and(
        eq(table.id, origin.tenantId),
        originLiveness(origin),
      );
    case 'client':
    case 'platform':
      return sql`(${userIsSuperAdmin(origin.userId)} or ${exists(
        sql`(select 1
             from ${tenantUsers}
             where ${and(
                eq(tenantUsers.tenantId, table.id),
                eq(tenantUsers.userId, origin.userId),
              )})`,
      )})`;
  }
};

export const tenantMembershipPolicy: SecurityPolicyRule<TableWithIdUUID> = {
  read: tenantMembershipRule,
  delete: tenantMembershipRule,
};

/**
 * The only `update` rule of `tenants`: rules of several policies on a table combine with AND, and a
 * policy without an `update` rule is applied through its `read` rule. Without this one, any member
 * could rewrite the row; through that same fallback, `tenantMembershipPolicy` ANDs membership into
 * every update, so no arm repeats it. `client` and `platform` share the rename arm because
 * `x-tenant-id` makes a caller `client`. A rule allows a row, not a column: a Create Tenants holder
 * passes it for every column, `default_locale` included, which only the procedure keeps to
 * `MANAGE_SECURITY`.
 */
const tenantUpdateRule: (origin: EventOrigin, table: TableWithIdUUID) => GatekeeperResult = (origin, table) => {
  const mayRename = (userId: string) => platformCapabilityHeld(userId, PlatformCapability_CreateTenants);
  switch (origin.type) {
    case 'auth':
    case 'system':
      return undefined;
    case 'job':
      return sql`false`;
    case 'connector':
      return and(eq(table.id, origin.tenantId), capabilityHeldInTenant(origin, Capability_ManageSecurity));
    case 'client':
      return or(
        and(eq(table.id, origin.tenantId), capabilityHeldInTenant(origin, Capability_ManageSecurity)),
        mayRename(origin.userId),
      );
    case 'platform':
      return mayRename(origin.userId);
  }
};

export const tenantUpdatePolicy: SecurityPolicyRule<TableWithIdUUID> = {
  update: tenantUpdateRule,
};

// Policy for the users table: co-members of the tenant on the origin, or, on the tenant-less
// platform surface, the caller's own row plus every user once they hold MANAGE_USERS. The super
// administrator reads the members of every tenant, and is a member of none.
const tenantUsersRule: (origin: EventOrigin, table: TableWithIdUUID) => GatekeeperResult = (origin, table) => {
  switch (origin.type) {
    case 'auth':
    case 'system':
      return undefined;
    case 'connector':
    case 'job':
      return and(
        exists(sql`(select 1 from ${tenantUsers} where ${and(eq(tenantUsers.tenantId, origin.tenantId), eq(tenantUsers.userId, table.id))})`),
        originLiveness(origin),
      );
    case 'platform':
      return or(eq(table.id, origin.userId), hasManageUsers(origin.userId));
    case 'client':
      // Two memberships, not one: `origin.tenantId` is the header the caller sent, so proving the
      // row belongs to that tenant proves nothing until the caller is shown to belong to it too.
      return and(
        callerReachesTenant(origin),
        exists(
          sql`(select 1
               from ${tenantUsers}
               where ${and(
                  eq(tenantUsers.tenantId, origin.tenantId),
                  eq(tenantUsers.userId, table.id),
                )})`,
        ),
      );
  }
};

/**
 * Reading users: the rows the rule above shows, and the super administrators' in any tenant its
 * caller reaches. A super administrator acts in every tenant as a member of none, and their name
 * has to show wherever they wrote; `is_super_admin` is the row's own column, so it costs no lookup.
 * Reading only: removing a row stays limited to members.
 */
const usersReadRule: (origin: EventOrigin, table: typeof users) => GatekeeperResult = (origin, table) => {
  const isSuperAdminRow = eq(table.isSuperAdmin, true);
  switch (origin.type) {
    case 'connector':
    case 'job':
      return and(
        or(
          exists(sql`(select 1 from ${tenantUsers} where ${and(eq(tenantUsers.tenantId, origin.tenantId), eq(tenantUsers.userId, table.id))})`),
          isSuperAdminRow,
        ),
        originLiveness(origin),
      );
    case 'client':
      return and(
        callerReachesTenant(origin),
        or(
          exists(sql`(select 1 from ${tenantUsers} where ${and(eq(tenantUsers.tenantId, origin.tenantId), eq(tenantUsers.userId, table.id))})`),
          isSuperAdminRow,
        ),
      );
    case 'auth':
    case 'system':
    case 'platform':
      return tenantUsersRule(origin, table);
  }
};

const selfOnlyUpdateRule: (origin: EventOrigin, table: TableWithIdUUID) => GatekeeperResult = (origin, table) => {
  switch (origin.type) {
    case 'auth':
    case 'system':
      return undefined;
    case 'connector':
    case 'job':
      return sql`false`; // service accounts cannot update user profiles
    case 'client':
    case 'platform':
      return eq(table.id, origin.userId);
  }
};

export const tenantUsersPolicy: SecurityPolicyRule<typeof users> = {
  read: usersReadRule,
  update: selfOnlyUpdateRule,
  delete: tenantUsersRule,
};

/** Aliased because the secured view of `tenant_users` is itself named `tenant_users`, and built inside the function for the import cycle `ownedByTenant` documents. */
const callerBelongsToRowTenant = (userId: string, table: typeof tenantUsers): SQL => {
  const callerMembership = alias(tenantUsers, 'caller_membership');
  return exists(
    sql`(select 1 from ${tenantUsers} as ${sql.raw(getTableName(callerMembership))} where ${and(
      eq(callerMembership.tenantId, table.tenantId),
      eq(callerMembership.userId, userId),
    )})`,
  );
};

const tenantUserRowsReadRule: (origin: EventOrigin, table: typeof tenantUsers) => GatekeeperResult = (origin, table) => {
  switch (origin.type) {
    case 'auth':
    case 'system':
      return undefined;
    case 'connector':
    case 'job':
      return and(
        eq(table.tenantId, origin.tenantId),
        originLiveness(origin),
      );
    // The header must not change rights: the Tenants page counts the members of all the caller's tenants even while one is selected.
    case 'client':
    case 'platform':
      return or(callerBelongsToRowTenant(origin.userId, table), hasManageUsers(origin.userId));
  }
};

// MANAGE_SECURITY is read in the origin's tenant, never the row's, so a manager of one tenant cannot touch another's members.
const tenantUserRowsUpdateRule: (origin: EventOrigin, table: typeof tenantUsers) => GatekeeperResult = (origin, table) => {
  switch (origin.type) {
    case 'auth':
    case 'system':
      return undefined;
    case 'platform':
    case 'connector':
    case 'job':
      return sql`false`;
    case 'client':
      return and(
        eq(table.tenantId, origin.tenantId),
        or(eq(table.userId, origin.userId), capabilityHeldInTenant(origin, Capability_ManageSecurity)),
      );
  }
};

const tenantUserRowsDeleteRule: (origin: EventOrigin, table: typeof tenantUsers) => GatekeeperResult = (origin, table) => {
  switch (origin.type) {
    case 'auth':
    case 'system':
      return undefined;
    case 'platform':
    case 'connector':
    case 'job':
      return sql`false`;
    case 'client':
      return and(
        eq(table.tenantId, origin.tenantId),
        capabilityHeldInTenant(origin, Capability_ManageSecurity),
      );
  }
};

export const tenantUserRowsPolicy: SecurityPolicyRule<typeof tenantUsers> = {
  read: tenantUserRowsReadRule,
  update: tenantUserRowsUpdateRule,
  delete: tenantUserRowsDeleteRule,
  create: (origin, values) => {
    switch (origin.type) {
      case 'auth':
      case 'system':
        return undefined;
      case 'platform':
      case 'connector':
      case 'job':
        return sql`false`;
      case 'client':
        if (values.tenantId !== origin.tenantId) {
          throw newError('Cannot create for another tenant');
        }
        return capabilityHeldInTenant(origin, Capability_ManageSecurity);
    }
  },
};

/* eslint-enable @typescript-eslint/no-explicit-any */
