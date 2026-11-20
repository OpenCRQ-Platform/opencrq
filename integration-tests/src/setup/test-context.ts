import { allServiceDefinitions, createProtectedDB, createSecuredSchema, createServices } from '@app/module';
import type { DrizzleDB, EventOrigin, RepositoryContext } from '@app/module';
import { sql } from 'drizzle-orm';

export type TestServices = ReturnType<typeof createServices<typeof allServiceDefinitions>>;

export const createTestServices = (db: DrizzleDB): TestServices => createServices([...allServiceDefinitions], db);

export const repositoryContextOf = (db: DrizzleDB, origin: EventOrigin): RepositoryContext => ({
  db: createProtectedDB(db, (callback) => db.transaction(callback), origin),
  views: createSecuredSchema(db, origin),
  rawDb: () => db,
});

// Platform reference catalogue tables, seeded by the seed registry without tenant scoping.
// reference-seed.test.ts derives its idempotence coverage from this list.
export const PLATFORM_REFERENCE_TABLES = [
  'mitre_tactics',
  'mitre_techniques',
  'mitre_mitigations',
  'mitre_technique_tactics',
  'mitre_mitigation_techniques',
  // Defensive-capability catalogue (platform reference data, seeded once).
  'control_capabilities',
  'control_capability_strength_rung_labels',
  'control_capability_edges',
  'control_capability_crosswalk',
  'control_capability_protected_families',
  'security_platform_families',
  'security_platform_family_controls',
  'cwe_weaknesses',
  'cwe_technique_links',
  'compliance_frameworks',
  'compliance_framework_nodes',
  'compliance_requirement_controls',
];

// Tables that contain seeded reference data and must NOT be emptied.
const SEEDED_TABLES = new Set([
  'capabilities',
  'platform_capabilities',
  ...PLATFORM_REFERENCE_TABLES,
]);
const SYSTEM_TABLES = new Set(['__drizzle_migrations']);

/**
 * Empties every table but the seeded and system ones, plus every table a foreign key chain ties to
 * one it empties, the set a `TRUNCATE ... CASCADE` would reach.
 *
 * `DELETE` rather than `TRUNCATE`: a truncate rebuilds and fsyncs every index of every table, about
 * 1.4 s per test on the CI runner. The replica role skips the foreign key and notification triggers,
 * so the order of the deletes does not matter. Setting it needs a superuser, as the CI and dev
 * Postgres roles are.
 */
export const truncateAllTables = async (db: DrizzleDB) => {
  const excluded = [...SEEDED_TABLES, ...SYSTEM_TABLES];
  await db.execute(sql`
    DO $reset$
    DECLARE
      t text;
    BEGIN
      PERFORM set_config('session_replication_role', 'replica', true);
      FOR t IN
        WITH RECURSIVE cleared AS (
          SELECT c.oid
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind = 'r'
            AND c.relname <> ALL (ARRAY[${sql.raw(excluded.map((t) => `'${t}'`).join(', '))}]::text[])
          UNION
          SELECT con.conrelid
          FROM pg_constraint con
          JOIN cleared ON con.confrelid = cleared.oid
          WHERE con.contype = 'f'
        )
        SELECT c.relname FROM pg_class c JOIN cleared ON cleared.oid = c.oid
      LOOP
        EXECUTE format('DELETE FROM public.%I', t);
      END LOOP;
    END
    $reset$
  `);
};
