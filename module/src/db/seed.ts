import type { DrizzleDB } from './index';
import { getSeeds } from '../seed-registry';
import '../modules';

export const seed = async (db: DrizzleDB) => {
  const seeds = getSeeds();
  for (const seedFn of seeds) {
    await seedFn(db);
  }
};
