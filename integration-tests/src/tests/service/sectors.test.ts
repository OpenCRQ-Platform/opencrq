import type { EventOrigin } from '@app/module';
import { buildSectorRows, sectors as sectorsTable, seedSectors } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Sectors Service', () => {
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

  it('should provision the full OpenCTI sector set, scoped to the tenant', async () => {
    const sectors = await services.withOrigin(adminOrigin).sectors.getSectors();
    expect(sectors.length).toBe(buildSectorRows(tenantId).length);
    for (const sector of sectors) {
      expect(sector.tenantId).toBe(tenantId);
      expect(sector.name).toBeTruthy();
    }
  });

  it('should return a sector by id', async () => {
    const sectors = await services.withOrigin(adminOrigin).sectors.getSectors();
    const first = sectors[0];

    const sector = sectors.find((s) => s.id === first.id);
    expect(sector).toBeTruthy();
    expect(sector!.id).toBe(first.id);
    expect(sector!.name).toBe(first.name);
  });

  it('should return undefined for non-existent sector', async () => {
    const sectors = await services.withOrigin(adminOrigin).sectors.getSectors();
    const sector = sectors.find((s) => s.id === '00000000-0000-0000-0000-000000000000');
    expect(sector).toBeUndefined();
  });

  it('should realign a sector row minted under a past derivation, without dropping the organizations that point at it', async () => {
    const organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Test Organization' }]);

    const list = await services.withOrigin(adminOrigin).sectors.getSectors();
    const first = list[0];
    await services.withOrigin(adminOrigin).organizations.updateOrganization(organizationId, { sectorId: first.id });

    // Stand in for a row provisioned before the catalog carried its own UUID: same natural key,
    // an id no derivation would produce today.
    await db.update(sectorsTable).set({ id: uuidv7() }).where(eq(sectorsTable.id, first.id));

    await seedSectors(db);

    const after = await services.withOrigin(adminOrigin).sectors.getSectors();
    expect(after.length).toBe(list.length);
    expect(after.find((s) => s.name === first.name)!.id).toBe(first.id);

    const organizations = await services.withOrigin(adminOrigin).organizations.getOrganizations();
    expect(organizations.find((o) => o.id === organizationId)!.sectorId).toBe(first.id);
  });

  describe('tenant isolation', () => {
    let tenantBOrigin: EventOrigin;
    let tenantBId: string;

    beforeEach(async () => {
      tenantBId = await createTenant(services, adminUserId);
      tenantBOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
    });

    it('should scope sectors per tenant with non-overlapping ids', async () => {
      const tenantASectors = await services.withOrigin(adminOrigin).sectors.getSectors();
      const tenantBSectors = await services.withOrigin(tenantBOrigin).sectors.getSectors();
      expect(tenantASectors.length).toBe(tenantBSectors.length);

      const tenantAIds = new Set(tenantASectors.map((s) => s.id));
      expect(tenantBSectors.some((s) => tenantAIds.has(s.id))).toBe(false);
      for (const sector of tenantBSectors) {
        expect(sector.tenantId).toBe(tenantBId);
      }
    });
  });
});
