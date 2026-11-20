import { integrationSettings } from '@app/module';
import type { EventOrigin, IntegrationSource } from '@app/module';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Integration Settings Service', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let adminUserId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    adminUserId = setup.userId;
  });

  const getRows = (tid: string) =>
    db.select().from(integrationSettings).where(eq(integrationSettings.tenantId, tid));

  const getRow = (tid: string, source: IntegrationSource) =>
    db.select().from(integrationSettings).where(
      and(eq(integrationSettings.tenantId, tid), eq(integrationSettings.source, source)),
    );

  describe('markSynced', () => {
    it('should create a row when no row exists yet', async () => {
      await services.withOrigin(adminOrigin).integrationSettings.markSynced('first');

      const rows = await getRow(tenantId, 'first');
      expect(rows).toHaveLength(1);
      expect(rows[0].lastReportedAt).toBeInstanceOf(Date);
    });

    it('should set lastReportedAt on second call and produce no duplicate row', async () => {
      await services.withOrigin(adminOrigin).integrationSettings.markSynced('nist');
      await services.withOrigin(adminOrigin).integrationSettings.markSynced('nist');

      const rows = await getRow(tenantId, 'nist');
      expect(rows).toHaveLength(1);
      expect(rows[0].lastReportedAt).toBeInstanceOf(Date);
    });

    it('should write independent rows for each source', async () => {
      await services.withOrigin(adminOrigin).integrationSettings.markSynced('first');
      await services.withOrigin(adminOrigin).integrationSettings.markSynced('nist');
      await services.withOrigin(adminOrigin).integrationSettings.markSynced('cisa');

      const rows = await getRows(tenantId);
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.source).sort()).toEqual(['cisa', 'first', 'nist']);
    });

    it('should not write to another tenant', async () => {
      await services.withOrigin(adminOrigin).integrationSettings.markSynced('first');

      const tenantBId = await createTenant(services, adminUserId);
      const tenantBRows = await getRows(tenantBId);
      expect(tenantBRows).toHaveLength(0);
    });

    it('should not write rows for tenant A when origin is tenant B', async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
      await services.withOrigin(tenantBOrigin).integrationSettings.markSynced('first');

      const tenantARows = await getRows(tenantId);
      expect(tenantARows).toHaveLength(0);
    });
  });
});
