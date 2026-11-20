import { config } from '../config';

export const DB_CONNECT_TIMEOUT_MS = 5_000;
export const DB_DEFAULT_POOL_MAX = 20;

/**
 * The job runtime's own bookkeeping pool: claiming, renewing a lease, recording an outcome. Small
 * because those statements are single-row and short, and separate because a lease renewal queueing
 * behind the handlers' own reads is how a healthy run loses its job to another worker.
 */
export const DB_CONTROL_POOL_MAX = 5;

export const buildPgConnectionConfig = () => {
  const cfg = config().postgres;
  if (!cfg) {
    throw new Error('Missing postgres config');
  }
  return {
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
    max: cfg.pool_max ?? DB_DEFAULT_POOL_MAX,
  };
};

export const buildPgControlConnectionConfig = () => ({ ...buildPgConnectionConfig(), max: DB_CONTROL_POOL_MAX });
