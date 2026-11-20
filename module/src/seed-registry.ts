import type { DrizzleDB } from './db';

export type SeedFunction = (db: DrizzleDB) => Promise<void>;

const seeds: Array<SeedFunction> = [];

export const registerSeed = (seed: SeedFunction) => {
  seeds.push(seed);
};

export const getSeeds = () => seeds;
