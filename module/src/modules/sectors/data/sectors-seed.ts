import type { DrizzleDB } from '../../../db';
import type { SeedFunction } from '../../../seed-registry';
import { newError } from '@app/utils';
import { sql } from 'drizzle-orm';
import { deriveSeedId } from '../../../seed-ids';
import { registerSeed } from '../../../seed-registry';
import { tenants } from '../../tenants/schema';
import { sectors } from '../schema';
import { sectorsData } from './sectors-data';

const catalogIdByName = new Map(sectorsData.map((s) => [s.name, s.id]));

/** The catalog UUID of a sector, resolved by its catalog name. Throws on an unknown name. */
export const sectorCatalogId = (name: string): string => {
  const catalogId = catalogIdByName.get(name);
  if (!catalogId) {
    throw newError('Unknown sector name', { name });
  }
  return catalogId;
};

export const buildSectorRows = (tenantId: string): Array<typeof sectors.$inferInsert> =>
  sectorsData.map((s) => ({
    id: deriveSeedId(tenantId, s.id),
    tenantId,
    name: s.name,
    description: s.description,
  }));

const sectorUpdate = {
  description: sql`excluded.description`,
};
const sectorDiverged = sql`${sectors.description} IS DISTINCT FROM excluded.description`;

/**
 * Moves a tenant's sector rows onto the id derived from the catalog entry, matching on the natural
 * key rather than on any past derivation. Organizations follow through the foreign key's
 * `ON UPDATE CASCADE`, so no organization loses its sector. `IS DISTINCT FROM` makes the statement
 * a no-op once every row is aligned.
 */
const realignSectorIds = async (
  db: DrizzleDB,
  tenantId: string,
  rows: Array<typeof sectors.$inferInsert>,
): Promise<void> => {
  const pairs = rows.map((row) => sql`(${row.name}::text, ${row.id}::uuid)`);
  await db.execute(sql`
    UPDATE ${sectors} AS s SET id = v.new_id
    FROM (VALUES ${sql.join(pairs, sql`, `)}) AS v(name, new_id)
    WHERE s.tenant_id = ${tenantId}::uuid
      AND s.name = v.name
      AND s.id IS DISTINCT FROM v.new_id
  `);
};

export const seedSectors: SeedFunction = async (db) => {
  const allTenants = await db.select({ id: tenants.id }).from(tenants);
  if (allTenants.length === 0) {
    return;
  }

  for (const tenant of allTenants) {
    const sectorRows = buildSectorRows(tenant.id);
    await realignSectorIds(db, tenant.id, sectorRows);
    await db.insert(sectors).values(sectorRows)
      .onConflictDoUpdate({ target: sectors.id, set: sectorUpdate, setWhere: sectorDiverged });
  }
};

registerSeed(seedSectors);
