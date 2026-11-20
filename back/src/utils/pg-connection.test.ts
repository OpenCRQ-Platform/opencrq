import { describe, expect, it, vi } from 'vitest';

let currentConfig: Record<string, unknown>;

vi.mock('../config', () => ({
  config: () => currentConfig,
}));

describe('buildPgConnectionConfig', () => {
  it('defaults max to DB_DEFAULT_POOL_MAX when postgres.pool_max is absent', async () => {
    currentConfig = {
      postgres: {
        host: 'localhost',
        port: 5432,
        user: 'user',
        password: 'password',
        database: 'db',
      },
    };
    const { buildPgConnectionConfig, DB_DEFAULT_POOL_MAX } = await import('./pg-connection');
    expect(buildPgConnectionConfig().max).toBe(DB_DEFAULT_POOL_MAX);
  });

  it('uses postgres.pool_max when provided', async () => {
    currentConfig = {
      postgres: {
        host: 'localhost',
        port: 5432,
        user: 'user',
        password: 'password',
        database: 'db',
        pool_max: 42,
      },
    };
    const { buildPgConnectionConfig } = await import('./pg-connection');
    expect(buildPgConnectionConfig().max).toBe(42);
  });

  it('throws when postgres config is missing', async () => {
    currentConfig = {};
    const { buildPgConnectionConfig } = await import('./pg-connection');
    expect(() => buildPgConnectionConfig()).toThrow('Missing postgres config');
  });
});
