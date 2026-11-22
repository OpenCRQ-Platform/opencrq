import type { EventOrigin } from '@app/module';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Attack Surfaces Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
  });

  describe('auto-creation on tenant creation', () => {
    it('should auto-create one attack surface per asset category', async () => {
      const surfaces = await services.withOrigin(adminOrigin).attackSurfaces.getAttackSurfaces();
      expect(surfaces.length).toBe(13);
      expect(new Set(surfaces.map((s) => s.categoryId)).size).toBe(13);
    });
  });

  describe('no declared volume survives', () => {
    it('should hold no column a computation could read a declared volume, range or exposure from', async () => {
      const result = await db.execute(sql`
        SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND (c.table_name = 'attack_surface_exposures'
            OR (c.table_name = 'attack_surfaces'
              AND c.column_name IN ('note', 'exposure', 'volume_min', 'volume_max')))
      `);
      expect(result.rows).toEqual([]);
    });
  });

  describe('tenant isolation', () => {
    let tenantBOrigin: EventOrigin;

    beforeEach(async () => {
      const tenantBId = await createTenant(services, adminUserId);
      tenantBOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
    });

    it('should not list attack surfaces from another tenant', async () => {
      const tenantASurfaces = await services.withOrigin(adminOrigin).attackSurfaces.getAttackSurfaces();
      const tenantBSurfaces = await services.withOrigin(tenantBOrigin).attackSurfaces.getAttackSurfaces();

      const tenantAIds = new Set(tenantASurfaces.map((s) => s.id));
      const tenantBIds = new Set(tenantBSurfaces.map((s) => s.id));

      for (const id of tenantAIds) {
        expect(tenantBIds.has(id)).toBe(false);
      }
    });

    it('should give each tenant its own thirteen surfaces', async () => {
      const tenantBSurfaces = await services.withOrigin(tenantBOrigin).attackSurfaces.getAttackSurfaces();
      expect(tenantBSurfaces.length).toBe(13);
      expect(new Set(tenantBSurfaces.map((s) => s.tenantId)).size).toBe(1);
    });
  });
});
