import type { EventOrigin } from '@app/module';
import { jobSchedules, tenants } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);
const KIND = 'drata-sync';
const HOURLY = { cadence: 'hourly', atMinute: null, weekday: null, timeZone: null } as const;
const NOW_MS = Date.parse('2026-10-02T14:20:00Z');

describe('job schedules service', () => {
  let tenantId: string;
  let otherTenantId: string;
  let adminOrigin: EventOrigin;
  let otherOrigin: EventOrigin;

  beforeEach(async () => {
    await truncateAllTables(db);
    const admin = await createTenantWithAdmin(services);
    tenantId = admin.tenantId;
    adminOrigin = admin.origin;
    otherTenantId = await createTenant(services, admin.userId);
    otherOrigin = { type: 'client', userId: admin.userId, tenantId: otherTenantId };
  });

  it('should replace a saved schedule rather than add a second one for the kind', async () => {
    await services.withOrigin(adminOrigin).jobSchedules.saveSchedule(tenantId, KIND, HOURLY, NOW_MS);
    await services.withOrigin(adminOrigin).jobSchedules.saveSchedule(tenantId, KIND, { cadence: 'daily', atMinute: 90, weekday: null, timeZone: 'Europe/Paris' }, NOW_MS);

    const rows = await services.withOrigin(adminOrigin).jobSchedules.getSchedules(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cadence: 'daily', atMinute: 90, timeZone: 'Europe/Paris', nextRunAt: new Date('2026-10-02T23:30:00Z') });
  });

  it('should never let a default replace a schedule somebody saved', async () => {
    await services.withOrigin(adminOrigin).jobSchedules.saveSchedule(tenantId, KIND, HOURLY, NOW_MS);
    await services.withOrigin({ type: 'system' }).jobSchedules.ensureSchedule(tenantId, KIND, { cadence: 'daily', atMinute: 0, weekday: null, timeZone: 'UTC' }, NOW_MS);

    expect(await services.withOrigin(adminOrigin).jobSchedules.getSchedule(tenantId, KIND)).toMatchObject({ cadence: 'hourly' });
  });

  it('should refuse a schedule missing the fields its cadence takes', async () => {
    await expect(services.withOrigin(adminOrigin).jobSchedules.saveSchedule(tenantId, KIND, { cadence: 'weekly', atMinute: 60, weekday: null, timeZone: 'UTC' }, NOW_MS))
      .rejects.toThrow('Malformed schedule');
  });

  it('should void a claim read before the schedule was saved again, even on the same next run', async () => {
    const system = services.withOrigin({ type: 'system' }).jobSchedules;
    await services.withOrigin(adminOrigin).jobSchedules.saveSchedule(tenantId, KIND, { cadence: 'daily', atMinute: 18 * 60, weekday: null, timeZone: 'UTC' }, NOW_MS);
    const seen = await system.getSchedule(tenantId, KIND);
    await services.withOrigin(adminOrigin).jobSchedules.saveSchedule(tenantId, KIND, { cadence: 'every_6_hours', atMinute: null, weekday: null, timeZone: null }, NOW_MS);

    expect(seen?.nextRunAt?.toISOString()).toBe('2026-10-02T18:00:00.000Z');
    expect(await system.claimOccurrence(seen!, Date.parse('2026-10-02T18:00:30Z'))).toBeNull();
    expect(await system.getSchedule(tenantId, KIND)).toMatchObject({ cadence: 'every_6_hours', nextRunAt: new Date('2026-10-02T18:00:00Z') });
  });

  describe('tenant cascade', () => {
    it('should drop the schedules with their tenant', async () => {
      // A bare tenant row: the factory tenant owns groups, whose FK has no cascade and blocks the delete.
      const bareTenantId = uuidv7();
      await db.insert(tenants).values({ id: bareTenantId, name: 'Cascade probe' });
      await services.withOrigin({ type: 'system' }).jobSchedules.saveSchedule(bareTenantId, KIND, HOURLY, NOW_MS);
      await db.delete(tenants).where(eq(tenants.id, bareTenantId));

      expect(await db.select().from(jobSchedules).where(eq(jobSchedules.tenantId, bareTenantId))).toHaveLength(0);
    });
  });

  describe('tenant isolation', () => {
    it('should not read another tenant\'s schedule', async () => {
      await services.withOrigin(otherOrigin).jobSchedules.saveSchedule(otherTenantId, KIND, HOURLY, NOW_MS);
      const member = await createTenantUser(services, db, adminOrigin);

      expect(await services.withOrigin(member.origin).jobSchedules.getSchedule(otherTenantId, KIND)).toBeNull();
      expect(await services.withOrigin(member.origin).jobSchedules.getSchedules(otherTenantId)).toHaveLength(0);
    });

    it('should not write a schedule into another tenant', async () => {
      const member = await createTenantUser(services, db, adminOrigin);

      await expect(services.withOrigin(member.origin).jobSchedules.saveSchedule(otherTenantId, KIND, HOURLY, NOW_MS)).rejects.toThrow();
      expect(await services.withOrigin(otherOrigin).jobSchedules.getSchedule(otherTenantId, KIND)).toBeNull();
    });
  });
});
