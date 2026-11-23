import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenantUser } from '../../helpers/factories';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { testConnectorsConfig } from '../../setup/mock';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';
const HOUR_MS = 60 * 60 * 1000;

describe('connector run inventory now (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let adminId: string;
  let adminOrigin: EventOrigin;

  const settings = () => services.withOrigin(adminOrigin).integrationSettings;
  const getConnector = async () => (await client.query('connectors.getConnector', { source: 'openaev' }, { tenantId })).json.result.data;

  beforeEach(async () => {
    await truncateAllTables(db);
    client = createTrpcTestClient(await getTestServer());
    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId }).tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
    adminOrigin = { type: 'client', userId: adminId, tenantId };

    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'OpenAEV Bot' });
    await settings().configureIntegration('openaev', serviceAccountId);
    testConnectorsConfig.openaev = { [tenantId]: { url: 'https://openaev.example', token: 't' } };
    await settings().markSynced('openaev', new Date(Date.now() - 2 * HOUR_MS));
  });

  afterEach(() => {
    delete testConnectorsConfig.openaev;
  });

  it('shows the last inventory, and the next one a day after it', async () => {
    const { inventory, scopeKinds } = await getConnector();

    expect(scopeKinds).toEqual(['supporting_assets', 'findings']);
    expect(inventory.requestedAt).toBeNull();
    expect(Date.parse(inventory.nextDueAt) - Date.parse(inventory.lastCompletedAt)).toBe(24 * HOUR_MS);
  });

  it('books the inventory and one run under the asker, and owes the inventory to the next run', async () => {
    const res = await client.mutation('connectors.runInventoryNow', { source: 'openaev' }, { tenantId });
    const run = await services.withOrigin({ type: 'system' }).jobs.getJob(res.json.result.data.jobId);
    const { inventory } = await getConnector();

    expect(res.status).toBe(200);
    expect(run).toMatchObject({ status: 'queued', kind: 'openaev-findings-sync', triggeredBy: 'user', triggeredById: adminId });
    expect(inventory.requestedAt).not.toBeNull();
    expect(inventory.nextDueAt).toBeNull();
  });

  it('folds a second ask into the run already queued instead of starting one beside it', async () => {
    const first = await client.mutation('connectors.runInventoryNow', { source: 'openaev' }, { tenantId });
    const second = await client.mutation('connectors.runInventoryNow', { source: 'openaev' }, { tenantId });

    expect(second.json.result.data.jobId).toBe(first.json.result.data.jobId);
    const active = await services.withOrigin(adminOrigin).jobs.getActiveRunCounts(tenantId, ['openaev-findings-sync']);
    expect(active.queued + active.running).toBe(1);
  });

  it('keeps an ask booked after the inventory started, and clears one booked before it', async () => {
    const started = new Date();
    await settings().requestInventory('openaev', new Date(started.getTime() + 1000));
    await settings().clearInventoryRequest('openaev', started);
    expect((await settings().getIntegrationSettings('openaev'))?.inventoryRequestedAt).not.toBeNull();

    await settings().clearInventoryRequest('openaev', new Date(started.getTime() + 2000));
    expect((await settings().getIntegrationSettings('openaev'))?.inventoryRequestedAt).toBeNull();
  });

  it('refuses a tenant member who cannot manage security, and books nothing', async () => {
    const member = await createTenantUser(services, db, adminOrigin);
    const memberClient = createTrpcTestClient(await getTestServer());
    await signInAs(memberClient, member.userId);

    const refused = await memberClient.mutation('connectors.runInventoryNow', { source: 'openaev' }, { tenantId });

    expect(refused.status).toBe(403);
    expect((await settings().getIntegrationSettings('openaev'))?.inventoryRequestedAt).toBeNull();
    const active = await services.withOrigin(adminOrigin).jobs.getActiveRunCounts(tenantId, ['openaev-findings-sync']);
    expect(active.queued + active.running).toBe(0);
  });

  it('refuses a connector that runs no inventory', async () => {
    const refused = await client.mutation('connectors.runInventoryNow', { source: 'drata' }, { tenantId });

    expect(refused.status).toBe(400);
  });
});
