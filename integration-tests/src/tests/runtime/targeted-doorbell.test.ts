import type { DoorbellTargets } from '@app/back/src/features/events/query-dependency-index';
import type { EventOrigin } from '@app/module';
import { createDataChangedHub } from '@app/back/src/features/events/data-changed-hub';
import { startDataChangedListener } from '@app/back/src/features/events/data-changed-listener';
import { createDoorbellCascade } from '@app/back/src/features/events/doorbell-cascade';
import { createDoorbellResolver } from '@app/back/src/features/events/doorbell-resolver';
import { installQueryDependencyIndex, QueryDependencyIndex } from '@app/back/src/features/events/query-dependency-index';
import { authServiceRouter } from '@app/back/src/features/auth-service/auth-service-router';
import { editionRouter } from '@app/back/src/features/edition/edition-router';
import { protectedProcedure, publicProcedure, router, trpcInstance } from '@app/back/src/trpc';
import { authService, createServices, loadDoorbellParents, notificationsService, schema, tenantsService } from '@app/module';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db, pool } from '../../setup/db';
import { getWorkerDbName, pgConfig } from '../../setup/pg-config';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

// The listener connects through the backend's own config, which the shared setup stubs out.
vi.mock('../../../../back/src/config', () => ({
  config: () => ({ postgres: { ...pgConfig, database: getWorkerDbName() } }),
  pmConfig: {},
  getProcessName: () => 'test',
}));

const WINDOW_MS = 50;

const settle = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const waitFor = async (predicate: () => boolean, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await settle(25);
  }
};

const index = new QueryDependencyIndex({ explain: async (sqlText) => (await pool.query(sqlText)).rows });
// The wiring the events feature installs: the index is the logger of the instance the procedures read through.
const observedDb = drizzle(pool, { schema, logger: index });
const services = createTestServices(observedDb);

const asProcedure = <T>(procedure: string, read: () => Promise<T>) =>
  index.observe(procedure, async () => ({ ok: true, data: await read() }));

describe('a doorbell names the query procedures a write made stale', () => {
  let controller: AbortController;
  let loop: Promise<void>;
  let hub: ReturnType<typeof createDataChangedHub>;
  let doorbells: Array<DoorbellTargets>;
  let subscription: Promise<void>;
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;

    controller = new AbortController();
    hub = createDataChangedHub({ windowMs: WINDOW_MS, jobWindowMs: WINDOW_MS });
    const resolve = createDoorbellResolver(index, () => undefined);
    doorbells = [];
    const stream = hub.subscribe({ tenantIds: [tenantId], signal: controller.signal });
    subscription = (async () => {
      try {
        for await (const signal of stream) {
          doorbells.push(resolve(signal));
        }
      } catch {
        // AbortError on teardown: the normal way a subscription ends.
      }
    })();

    const cascade = createDoorbellCascade({ loadParents: () => loadDoorbellParents(db) });
    let listening = false;
    loop = startDataChangedListener({
      signal: controller.signal,
      onNotify: (change) => {
        void cascade(change).then((tables) => tables.forEach((table) => hub.publish(change.tenantId, change.origin, change.interactive, table)));
      },
      onListening: () => {
        listening = true;
      },
    });
    await waitFor(() => listening);
  });

  afterEach(async () => {
    controller.abort();
    await loop;
    await subscription;
    hub.closeAll();
  });

  it('should name the readers of the written table and spare the others', async () => {
    await asProcedure('organizations.getOrganizations', () => services.withOrigin(adminOrigin).organizations.getOrganizations());
    await asProcedure('notifications.getNotifications', () => services.withOrigin(adminOrigin).notifications.getNotifications());

    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: uuidv7(), name: 'Rings for its readers' }]);
    await waitFor(() => doorbells.length >= 1);

    expect(doorbells[0].all).toBe(false);
    expect(doorbells[0].procedures).toContain('organizations.getOrganizations');
    expect(doorbells[0].procedures).not.toContain('notifications.getNotifications');
  });

  it('should spare the procedures that declare their reads on a write they do not read, and name the readers of users on a user write', async () => {
    installQueryDependencyIndex(index);
    try {
      const authRouter = authServiceRouter({ publicProcedure, protectedProcedure }, createServices([authService, notificationsService, tenantsService], db));
      const caller = trpcInstance.mergeRouters(authRouter, router({ edition: editionRouter(protectedProcedure, db) })).createCaller(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- only the fields the auth middlewares read are needed here
        { user: { id: adminUserId, email: 'admin@example.com', name: 'Admin', title: null, xtmSubject: null }, session: { id: 'session-1', expiresAt: new Date() }, tenantId, serviceAccount: null } as never,
      );
      await caller.isLoggedIn();
      await caller.edition.getStatus();
      await index.observe('probe.attributesNothing', () => Promise.resolve({ ok: true }));

      await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: uuidv7(), name: 'Rings for no declared reader' }]);
      await waitFor(() => doorbells.length >= 1);

      expect(doorbells[0].procedures).toContain('probe.attributesNothing');
      expect(doorbells[0].procedures).not.toContain('isLoggedIn');
      expect(doorbells[0].procedures).not.toContain('edition.getStatus');

      doorbells.length = 0;
      await services.withOrigin(adminOrigin).users.updateUser(adminUserId, { locale: 'fr' });
      await waitFor(() => doorbells.some((doorbell) => doorbell.procedures.includes('isLoggedIn')));

      expect(doorbells.flatMap((doorbell) => doorbell.procedures)).not.toContain('edition.getStatus');
    } finally {
      installQueryDependencyIndex(null);
    }
  });

  it('should name a list carrying a membership count when only the junction table is written', async () => {
    const groupId = uuidv7();
    await services.withOrigin(adminOrigin).groups.createGroup({ id: groupId, name: 'Counted' });
    await waitFor(() => doorbells.length >= 1);
    doorbells.length = 0;
    await asProcedure('groups.listGroups', () => services.withOrigin(adminOrigin).groups.listGroups());
    expect(index.readsOf('groups.listGroups')).toContain('group_users');

    await services.withOrigin(adminOrigin).groups.addUserToGroup(groupId, adminUserId);
    await waitFor(() => doorbells.some((doorbell) => doorbell.procedures.includes('groups.listGroups')));
  });

  it('should name the readers of the children a deleted parent silences', async () => {
    const organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Parent to delete' }]);
    await waitFor(() => doorbells.length >= 1);
    doorbells.length = 0;

    // A reader of treatment_plans alone, whose doorbell finds its tenant through the organization.
    // Raw on purpose: the secured views of the product join the parent, so a service read would be
    // named through `organizations` directly and prove nothing about the cascade.
    await asProcedure('probe.treatmentPlans', () => observedDb.execute(sql`select count(*) from treatment_plans`));
    await asProcedure('notifications.getNotifications', () => services.withOrigin(adminOrigin).notifications.getNotifications());
    expect(index.readsOf('probe.treatmentPlans')).toEqual(['treatment_plans']);

    await services.withOrigin(adminOrigin).organizations.deleteOrganizations([organizationId]);
    await waitFor(() => doorbells.length >= 1);

    expect(doorbells[0].all).toBe(false);
    expect(doorbells[0].procedures).toContain('probe.treatmentPlans');
    expect(doorbells[0].procedures).not.toContain('notifications.getNotifications');
  });
});
