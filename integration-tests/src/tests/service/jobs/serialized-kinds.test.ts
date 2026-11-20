import type { EventOrigin } from '@app/module';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../../helpers/factories';
import { db } from '../../../setup/db';
import { createTestServices, truncateAllTables } from '../../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

const expireLease = async (jobId: string) => {
  await db.execute(sql`
    UPDATE jobs SET leased_until = now() - interval '1 second' WHERE id = ${jobId}
  `);
};

describe('jobs serialized kinds', () => {
  let tenantId: string;
  let otherTenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
    // A second tenant under the same admin: only one initial admin account may exist.
    otherTenantId = await createTenant(services, setup.userId);
  });

  const enqueue = (kind: string, tenant: string, payload: Record<string, unknown>) =>
    services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({ kind, tenantId: tenant, payload });

  const claim = (worker: string, serialized: ReadonlyArray<string> = []) =>
    services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext(worker, ['noop'], 30_000, serialized);

  it('leaves a second job of a serialized kind queued while its sibling runs', async () => {
    // Distinct payloads, so the dedup index admits both: this is the shape that used to let two
    // runs of one observed kind overlap for a tenant.
    await enqueue('noop', tenantId, { mode: 'full' });
    await enqueue('noop', tenantId, { mode: 'backfill' });

    const first = await claim('w1', ['noop']);
    expect(first).toBeDefined();

    expect(await claim('w2', ['noop'])).toBeUndefined();
  });

  it('claims both when the kind is not serialized', async () => {
    await enqueue('noop', tenantId, { mode: 'full' });
    await enqueue('noop', tenantId, { mode: 'backfill' });

    expect(await claim('w1')).toBeDefined();
    expect(await claim('w2')).toBeDefined();
  });

  it('serializes per tenant, not across tenants', async () => {
    await enqueue('noop', tenantId, { mode: 'full' });
    await enqueue('noop', otherTenantId, { mode: 'full' });

    const first = await claim('w1', ['noop']);
    const second = await claim('w2', ['noop']);

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second!.tenantId).not.toBe(first!.tenantId);
  });

  it('admits the queued sibling once the running one finishes', async () => {
    await enqueue('noop', tenantId, { mode: 'full' });
    await enqueue('noop', tenantId, { mode: 'backfill' });

    const first = await claim('w1', ['noop']);
    expect(await claim('w2', ['noop'])).toBeUndefined();

    await services.withOrigin(SYSTEM_ORIGIN).jobs.recordSuccess(first!.id, 'w1');

    expect(await claim('w2', ['noop'])).toBeDefined();
  });

  it('admits the queued sibling once the running one\'s lease has expired, without waiting on the reaper', async () => {
    await enqueue('noop', tenantId, { mode: 'full' });
    await enqueue('noop', tenantId, { mode: 'backfill' });

    const first = await claim('w1', ['noop']);
    expect(await claim('w2', ['noop'])).toBeUndefined();

    await expireLease(first!.id);

    expect(await claim('w2', ['noop'])).toBeDefined();
  });

  it('claims both when two different kinds are queued at once', async () => {
    await enqueue('noop', tenantId, { mode: 'full' });
    await enqueue('other-noop', tenantId, { mode: 'full' });

    const claimAny = (worker: string) =>
      services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext(worker, ['noop', 'other-noop'], 30_000, ['noop', 'other-noop']);

    const first = await claimAny('w1');
    const second = await claimAny('w2');

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect([first!.kind, second!.kind].sort()).toEqual(['noop', 'other-noop']);
  });

  describe('two kinds sharing one slot', () => {
    const kinds = ['noop', 'other-noop'];
    const claimShared = (worker: string) =>
      services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext(worker, kinds, 30_000, kinds, [], [kinds]);

    it('leaves either kind queued while the other runs for the tenant, in both directions', async () => {
      await enqueue('noop', tenantId, { mode: 'full' });
      await enqueue('other-noop', tenantId, { mode: 'full' });

      const first = await claimShared('w1');
      expect(first).toBeDefined();
      expect(await claimShared('w2')).toBeUndefined();

      await services.withOrigin(SYSTEM_ORIGIN).jobs.recordSuccess(first!.id, 'w1');

      const second = await claimShared('w2');
      expect(second?.kind).toBe(kinds.find((kind) => kind !== first!.kind));
    });

    it('still runs the two kinds side by side for two tenants', async () => {
      await enqueue('noop', tenantId, { mode: 'full' });
      await enqueue('other-noop', otherTenantId, { mode: 'full' });

      expect(await claimShared('w1')).toBeDefined();
      expect(await claimShared('w2')).toBeDefined();
    });
  });
});
