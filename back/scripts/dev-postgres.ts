/* eslint-disable no-console */
/**
 * Shared helpers for the local-dev scripts that act on the PostgreSQL instance
 * the backend talks to.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, '..', 'config');

export const LOCAL_CONFIG_PATH = resolve(CONFIG_DIR, 'development.local.json');
export const DEV_CONFIG_PATH = resolve(CONFIG_DIR, 'development.json');

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dev utility scripts reading config files with dynamic shapes
export const readJson = (path: string): Record<string, any> => (existsSync(path)
  ? JSON.parse(readFileSync(path, 'utf-8'))
  : {});

export interface DevPostgresConfig {
  host: string,
  port: number,
  user: string,
  password: string,
  database: string,
}

/**
 * The connection the backend itself would open, `development.local.json` overriding
 * `development.json` key by key, which is what nconf does at runtime.
 */
export const resolvePostgresConfig = (): DevPostgresConfig => {
  const devCfg = readJson(DEV_CONFIG_PATH).postgres ?? {};
  const localCfg = readJson(LOCAL_CONFIG_PATH).postgres ?? {};
  const pgCfg = { ...devCfg, ...localCfg };
  return {
    host: pgCfg.host ?? 'localhost',
    port: Number(pgCfg.port ?? 5432),
    user: pgCfg.user ?? 'app',
    password: pgCfg.password ?? 'admin',
    database: pgCfg.database ?? 'app',
  };
};

/**
 * Drops and recreates the dev database. Open connections are terminated first, so
 * the backend does not have to be stopped for the DROP to be granted.
 */
export const dropAndRecreateDatabase = async (cfg: DevPostgresConfig): Promise<void> => {
  const adminPool = new pg.Pool({ ...cfg, database: 'postgres' });
  try {
    await adminPool.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()
    `, [cfg.database]);
    await adminPool.query(`DROP DATABASE IF EXISTS "${cfg.database}"`);
    await adminPool.query(`CREATE DATABASE "${cfg.database}"`);
    console.log(`✓ Dropped and recreated database "${cfg.database}" on ${cfg.host}:${cfg.port}`);
  } finally {
    await adminPool.end();
  }
};
