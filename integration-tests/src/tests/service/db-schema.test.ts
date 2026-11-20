import { is, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { schema, TABLES_WITHOUT_DATA_CHANGED_TRIGGER } from '@app/module';
import { db } from '../../setup/db';

/** PostgreSQL truncates identifiers to 63 bytes, and an unnamed primary key truncates its table name to leave room for "_pkey". */
const IDENTIFIER_LENGTH = 63;
const defaultPrimaryKeyName = (table: string): string => `${table.slice(0, IDENTIFIER_LENGTH - '_pkey'.length)}_pkey`;

/** The name the schema gives each table's primary key, which a database built from it alone carries. */
const declaredPrimaryKeys = (): Array<string> => Object.values<unknown>(schema)
  .filter((value): value is PgTable => is(value, PgTable))
  .flatMap((table) => {
    const { name, columns, primaryKeys } = getTableConfig(table);
    if (primaryKeys.length > 0) {
      return primaryKeys.map((primaryKey) => `${name}: ${primaryKey.getName().slice(0, IDENTIFIER_LENGTH)}`);
    }
    return columns.some((column) => column.primary) ? [`${name}: ${defaultPrimaryKeyName(name)}`] : [];
  });

/**
 * The parents a deletion removes one row at a time, which may leave a referencing key unserved: each
 * deletion then scans the child once. A parent leaves the list once all its keys are served.
 */
const PARENTS_DELETED_A_ROW_AT_A_TIME = new Set([
  // Removed one at a time by an administrator.
  'groups', 'platform_roles', 'roles', 'tenants', 'users',
  // Platform catalogs, which nothing deletes.
  'capabilities', 'compliance_framework_nodes', 'compliance_frameworks', 'control_capabilities', 'cwe_weaknesses',
  'mitre_tactics', 'mitre_techniques', 'platform_capabilities',
  // Never deleted but with their tenant.
  'countries', 'cve', 'integration_settings', 'sectors', 'service_accounts',
  // Deleted by a seed when the catalog it ships retires an entry.
  'attack_outcomes', 'business_value_categories', 'loss_categories', 'loss_drivers',
]);

describe('DB schema conventions', () => {
  it('every user table has a data_changed notify trigger', async () => {
    const tablesResult = await db.execute<{ table_name: string }>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name != '__drizzle_migrations'
    `);
    const allTables = tablesResult.rows
      .map((r) => r.table_name)
      .filter((t) => !TABLES_WITHOUT_DATA_CHANGED_TRIGGER.has(t));

    const triggersResult = await db.execute<{ trigger_name: string }>(sql`
      SELECT trigger_name
      FROM information_schema.triggers
      WHERE event_object_schema = 'public'
        AND trigger_name LIKE '%_notify_data_changed'
    `);
    const triggerNames = new Set(
      triggersResult.rows.map((r) => r.trigger_name),
    );

    const missing = allTables.filter((t) => !triggerNames.has(`${t}_notify_data_changed`));

    expect(missing, `Tables missing a data_changed trigger: ${missing.join(', ')}`).toHaveLength(0);
  });

  it('every user table is analyzed by autovacuum without waiting for 50 writes', async () => {
    const result = await db.execute<{ table_name: string }>(sql`
      SELECT c.relname AS table_name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND NOT coalesce(c.reloptions, '{}') @> ARRAY['autovacuum_analyze_threshold=0']
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual([]);
  });

  // A table rename keeps its primary key's old name, which drizzle neither tracks nor renames: a
  // database built from the schema alone would then name it differently from one built from the
  // migrations, and a later migration dropping it by name would fail on one of the two.
  it('every primary key carries the name the schema gives it', async () => {
    const result = await db.execute<{ table_name: string, constraint_name: string }>(sql`
      SELECT table_name, constraint_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public' AND constraint_type = 'PRIMARY KEY'
    `);

    expect(result.rows.map((row) => `${row.table_name}: ${row.constraint_name}`).toSorted())
      .toEqual(declaredPrimaryKeys().toSorted());
  });

  // Deleting a parent looks its referencing rows up once per deleted row, so a parent deleted by a list
  // or a sweep scans every child no index serves once per row it loses. A key on `(x, tenant_id)` is
  // served by an index led by `x`, or by `tenant_id` then `x`.
  it('every foreign key has an index serving its lookup, unless its parent is deleted a row at a time', async () => {
    const result = await db.execute<{ parent: string, foreign_key: string }>(sql`
      SELECT c.confrelid::regclass::text AS parent, c.conrelid::regclass::text || ': ' || c.conname AS foreign_key
      FROM pg_constraint c
      WHERE c.contype = 'f'
        AND NOT EXISTS (
          SELECT 1
          FROM pg_index i
          CROSS JOIN generate_series(0, i.indnkeyatts - 1) AS pos
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = i.indkey[pos]
          WHERE i.indrelid = c.conrelid AND i.indpred IS NULL AND i.indisvalid
            AND a.attnum = ANY(c.conkey) AND (a.attname <> 'tenant_id' OR cardinality(c.conkey) = 1)
            AND NOT EXISTS (SELECT 1 FROM generate_series(0, pos - 1) AS before WHERE NOT i.indkey[before] = ANY(c.conkey))
        )
    `);
    const unserved = result.rows.filter((row) => !PARENTS_DELETED_A_ROW_AT_A_TIME.has(row.parent));
    const staleExceptions = [...PARENTS_DELETED_A_ROW_AT_A_TIME].filter((parent) => !result.rows.some((row) => row.parent === parent));

    expect(unserved.map((row) => row.foreign_key).toSorted()).toEqual([]);
    expect(staleExceptions).toEqual([]);
  });
});
