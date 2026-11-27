import { runPlatformSeed } from '@app/module';
import { describe, expect, it, vi } from 'vitest';
import type { Engine } from '../engines-manager';
import { ensureDefaultPlatformRolesAndGroups } from './default-platform-roles-and-groups';
import { ensureInitialTenant } from './initial-tenant';

const registered = vi.hoisted(() => ({ start: null as Engine['start'] | null }));

const INITIAL_TENANT = { id: '01a043da-ff47-72c2-aaa4-7da56d85c83e', name: 'Default' };

vi.mock('pg', () => ({
  Pool: class {
    on = vi.fn();
    end = vi.fn();
  },
}));

vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: vi.fn(() => ({})) }));

vi.mock('@app/module', () => ({
  createServices: vi.fn(() => ({ withOrigin: () => ({ tenants: {}, platformGroups: {} }) })),
  platformGroupsService: {},
  reconcilePlatformSeedUsers: vi.fn(),
  runMigration: vi.fn(),
  runPlatformSeed: vi.fn(),
  schema: {},
  seed: vi.fn(),
  tenantsService: {},
}));

vi.mock('@app/utils', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  withSessionLock: async (_pool: unknown, _key: string, callback: () => Promise<unknown>) => callback(),
}));

vi.mock('../../config', () => ({
  config: () => ({
    platform_seed: {
      enabled: true,
      admin: { email: 'admin@example.com', password: 'password' },
      large_estate: { enabled: false },
    },
    initial_tenant: INITIAL_TENANT,
  }),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({ logTrace: vi.fn(), logFromError: vi.fn(), logFromFatalError: vi.fn() }),
}));

vi.mock('../../utils/pg-connection', () => ({
  buildPgConnectionConfig: () => ({}),
  buildPgControlConnectionConfig: () => ({}),
  checkReleaseOnConnect: () => Promise.resolve(),
}));

vi.mock('../engines-manager', () => ({
  registerEngine: (engine: Engine & { api?: object }) => {
    registered.start = engine.start;
    return { ...engine.api };
  },
}));

vi.mock('./db-connection-probe', () => ({ probeConnection: vi.fn().mockResolvedValue('17') }));

vi.mock('./db-metrics', () => ({
  computePoolName: () => 'pool',
  instrumentPoolAcquisition: vi.fn(),
  recordReconnectionAttempt: vi.fn(),
  registerDbPoolMetrics: vi.fn(),
}));

vi.mock('./db-reset', () => ({
  findSeedSkipReason: vi.fn().mockResolvedValue(null),
  resetDatabaseIfVersionChanged: vi.fn().mockResolvedValue({ preserved: [] }),
  restorePreservedMetadata: vi.fn(),
  storeCurrentVersion: vi.fn(),
  storeSeededBoot: vi.fn(),
}));

vi.mock('./default-platform-roles-and-groups', () => ({ ensureDefaultPlatformRolesAndGroups: vi.fn() }));

vi.mock('./initial-tenant', () => ({ ensureInitialTenant: vi.fn() }));

vi.mock('./xtm-one-seed-accounts', () => ({ xtmOneSeedDirectoryFromConfig: () => null }));

await import('./db-engine');

describe('startDbEngine', () => {
  it('creates the initial tenant, then the default platform roles and groups, after the platform seed', async () => {
    await registered.start?.(new AbortController().signal);

    expect(runPlatformSeed).toHaveBeenCalledTimes(1);
    expect(ensureInitialTenant).toHaveBeenCalledTimes(1);
    expect(ensureInitialTenant).toHaveBeenCalledWith(expect.anything(), INITIAL_TENANT, expect.anything());
    expect(vi.mocked(runPlatformSeed).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(ensureInitialTenant).mock.invocationCallOrder[0] ?? 0);
    expect(ensureDefaultPlatformRolesAndGroups).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ensureInitialTenant).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(ensureDefaultPlatformRolesAndGroups).mock.invocationCallOrder[0] ?? 0);
  });
});
