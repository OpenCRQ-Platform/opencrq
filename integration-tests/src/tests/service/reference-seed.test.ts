import {
  APPLICABLE_TECHNIQUES,
  attackSurfaceMitreTechniques,
  attackSurfaces,
  dependencyResourceTypes,
  mitreTechniques,
  mitreTechniquesData,
  seed,
  TECHNIQUE_T1053,
  TECHNIQUE_T1053_001,
  TECHNIQUE_T1698,
} from '@app/module';
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, PLATFORM_REFERENCE_TABLES, truncateAllTables } from '../../setup/test-context';

// Reference tables are seeded once in global setup and survive truncation, so this file exercises the
// re-run path of the whole seed registry: idempotent, and rewriting only the rows that diverged.
const countReferenceRows = async (): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {};
  for (const table of PLATFORM_REFERENCE_TABLES) {
    const result = await db.execute<{ n: number }>(sql.raw(`SELECT count(*)::int AS n FROM "${table}"`));
    counts[table] = Number(result.rows[0].n);
  }
  return counts;
};

// xmin (the row version) changes only when Postgres actually rewrites the row.
const rowVersion = async (techniqueId: string): Promise<string> => {
  const result = await db.execute<{ v: string }>(
    sql`SELECT xmin::text AS v FROM mitre_techniques WHERE id = ${techniqueId}`,
  );
  return String(result.rows[0].v);
};

const vendoredName = (techniqueId: string): string => {
  const technique = mitreTechniquesData.find((t) => t.id === techniqueId);
  if (!technique) {
    throw new Error(`technique ${techniqueId} missing from the vendored dataset`);
  }
  return technique.name;
};

const categoriesCiting = (externalId: string): Array<string> => Object.entries(APPLICABLE_TECHNIQUES)
  .filter(([, externalIds]) => (externalIds as ReadonlyArray<string>).includes(externalId))
  .map(([categoryId]) => categoryId)
  .toSorted();

describe('Reference seed', () => {
  beforeAll(async () => {
    // With no tenants, the tenant-scoped seeders (countries, sectors) short-circuit, keeping these
    // assertions on the platform reference catalogue only.
    await truncateAllTables(db);
    await seed(db);
  });

  it('should be idempotent: a second run leaves every reference table untouched', async () => {
    const before = await countReferenceRows();
    for (const [table, count] of Object.entries(before)) {
      expect(count, `${table} should be seeded`).toBeGreaterThan(0);
    }

    await seed(db);

    expect(await countReferenceRows()).toEqual(before);
  });

  it('should rewrite only diverged rows', async () => {
    const untouchedVersion = await rowVersion(TECHNIQUE_T1053_001);
    await db.update(mitreTechniques).set({ name: 'Stale Name' }).where(eq(mitreTechniques.id, TECHNIQUE_T1053));
    const staleVersion = await rowVersion(TECHNIQUE_T1053);

    await seed(db);

    const [repaired] = await db.select().from(mitreTechniques).where(eq(mitreTechniques.id, TECHNIQUE_T1053));
    expect(repaired.name).toBe(vendoredName(TECHNIQUE_T1053));
    expect(await rowVersion(TECHNIQUE_T1053)).not.toBe(staleVersion);
    // The neighbouring sub-technique did not diverge, so `setWhere` must have skipped it.
    expect(await rowVersion(TECHNIQUE_T1053_001)).toBe(untouchedVersion);
  });

  // A deployment seeds once per app version, so a technique the release adds must reach an existing
  // tenant's families in the very run that writes it: no later boot comes to finish the job.
  it('should link a technique the same run adds to an existing tenant\'s families', async () => {
    const { tenantId } = await createTenantWithAdmin(createTestServices(db));
    await db.delete(mitreTechniques).where(eq(mitreTechniques.id, TECHNIQUE_T1698));

    await seed(db);

    const linked = await db.select({ categoryId: attackSurfaces.categoryId })
      .from(attackSurfaceMitreTechniques)
      .innerJoin(attackSurfaces, eq(attackSurfaces.id, attackSurfaceMitreTechniques.attackSurfaceId))
      .where(and(eq(attackSurfaces.tenantId, tenantId), eq(attackSurfaceMitreTechniques.mitreTechniqueId, TECHNIQUE_T1698)));
    expect(linked.map((row) => row.categoryId).toSorted())
      .toEqual(categoriesCiting('T1698'));
  });

  it('should not bring back a dependency resource type a tenant deleted', async () => {
    const { tenantId } = await createTenantWithAdmin(createTestServices(db));
    await db.delete(dependencyResourceTypes)
      .where(and(eq(dependencyResourceTypes.tenantId, tenantId), eq(dependencyResourceTypes.name, 'Transport')));

    await seed(db);

    const names = await db.select({ name: dependencyResourceTypes.name }).from(dependencyResourceTypes)
      .where(eq(dependencyResourceTypes.tenantId, tenantId));
    expect(names.map((row) => row.name)).not.toContain('Transport');
    expect(names).toHaveLength(7);
  });
});
