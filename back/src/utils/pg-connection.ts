import type { ClientBase } from 'pg';
import type { Logger } from './logger';
import { config } from '../config';
import { imageRelease } from './platform-version';
import { applicationNameFor, assertNotFenced, ReleaseFencedError } from './release-fence';

const release = imageRelease();

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
    application_name: applicationNameFor(release),
  };
};

export const buildPgControlConnectionConfig = () => ({ ...buildPgConnectionConfig(), max: DB_CONTROL_POOL_MAX });

/**
 * Run on every new connection, before anything uses it. Once a newer release has taken over the
 * database, this process exits: every connection it opened has been terminated, and every new one
 * would be refused.
 */
export const checkReleaseOnConnect = async (client: ClientBase, logger: Pick<Logger, 'logFromFatalError'>): Promise<void> => {
  if (release === undefined) {
    return;
  }
  try {
    await assertNotFenced(client, release);
  } catch (error) {
    if (error instanceof ReleaseFencedError) {
      logger.logFromFatalError(error, 'A newer release has taken over the database, exiting', { recorded: error.recorded.version });
    }
    throw error;
  }
};
