/* eslint-disable no-console */
import { eq, inArray, sql } from 'drizzle-orm';
import type { DrizzleDB, Transaction } from '../db';
import type { SeedDefaultThreatsLoad } from './engine-inputs';
import type { EngineReading, LargeEstateOptions, PlatformSeedPhase, PlatformSeedState, XtmOneSeedAccounts, XtmOneSeedDirectory } from './platform-seed-registry';
import { allServiceDefinitions } from '../modules';
import { createServices } from '../registry';
import { budgetReviews } from '../modules/budget-reviews/schema';
import { users } from '../modules/users/schema';
import { BudgetReview_AcmeCorpRunningPeriod } from './data/ids';
import { adminUser, seedUsers } from './data/users';
import { recomputeEngineInputs } from './engine-inputs';
import { getPlatformSeeds, PLATFORM_SEED_PHASES } from './platform-seed-registry';
import { readEngineReadings } from './seeders/crq-simulations-seeder';
import './seeders';

export interface RunPlatformSeedOptions {
  adminEmail: string,
  adminPassword: string,
  largeEstate?: LargeEstateOptions | null,
  xtmOneAccounts?: XtmOneSeedAccounts | null,
  /** The platform's load of the Default Threats dataset, run before the anchors are priced; none in tests. */
  loadDefaultThreats?: SeedDefaultThreatsLoad | null,
}

const seedPhase = async (
  tx: Transaction,
  phase: PlatformSeedPhase,
  options: RunPlatformSeedOptions,
  now: Date,
  engineReadings: ReadonlyMap<string, EngineReading> | null,
) => {
  const state: PlatformSeedState = {
    adminEmail: options.adminEmail,
    adminPassword: options.adminPassword,
    adminUserId: '',
  };
  const services = createServices([...allServiceDefinitions], tx);
  for (const seed of getPlatformSeeds(phase)) {
    console.log(`[platform-seed]   Seeding ${seed.name}...`);
    await seed.fn({ db: tx, services, state, largeEstate: options.largeEstate ?? null, xtmOneAccounts: options.xtmOneAccounts ?? null, now, engineReadings });
  }
};

/**
 * Every seeder in order, the estate phase then the history phase, inside `tx`, each dating its rows
 * from `now`. The engine cannot price inside one transaction, so the history's anchor runs are
 * invented whole here: `runPlatformSeed` is the path that anchors them on the engine.
 */
export const seedPlatformAt = async (tx: Transaction, options: RunPlatformSeedOptions, now: Date) => {
  for (const phase of PLATFORM_SEED_PHASES) {
    await seedPhase(tx, phase, options, now, null);
  }
};

/** The transaction's own clock, which every `defaultNow()` column of the seed reads too, rounded up to the millisecond a Date holds. */
const transactionClock = async (tx: Transaction): Promise<Date> => {
  const { rows: [{ ms }] } = await tx.execute<{ ms: string }>(sql`select ceil(extract(epoch from now()) * 1000)::bigint as ms`);
  return new Date(Number(ms));
};

/**
 * The history phase on a committed estate: the engine prices each simulated scenario on the pool,
 * then the history is seeded in its own transaction, its anchors standing on those prices.
 */
const seedHistory = async (db: DrizzleDB, options: RunPlatformSeedOptions, now: Date | null) => {
  const services = createServices([...allServiceDefinitions], db);
  console.log('[platform-seed]   Recomputing what the engine reads on the seeded estate...');
  await recomputeEngineInputs(services, now ?? new Date(), options.loadDefaultThreats ?? null);
  console.log('[platform-seed]   Pricing the simulated scenarios on the seeded estate...');
  const engineReadings = await readEngineReadings(db, services);
  await db.transaction(async (tx) => {
    await seedPhase(tx, 'history', options, now ?? await transactionClock(tx), engineReadings);
  });
};

export const runPlatformSeed = async (db: DrizzleDB, options: RunPlatformSeedOptions) => {
  const { adminEmail, adminPassword } = options;
  if (!adminEmail || !adminPassword) {
    throw new Error('[platform-seed] adminEmail and adminPassword are required');
  }

  // A platform with any user, even one XTM One signed in, is no longer a fresh one. One whose estate
  // the seed committed and whose history it did not (the second transaction failed) gets the history
  // alone: the seeded administrator is there, the running budget review the history writes is not.
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) {
    const [seededAdmin] = await db.select({ id: users.id }).from(users).where(eq(users.id, adminUser.id));
    const [history] = await db.select({ id: budgetReviews.id }).from(budgetReviews).where(eq(budgetReviews.id, BudgetReview_AcmeCorpRunningPeriod));
    if (seededAdmin === undefined || history !== undefined) {
      console.log('[platform-seed] The platform already has users — skipping platform seed.');
      return;
    }
    console.log('[platform-seed] The seeded estate has no history — seeding it...');
    await seedHistory(db, options, null);
    console.log('[platform-seed] Platform seed completed.');
    return;
  }

  console.log('[platform-seed] Running platform seed...');

  // A row the seed dates must not come out older than one Postgres dated, such as a run after the
  // estimate it drew, so both phases date from the estate transaction's clock.
  let now: Date | null = null;
  await db.transaction(async (tx) => {
    now = await transactionClock(tx);
    await seedPhase(tx, 'estate', options, now, null);
  });
  await seedHistory(db, options, now);

  console.log('[platform-seed] Platform seed completed.');
};

/**
 * Ties the seeded users of an already-seeded database to the stack's XTM One: one bound to no XTM One
 * user, or to one this XTM One does not hold (a database seeded before the stack ran one, or restored
 * from another stack's), is found or created there by its email, with the seed's password. The seed
 * skips a database that has users, so without this they could not sign in. Returns how many it rebound.
 */
export const reconcilePlatformSeedUsers = async (
  db: DrizzleDB,
  { adminPassword, xtmOne }: { adminPassword: string, xtmOne: XtmOneSeedDirectory },
): Promise<number> => {
  const seeded = new Map<string, { name: string, role: 'admin' | 'user' }>([
    [adminUser.id, { name: adminUser.name, role: 'admin' }],
    ...seedUsers.map(({ id, name }): [string, { name: string, role: 'user' }] => [id, { name, role: 'user' }]),
  ]);
  const rows = await db.select({ id: users.id, email: users.email, xtmSubject: users.xtmSubject })
    .from(users)
    .where(inArray(users.id, [...seeded.keys()]));
  if (rows.length === 0) {
    return 0;
  }
  const known = await xtmOne.knownIds();
  let rebound = 0;
  for (const row of rows) {
    const seed = seeded.get(row.id);
    if (!seed || (row.xtmSubject && known.has(row.xtmSubject))) {
      continue;
    }
    const xtmSubject = await xtmOne.provision({ email: row.email, fullName: seed.name, password: adminPassword, role: seed.role });
    await db.update(users).set({ xtmSubject }).where(eq(users.id, row.id));
    rebound += 1;
  }
  return rebound;
};
