import type { EventOrigin } from '@app/module';
import { integrationSettings, supportingAssets } from '@app/module';
import { createJobContext } from '@app/back/src/engines/job-runtime/job-context-factory';
import { openaevSyncHandler } from '@app/back/src/features/openaev-sync/openaev-sync-handler';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeOpenaev } from '../../helpers/fake-openaev';
import { createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { startFakeOpenaev } from '../../helpers/fake-openaev';
import { testConnectorsConfig } from '../../setup/mock';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

// The handler builds its services on the backend's own db engine, which reads the connection from
// `config()`: this file's mock must therefore carry the worker database next to the connectors that
// `setup/mock.ts` otherwise serves.
vi.mock('../../../../back/src/config', async () => {
  const { getWorkerDbName, pgConfig } = await import('../../setup/pg-config');
  const { testConnectorsConfig: connectors } = await import('../../setup/mock');
  return {
    config: () => ({ postgres: { ...pgConfig, database: getWorkerDbName() }, connectors }),
    pmConfig: {},
    getProcessName: () => 'test',
  };
});

const services = createTestServices(db);

const OAEV_TENANT = 'oaev-main';
const TLP_RED = 'marking-definition--5e57c739-391a-4eb3-b6be-7d15ca92d5ed';
const MARKING_ON = { status: 200, body: { enabled_dev_features: ['MARKING'] } };
const DAY_MS = 86_400_000;

/**
 * The assets a sync writes follow OpenAEV's markings only while OpenAEV says it enforces them, and
 * an OpenAEV that fails to say so must not read as "markings off": the run fails and the assets stay
 * marked, hidden from a member with no clearance.
 */
describe('OpenAEV marking feature read during the sync, against a fake OpenAEV', () => {
  let tenantId: string;
  let serviceAccountId: string;
  let connectorId: string;
  let memberOrigin: EventOrigin;
  let fake: FakeOpenaev;

  const runSync = async (): Promise<void> => {
    const ctx = createJobContext({
      jobId: uuidv7(),
      tenantId,
      kind: 'openaev-findings-sync',
      interactive: false,
      payload: {},
      attempt: 1,
      state: null,
      signal: new AbortController().signal,
      deps: {
        updateProgress: () => Promise.resolve(),
        saveStateSnapshot: () => Promise.resolve(),
      },
      runDb: db,
    });
    await openaevSyncHandler({ ...ctx, payload: { serviceAccountId }, state: null });
  };

  /** Makes the inventory, which reads the marking feature, due again without waiting a day. */
  const makeInventoryDue = () =>
    db.update(integrationSettings).set({ lastReportedAt: new Date(Date.now() - 2 * DAY_MS) }).where(eq(integrationSettings.id, connectorId));

  const assetIdOf = async (): Promise<string> => {
    const [asset] = await db.select({ id: supportingAssets.id }).from(supportingAssets);
    return asset.id;
  };

  const markingRefsOfAsset = async (): Promise<Array<string> | null> =>
    (await db.select({ markingRefs: supportingAssets.markingRefs }).from(supportingAssets))[0].markingRefs;

  const memberSeesAsset = async (): Promise<boolean> =>
    (await services.withOrigin(memberOrigin).supportingAssets.getSupportingAsset(await assetIdOf())) !== null;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
    memberOrigin = (await createTenantUser(services, db, setup.origin)).origin;

    serviceAccountId = uuidv7();
    await services.withOrigin(setup.origin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'OpenAEV bot' });
    await services.withOrigin(setup.origin).integrationSettings.configureIntegration('openaev', serviceAccountId);
    connectorId = (await services.withOrigin(setup.origin).integrationSettings.getConnectorId('openaev'))!;

    fake = await startFakeOpenaev();
    const main = fake.addTenant(OAEV_TENANT, 'Main');
    main.setMarkingDefinitions([{ id: 'oa-red', type: 'TLP', definition: 'TLP:RED', order: 5, stixId: TLP_RED }]);
    main.setEndpoints([{ id: 'ep-1', name: 'server-1', hostname: 'server-1.test', markings: ['oa-red'] }]);
    fake.setPublicSettings(MARKING_ON);
    testConnectorsConfig['openaev'] = { [tenantId]: { url: fake.url, token: fake.token } };
  });

  afterEach(async () => {
    delete testConnectorsConfig['openaev'];
    await fake.close();
  });

  it('should sync a marked asset with its marking, hidden from a member with no clearance', async () => {
    await runSync();

    expect(await markingRefsOfAsset()).toEqual([TLP_RED]);
    expect(await memberSeesAsset()).toBe(false);
  });

  it('should fail the run and leave the asset marked when OpenAEV cannot say whether it enforces markings', async () => {
    await runSync();
    await makeInventoryDue();
    fake.setPublicSettings({ status: 500, body: { message: 'boom' } });

    await expect(runSync()).rejects.toThrow('OpenAEV error (500)');

    expect(await markingRefsOfAsset()).toEqual([TLP_RED]);
    expect(await memberSeesAsset()).toBe(false);
  });

  it('should sync the asset unmarked when OpenAEV states its marking feature is off', async () => {
    await runSync();
    await makeInventoryDue();
    fake.setPublicSettings({ status: 200, body: { enabled_dev_features: [] } });

    await runSync();

    expect(await markingRefsOfAsset()).toEqual([]);
    expect(await memberSeesAsset()).toBe(true);
  });
});
