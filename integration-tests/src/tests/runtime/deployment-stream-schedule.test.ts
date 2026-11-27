import type { EventOrigin } from '@app/module';
import { jobs as jobsTable } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DeploymentStreamScheduleDeps } from '../../../../back/src/features/deployment-integrations/deployment-stream-schedule';
import { deploymentServiceAccountId, openctiDeploymentStreamKey } from '../../../../back/src/features/deployment-integrations/deployment-integrations';
import { DEPLOYMENT_STREAM_RETRY_MS, runDeploymentStreamSchedule } from '../../../../back/src/features/deployment-integrations/deployment-stream-schedule';
import { createSchedulerTick, schedulerServices } from '../../../../back/src/features/job-scheduler/scheduler-tick';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };
const KIND = 'opencti-deployment-stream';

const system = () => services.withOrigin(SYSTEM_ORIGIN);

const listJobs = (tenantId: string) => db.select().from(jobsTable).where(eq(jobsTable.tenantId, tenantId));

describe('deployment OpenCTI stream schedule against the queue', () => {
  let tenantId: string;
  let adminOrigin: EventOrigin;
  let nowMs: number;
  let provided: boolean;
  let deps: DeploymentStreamScheduleDeps;

  const tick = () => runDeploymentStreamSchedule(tenantId, deps);

  const bindDeploymentStream = async () => {
    const account = deploymentServiceAccountId(tenantId, 'opencti');
    await system().serviceAccounts.provisionServiceAccount({ id: account, tenantId, name: 'OpenCTI (deployment)', description: 'The deployment account.' });
    await system().openctiConnector.configureDeploymentStream(tenantId, account, 'managed-stream');
  };

  const finishTheJob = async (finishedAt: Date) => {
    await db.update(jobsTable).set({ status: 'dlq', finishedAt }).where(eq(jobsTable.tenantId, tenantId));
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const admin = await createTenantWithAdmin(services);
    tenantId = admin.tenantId;
    adminOrigin = admin.origin;
    nowMs = Date.parse('2026-11-26T12:00:00Z');
    provided = true;
    deps = {
      connection: () => (provided ? { url: 'https://opencti.example', token: 'tok' } : undefined),
      getSettings: (forTenantId) => system().openctiConnector.getSettings(forTenantId),
      jobs: system().jobs,
      now: () => nowMs,
    };
  });

  it('queues one provisioning for a tenant that is not connected, under the deployment key, and no second one at once', async () => {
    expect(await tick()).toEqual({ outcome: 'enqueued' });
    expect(await tick()).toEqual({ outcome: 'skipped' });

    const rows = await listJobs(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: KIND,
      triggeredBy: 'scheduler',
      interactive: false,
      maxAttempts: 1,
      idempotencyKey: openctiDeploymentStreamKey(tenantId),
    });
  });

  it('waits out the retry period after a run, then asks again', async () => {
    await tick();
    await finishTheJob(new Date(nowMs - 1000));

    expect(await tick()).toEqual({ outcome: 'skipped' });
    expect(await listJobs(tenantId)).toHaveLength(1);

    nowMs += DEPLOYMENT_STREAM_RETRY_MS;
    expect(await tick()).toEqual({ outcome: 'enqueued' });
    expect(await listJobs(tenantId)).toHaveLength(2);
  });

  it('leaves a tenant bound to the deployment stream alone while it works', async () => {
    await bindDeploymentStream();

    expect(await tick()).toEqual({ outcome: 'skipped' });
    expect(await listJobs(tenantId)).toHaveLength(0);
  });

  it('asks again once the deployment stream stopped authenticating', async () => {
    await bindDeploymentStream();
    await system().openctiConnector.markAuthFailed(tenantId);

    expect(await tick()).toEqual({ outcome: 'enqueued' });
    expect(await listJobs(tenantId)).toHaveLength(1);
  });

  it('never asks for a tenant an admin configured, whatever the stream does', async () => {
    const accountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: accountId, name: 'Admin Bot' });
    await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, accountId, 'admin-stream');
    await system().openctiConnector.markAuthFailed(tenantId);

    expect(await tick()).toEqual({ outcome: 'skipped' });
    expect(await listJobs(tenantId)).toHaveLength(0);
  });

  it('never asks for a tenant an admin configured on the deployment account Configure preselects', async () => {
    await bindDeploymentStream();
    await services.withOrigin(adminOrigin).openctiConnector.configure(tenantId, deploymentServiceAccountId(tenantId, 'opencti'), 'admin-stream');
    await system().openctiConnector.markAuthFailed(tenantId);

    expect(await tick()).toEqual({ outcome: 'skipped' });
    expect(await listJobs(tenantId)).toHaveLength(0);
  });

  it('does nothing for a tenant the deployment provides no connection', async () => {
    provided = false;

    expect(await tick()).toEqual({ outcome: 'skipped' });
    expect(await listJobs(tenantId)).toHaveLength(0);
  });
});

describe('the job scheduler tick', () => {
  let tenantId: string;

  // A tick also books the tenant's other schedules: only the provisioning is asserted on.
  const provisioningJobs = async () => (await listJobs(tenantId)).filter((row) => row.kind === KIND);

  const schedulerTick = (connectors: Parameters<typeof createSchedulerTick>[0]['connectors']) => createSchedulerTick({
    services: schedulerServices(db),
    connectors,
    dailyKinds: [],
    dailyAtMinutes: 180,
    now: () => Date.parse('2026-11-26T12:00:00Z'),
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    tenantId = (await createTenantWithAdmin(services)).tenantId;
  });

  it('asks for the provisioning of a tenant the deployment provides an OpenCTI for and that is not connected', async () => {
    await schedulerTick({ opencti: { [tenantId]: { url: 'https://opencti.example', token: 'tok' } } })();

    const rows = await provisioningJobs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ triggeredBy: 'scheduler', idempotencyKey: openctiDeploymentStreamKey(tenantId) });
  });

  it('asks nothing for a tenant the deployment provides no OpenCTI for', async () => {
    await schedulerTick({})();

    expect(await provisioningJobs()).toHaveLength(0);
  });
});
