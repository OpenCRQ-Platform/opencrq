import { createServices, platformGroupsService, reconcilePlatformSeedUsers, runMigration, runPlatformSeed, schema, seed, tenantsService } from '@app/module';
import { fromError, newError, withSessionLock } from '@app/utils';
import type { Logger as StatementObserver } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { PreservedMetadata, SeedSkipReason } from './db-reset';
import type { DatabaseStatistics } from './db-table-metrics';
import { config } from '../../config';
import { seedDefaultThreatsLoad } from '../../features/default-threats/default-threats-dataset';
import { sleep } from '../../utils';
import { createLogger } from '../../utils/logger';
import { buildPgConnectionConfig, buildPgControlConnectionConfig } from '../../utils/pg-connection';
import { registerEngine } from '../engines-manager';
import { imageVersion } from '../../utils/platform-version';
import { probeConnection } from './db-connection-probe';
import { computePoolName, instrumentPoolAcquisition, recordReconnectionAttempt, registerDbPoolMetrics } from './db-metrics';
import { readDatabaseStatistics, registerDbTableMetrics } from './db-table-metrics';
import { findSeedSkipReason, resetDatabaseIfVersionChanged, restorePreservedMetadata, storeCurrentVersion, storeSeededBoot } from './db-reset';
import { ensureDefaultPlatformRolesAndGroups } from './default-platform-roles-and-groups';
import { ensureInitialTenant } from './initial-tenant';
import { xtmOneSeedDirectoryFromConfig } from './xtm-one-seed-accounts';

const DB_ENGINE_KEY = 'db';
const logger = createLogger({ engine: DB_ENGINE_KEY });
const { logTrace, logFromError, logFromFatalError } = logger;

const reconnecting = new Set<Pool>();

const postgresConfig = buildPgConnectionConfig();

const pool = new Pool(postgresConfig);
const SHARED_POOL_NAME = computePoolName(pool);
registerDbPoolMetrics(pool, SHARED_POOL_NAME);
instrumentPoolAcquisition(pool, SHARED_POOL_NAME);

/*
 * The statements that decide whether a run still owns its job never queue behind the run's own
 * reads: a lease renewal that cannot get a client within `connectionTimeoutMillis` reads as a lost
 * lease, and three of those in a row send a healthy job to the dead-letter queue. Unobserved by
 * design, so the bookkeeping of an observed run stays out of its read set.
 */
const controlPool = new Pool(buildPgControlConnectionConfig());
const CONTROL_POOL_NAME = `${computePoolName(controlPool)}#control`;
registerDbPoolMetrics(controlPool, CONTROL_POOL_NAME);
instrumentPoolAcquisition(controlPool, CONTROL_POOL_NAME);

let statementObserver: StatementObserver | null = null;
let tableMetricsRegistered = false;

const drizzleDB = drizzle(pool, { schema, logger: { logQuery: (query, params) => statementObserver?.logQuery(query, params) } });
const controlDB = drizzle(controlPool, { schema });

const waitForDatabase = async (maxRetries = 30, delayMs = 1_000) => {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await probeConnection(pool);
    } catch (e) {
      lastErr = e;
      logTrace(`Database not ready (attempt ${attempt}/${maxRetries}). Retrying in ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }
  throw fromError(lastErr, `Database not ready after ${maxRetries} attempts`);
};

const startDbEngine = async () => {
  logTrace('Starting database initialization...');
  const serverVersion = await waitForDatabase();
  logTrace('Database is ready.', { postgres: serverVersion ?? 'unknown' });

  logTrace('Acquiring database initialization lock...');
  await withSessionLock(pool, 'db_initialization', async () => {
    logTrace('Acquired database initialization lock.');

    const resetEnabled = Boolean(config().platform?.reset_on_version_change);

    let preservedMetadata: PreservedMetadata = [];
    try {
      const { preserved } = await resetDatabaseIfVersionChanged(pool, resetEnabled, logger);
      preservedMetadata = preserved;
    } catch (error) {
      logFromFatalError(error, 'Database reset failed');
    }

    try {
      logTrace('Applying migrations.');
      await runMigration(drizzleDB);
      logTrace('All migrations have been successfully applied.');
    } catch (error) {
      logFromFatalError(error, 'Migration failed');
    }

    // Restore deployment-level metadata (the instance id) wiped
    // by the reset, now that migrations have recreated the table. Runs before
    // seeding so the whole boot sequence observes the restored values.
    if (preservedMetadata.length > 0) {
      await restorePreservedMetadata(pool, preservedMetadata, logger);
    }

    let skipReason: SeedSkipReason | null = null;
    try {
      // Seed data only changes with the app version, or with the code between two starts of the
      // process manager, and both markers are stored after a complete initialization only. When
      // one matches, a reseed converges nothing and its upserts would lock rows under the jobs a
      // sibling process has already started.
      skipReason = await findSeedSkipReason(pool);
      if (skipReason === 'version') {
        logTrace('Database already seeded for this app version, skipping seeding.', { version: imageVersion() });
      } else if (skipReason === 'boot') {
        logTrace('Database already seeded by another process during this boot, skipping seeding.', { bootId: process.env.BOOT_ID });
      } else {
        logTrace('Seeding database...');
        await seed(drizzleDB);
        logTrace('Seeding completed.');
      }
    } catch (error) {
      logFromFatalError(error, 'Seeding failed');
    }

    const platformSeed = config().platform_seed;
    if (platformSeed?.enabled) {
      // A production build defines the constant `false`: there an XTM One account may be a person's.
      const development = typeof __DEVELOPMENT_BUILD__ !== 'undefined' && __DEVELOPMENT_BUILD__;
      const xtmOne = xtmOneSeedDirectoryFromConfig(config().xtm_one, platformSeed.xtm_one_admin, { resetPasswordOnReuse: development });
      logTrace('Running platform seed...');
      try {
        const largeEstate = platformSeed.large_estate;
        await runPlatformSeed(drizzleDB, {
          adminEmail: platformSeed.admin.email,
          adminPassword: platformSeed.admin.password,
          largeEstate: largeEstate.enabled
            ? { assets: largeEstate.assets, findings: largeEstate.findings, mappedAssets: largeEstate.mapped_assets }
            : null,
          xtmOneAccounts: xtmOne?.provision ?? null,
          // Loaded before the anchors are priced, else the first boot's sync moves the trend's last point (#3253).
          loadDefaultThreats: seedDefaultThreatsLoad,
        });
        logTrace('Platform seed completed.');
      } catch (error) {
        logFromError(error, 'Platform seed failed, booting without it');
      }
      // A sibling of this boot has already tied them, under this same lock.
      if (development && xtmOne && skipReason !== 'boot') {
        try {
          const rebound = await reconcilePlatformSeedUsers(drizzleDB, { adminPassword: platformSeed.admin.password, xtmOne });
          if (rebound > 0) {
            logTrace('Seeded users tied to the stack\'s XTM One.', { rebound });
          }
        } catch (error) {
          logFromError(error, 'Tying the seeded users to the stack\'s XTM One failed, booting without it');
        }
      }
    }

    // The platform seed skips on users only: a tenant created before it would sit beside the demo tenants.
    await ensureInitialTenant(
      createServices([tenantsService], drizzleDB).withOrigin({ type: 'system' }).tenants,
      config().initial_tenant,
      logger,
    );

    await ensureDefaultPlatformRolesAndGroups(
      createServices([platformGroupsService], drizzleDB).withOrigin({ type: 'system' }).platformGroups,
      logger,
    );

    await storeCurrentVersion(pool, logger);
    await storeSeededBoot(pool, logger);

    logTrace('Database initialization done.');
  }, (elapsedMs) => logTrace('Waiting for database initialization lock held by another worker...', { elapsedMs }));

  logTrace('Released database initialization lock.');

  const reconnect = async (target: Pool, name: string) => {
    if (reconnecting.has(target)) {
      return;
    }
    reconnecting.add(target);
    logTrace('Attempting to reconnect to the database...', { pool: name });

    while (true) {
      recordReconnectionAttempt(target, name);
      try {
        await probeConnection(target);

        logTrace('Database reconnection has been successfully established.', { pool: name });
        reconnecting.delete(target);
        return;
      } catch (e) {
        logFromError(e, 'Could not reconnect to the database. Retrying in 5 seconds...', { pool: name });
        await sleep(5_000);
      }
    }
  };

  /*
   * An idle client dying takes the whole process down without this: node-postgres raises `'error'`
   * on the Pool itself, and a Pool with no listener for it throws where nothing can catch it.
   */
  const watch = (target: Pool, name: string) => target.on('error', (e) => {
    logFromError(e, 'A database error occurred. The pool will attempt to reconnect.', { pool: name });
    reconnect(target, name);
  });
  watch(pool, SHARED_POOL_NAME);
  watch(controlPool, CONTROL_POOL_NAME);

  return {
    // The job runtime has drained by now, so the statements these pools serve have all landed.
    stop: async () => {
      await controlPool.end();
      await pool.end();
    },
  };
};

export const dbEngine = registerEngine({
  key: DB_ENGINE_KEY,
  start: startDbEngine,
  api: {
    db: drizzleDB,
    controlDb: controlDB,
    pool,
    checkConnection: () => reconnecting.size === 0,
    readTableStatistics: () => readDatabaseStatistics(pool),
  },
  registrationApi: {
    // Every statement the shared instance issues, transactions included, reaches the observer.
    observeStatements: (observer: StatementObserver): void => {
      if (statementObserver !== null) {
        throw newError('The shared database instance already has a statement observer');
      }
      statementObserver = observer;
    },
    // A second registration would add a second set of callbacks to the same instruments.
    registerTableMetrics: (lastReading: () => DatabaseStatistics | null): void => {
      if (tableMetricsRegistered) {
        throw newError('The database table metrics are already registered');
      }
      tableMetricsRegistered = true;
      registerDbTableMetrics(lastReading);
    },
  },
});
