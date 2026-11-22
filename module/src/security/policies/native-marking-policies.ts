/*
 * Drizzle ORM's table type system requires `any` in generic type parameters
 * (e.g., PgTableWithColumns<any>). These are structural requirements of the Drizzle API surface,
 * not unsafe runtime usages.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTableWithColumns, PgUUID } from 'drizzle-orm/pg-core';
import type { EventOrigin, GatekeeperResult, SecurityPolicyRule } from '../policy';
import { userIsSuperAdmin } from './super-admin-policies';

/**
 * The person whose OpenCRQ clearance narrows a read (CTEM marking parity, G2): a person reading for
 * themselves in a tenant. A job, a job run borrowing a person's origin, a connector and an internal
 * read are not narrowed, so a score still blends every object (OpenAEV ADR-009: background jobs see
 * all; derived and aggregate figures are a stated limit).
 */
export const nativeClearanceReader = (origin: EventOrigin): { userId: string, tenantId: string } | undefined =>
  (origin.type === 'client' && origin.job === undefined ? { userId: origin.userId, tenantId: origin.tenantId } : undefined);

/**
 * The STIX ids of the markings a member of the tenant is cleared for, as a SQL array: the union over
 * their groups of `group_marking_definitions`, each held marking expanded to the markings of its type
 * ranked at or below it (`order`), as OpenCTI and OpenAEV expand a clearance. It names no column of
 * the row being filtered, so Postgres evaluates it once per statement. A member of no cleared group
 * is cleared for nothing and reads only unmarked rows.
 */
export const clearedMarkings = (userId: string, tenantId: string): SQL => sql`array(select cleared.stix_id from marking_definitions as cleared where cleared.tenant_id = ${tenantId} and exists(select 1 from group_marking_definitions as clearance inner join marking_definitions as held on held.id = clearance.marking_definition_id and held.tenant_id = clearance.tenant_id inner join group_users as member on member.group_id = clearance.group_id where clearance.tenant_id = ${tenantId} and member.user_id = ${userId} and held.definition_type = cleared.definition_type and held."order" >= cleared."order"))`;

const textArray = (values: ReadonlyArray<string>): SQL =>
  (values.length === 0
    ? sql`'{}'::text[]`
    : sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`);

type TableWithNativeMarkings = PgTableWithColumns<any> & { markingRefs: PgColumn };

/**
 * A tenant object carrying OpenCRQ markings (`marking_refs`, STIX ids): a person reads it only when
 * every marking it carries is in their clearance (multi-marking is AND; an unmarked row is visible to
 * all; a marking the tenant does not define is never cleared, so its rows are hidden), as OpenAEV
 * ADR-009 and OpenCTI decide. A row out of clearance is absent, so a direct read answers not found,
 * never forbidden. The super administrator reads everything. `update` and `delete` fall back to
 * `read`: nobody changes a row they cannot see. `create` refuses a marking the creator does not hold.
 */
export const nativeMarkingPolicy: SecurityPolicyRule<TableWithNativeMarkings> = {
  read: (origin, table): GatekeeperResult => {
    const reader = nativeClearanceReader(origin);
    return reader === undefined
      ? undefined
      : sql`(${userIsSuperAdmin(reader.userId)} or ${table.markingRefs} <@ ${clearedMarkings(reader.userId, reader.tenantId)})`;
  },
  create: (origin, values): GatekeeperResult => {
    const reader = nativeClearanceReader(origin);
    const assigned = (values as { markingRefs?: ReadonlyArray<string> | null }).markingRefs ?? [];
    if (reader === undefined || assigned.length === 0) {
      return undefined;
    }
    return sql`(${userIsSuperAdmin(reader.userId)} or ${textArray(assigned)} <@ ${clearedMarkings(reader.userId, reader.tenantId)})`;
  },
};

type TableWithSupportingAssetId = PgTableWithColumns<any> & { supportingAssetId: PgUUID<any> };

/**
 * A row hanging off a supporting asset (a finding) follows its asset: a person who cannot read the
 * asset, its markings being out of their clearance, does not read the row either, so a CVE or a
 * technique page never reveals a hidden asset through its findings. The asset is named in raw SQL,
 * as `threatAnalysisMarkingPolicy` names its threat, since the asset schema imports this module.
 * `update` and `delete` fall back to `read`; jobs and connectors are not narrowed.
 */
export const supportingAssetMarkingPolicy: SecurityPolicyRule<TableWithSupportingAssetId> = {
  read: (origin, table): GatekeeperResult => {
    const reader = nativeClearanceReader(origin);
    return reader === undefined
      ? undefined
      : sql`(${userIsSuperAdmin(reader.userId)} or exists(select 1 from supporting_assets as marked_asset where marked_asset.id = ${table.supportingAssetId} and marked_asset.marking_refs <@ ${clearedMarkings(reader.userId, reader.tenantId)}))`;
  },
};

/* eslint-enable @typescript-eslint/no-explicit-any */
