import { sql } from 'drizzle-orm';
import type { SeedFunction } from '../../../seed-registry';
import { registerSeed } from '../../../seed-registry';
import { capabilities } from '../schema';
import { CAPABILITIES } from './capabilities-data';

// `setWhere` only writes rows that actually diverged, avoiding a rewrite of every row on each boot.
const capabilityUpdate = { name: sql`excluded.name` };
const capabilityDiverged = sql`${capabilities.name} IS DISTINCT FROM excluded.name`;

/** Reprovisions the tenant capability catalog. Capabilities are global, not tenant-scoped. */
export const seedCapabilities: SeedFunction = async (db) => {
  await db.insert(capabilities).values([...CAPABILITIES])
    .onConflictDoUpdate({ target: capabilities.id, set: capabilityUpdate, setWhere: capabilityDiverged });
};

registerSeed(seedCapabilities);
