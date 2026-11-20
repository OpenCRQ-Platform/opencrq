import nconf from 'nconf';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const BASE_DB_NAME = process.env['PGDATABASE'] || 'app_test';

export const TEST_DB_TEMPLATE = `${BASE_DB_NAME}_template`;

export const TEST_DB_WORKER_PREFIX = `${BASE_DB_NAME}_w`;

export const getWorkerDbName = (): string => {
  const poolId = process.env['VITEST_POOL_ID'] ?? '1';
  return `${TEST_DB_WORKER_PREFIX}${poolId}`;
};

const backendConfigDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../back/config');
const resolveConfigFile = (file: string) => resolve(backendConfigDir, `${file}.json`);

const provider = new nconf.Provider();

// Mirror the backend's nconf loading order (development.local overrides development)
provider.file('development.local', resolveConfigFile('development.local'));
provider.file('development', resolveConfigFile('development'));

const postgresSchema = z.object({
  host: z.string().default('localhost'),
  port: z.coerce.number().default(5432),
  user: z.string().default('app'),
  password: z.string().default('admin'),
});

const filePostgres = z.record(z.string(), z.unknown()).default({}).parse(provider.get('postgres'));

// Env vars win over the config files (CI has no back/config/development.local.json), merged
// per-field before validation so a bad file value can't block a valid env override.
const postgres = postgresSchema.parse({
  host: process.env['PGHOST'] || filePostgres['host'],
  port: process.env['PGPORT'] || filePostgres['port'],
  user: process.env['PGUSER'] || filePostgres['user'],
  password: process.env['PGPASSWORD'] || filePostgres['password'],
});

export const pgConfig = {
  host: postgres.host,
  port: postgres.port,
  user: postgres.user,
  password: postgres.password,
  // Test databases are disposable, so the WAL fsync per commit is pure cost: the suite commits
  // thousands of tiny writes. Session-level GUC, forwarded by node-postgres as a libpq option.
  options: '-c synchronous_commit=off',
};
