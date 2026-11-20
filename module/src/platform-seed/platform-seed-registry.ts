import type { DrizzleDB, Transaction } from '../db';
import type { createServices } from '../registry';
import type { allServiceDefinitions } from '../modules';

export type PlatformSeedServices = ReturnType<typeof createServices<typeof allServiceDefinitions>>;

/**
 * Sizes rather than a flag, because the profile is seeded at a reduced size in tests and at its
 * full size on a developer's machine. `null` when it is off.
 */
export interface LargeEstateOptions {
  assets: number,
  findings: number,
  mappedAssets: number,
}

/** A seeded user as XTM One holds it, the seeded password included. */
export interface XtmOneSeedAccount {
  email: string,
  fullName: string,
  password: string,
  role: 'admin' | 'user',
}

/**
 * Creates the account in XTM One, or finds the one already holding its email, and returns its XTM
 * One id, which becomes the OpenCRQ account's `xtm_subject`.
 */
export type XtmOneSeedAccounts = (account: XtmOneSeedAccount) => Promise<string>;

/** What reconciling an already-seeded database needs of XTM One: the ids it holds, and the seed's own provisioning. */
export interface XtmOneSeedDirectory {
  provision: XtmOneSeedAccounts,
  knownIds: () => Promise<ReadonlySet<string>>,
}

export interface PlatformSeedState {
  adminEmail: string,
  adminPassword: string,
  adminUserId: string,
}

/** What the attack run engine's own price of a scenario reads, for the seeded history to end on. */
export interface EngineReading {
  vulnerabilityMean: number,
  outcomeEvicted: number,
  outcomeImpactDetected: number,
}

export interface SeedContext {
  db: DrizzleDB | Transaction,
  services: PlatformSeedServices,
  state: PlatformSeedState,
  largeEstate: LargeEstateOptions | null,
  /** `null` seeds accounts tied to no XTM One user, which cannot sign in. */
  xtmOneAccounts: XtmOneSeedAccounts | null,
  /**
   * The one instant every seeder dates from. The dates two seeders derive from it must agree, and
   * the CRQ seeder weighs the seeded threats' activity at it, so a clock read per seeder would move
   * the figures with the seconds the seed took.
   */
  now: Date,
  /**
   * The engine's price of each simulated scenario on the committed estate, by scenario id, which the
   * history's anchor runs stand on. `null` where the seed could not price on the pool (a seed run in
   * one caller's transaction): the anchors are then invented whole.
   */
  engineReadings: ReadonlyMap<string, EngineReading> | null,
}

type PlatformSeedFunction = (ctx: SeedContext) => Promise<void>;

/**
 * `estate` seeds what the attack run engine prices; `history` seeds what is read off its runs (the
 * backdated runs, the plans and budget reviews priced on them), so it runs after the estate.
 */
export const PLATFORM_SEED_PHASES = ['estate', 'history'] as const;
export type PlatformSeedPhase = typeof PLATFORM_SEED_PHASES[number];

interface PlatformSeed {
  name: string,
  fn: PlatformSeedFunction,
  phase: PlatformSeedPhase,
}

const platformSeeds: Array<PlatformSeed> = [];

export const registerPlatformSeed = (name: string, fn: PlatformSeedFunction, phase: PlatformSeedPhase = 'estate') => {
  platformSeeds.push({ name, fn, phase });
};

/** In registration order, which is the import order of `./seeders`. */
export const getPlatformSeeds = (phase: PlatformSeedPhase) => platformSeeds.filter((seed) => seed.phase === phase);
