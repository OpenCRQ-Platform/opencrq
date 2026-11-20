import { sql } from 'drizzle-orm';
import type { SeedFunction } from '../../../seed-registry';
import { registerSeed } from '../../../seed-registry';
import { platformCapabilities } from '../schema';
import { PLATFORM_CAPABILITIES } from './platform-capabilities-data';

// `setWhere` only writes rows that actually diverged, avoiding a rewrite of every row on each boot.
const capabilityUpdate = { name: sql`excluded.name` };
const capabilityDiverged = sql`${platformCapabilities.name} IS DISTINCT FROM excluded.name`;

/** Reprovisions the platform capability catalog. Platform capabilities are not tenant-scoped. */
export const seedPlatformCapabilities: SeedFunction = async (db) => {
  await db.insert(platformCapabilities).values([...PLATFORM_CAPABILITIES])
    .onConflictDoUpdate({ target: platformCapabilities.id, set: capabilityUpdate, setWhere: capabilityDiverged });
};

registerSeed(seedPlatformCapabilities);
