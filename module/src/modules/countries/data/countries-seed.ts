import type { DrizzleDB } from '../../../db';
import type { SeedFunction } from '../../../seed-registry';
import { newError } from '@app/utils';
import { sql } from 'drizzle-orm';
import { deriveSeedId } from '../../../seed-ids';
import { registerSeed } from '../../../seed-registry';
import { tenants } from '../../tenants/schema';
import { countries } from '../schema';
import { countriesData } from './countries-data';

const catalogIdByIso = new Map(countriesData.map((c) => [c.isoAlpha3, c.id]));

/** The catalog UUID of a country, resolved by its ISO alpha-3 code. Throws on an unknown code. */
export const countryCatalogId = (isoAlpha3: string): string => {
  const catalogId = catalogIdByIso.get(isoAlpha3);
  if (!catalogId) {
    throw newError('Unknown country ISO alpha-3 code', { isoAlpha3 });
  }
  return catalogId;
};

export const buildCountryRows = (tenantId: string): Array<typeof countries.$inferInsert> =>
  countriesData.map((c) => ({
    id: deriveSeedId(tenantId, c.id),
    tenantId,
    name: c.name,
    isoAlpha2: c.isoAlpha2,
    isoAlpha3: c.isoAlpha3,
  }));

const CHUNK_SIZE = 1000;

// `setWhere` only writes rows that actually diverged, avoiding a rewrite of every row on each boot.
const countryUpdate = {
  name: sql`excluded.name`,
  isoAlpha2: sql`excluded.iso_alpha_2`,
};
const countryDiverged = sql`${countries.name} IS DISTINCT FROM excluded.name
  OR ${countries.isoAlpha2} IS DISTINCT FROM excluded.iso_alpha_2`;

/**
 * Moves a tenant's country rows onto the id derived from the catalog entry, matching on the natural
 * key rather than on any past derivation. Organizations follow through the foreign key's
 * `ON UPDATE CASCADE`, so no organization loses its country. `IS DISTINCT FROM` makes the statement
 * a no-op once every row is aligned.
 */
const realignCountryIds = async (
  db: DrizzleDB,
  tenantId: string,
  rows: Array<typeof countries.$inferInsert>,
): Promise<void> => {
  const pairs = rows.map((row) => sql`(${row.isoAlpha3}::text, ${row.id}::uuid)`);
  await db.execute(sql`
    UPDATE ${countries} AS c SET id = v.new_id
    FROM (VALUES ${sql.join(pairs, sql`, `)}) AS v(iso_alpha_3, new_id)
    WHERE c.tenant_id = ${tenantId}::uuid
      AND c.iso_alpha_3 = v.iso_alpha_3
      AND c.id IS DISTINCT FROM v.new_id
  `);
};

export const seedCountries: SeedFunction = async (db) => {
  const allTenants = await db.select({ id: tenants.id }).from(tenants);
  if (allTenants.length === 0) {
    return;
  }

  for (const tenant of allTenants) {
    const countryRows = buildCountryRows(tenant.id);
    await realignCountryIds(db, tenant.id, countryRows);
    for (let i = 0; i < countryRows.length; i += CHUNK_SIZE) {
      await db.insert(countries).values(countryRows.slice(i, i + CHUNK_SIZE))
        .onConflictDoUpdate({ target: countries.id, set: countryUpdate, setWhere: countryDiverged });
    }
  }
};

registerSeed(seedCountries);
