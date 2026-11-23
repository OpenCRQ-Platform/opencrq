import type { EventOrigin } from '@app/module';
import { primaryAssets, supportingAssets, treatmentPlans } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const OUTSIDE_TENANT = 'The owner is not a member of this tenant';

describe('Entity owner membership', () => {
  let adminOrigin: EventOrigin;
  let organizationId: string;
  let memberId: string;
  let outsiderId: string;

  const scoped = () => services.withOrigin(adminOrigin);

  const entities = [
    {
      name: 'primary asset',
      create: async (ownerId: string | null) => {
        const id = uuidv7();
        await scoped().primaryAssets.createPrimaryAsset({ id, organizationId, name: 'Customer records', description: null, ownerId, businessValueCategoryIds: [] });
        return id;
      },
      update: async (id: string, ownerId: string | null) => scoped().primaryAssets.updatePrimaryAsset(id, { ownerId }),
      ownerOf: async (id: string) => (await scoped().primaryAssets.getPrimaryAsset(id))?.ownerId,
      table: primaryAssets,
    },
    {
      name: 'supporting asset',
      create: async (ownerId: string | null) => {
        const id = uuidv7();
        await scoped().supportingAssets.createSupportingAsset({ id, name: 'billing-db', description: null, ownerId, exposure: 'unknown', categoryId: 'host' });
        return id;
      },
      update: async (id: string, ownerId: string | null) => {
        await scoped().supportingAssets.updateSupportingAsset(id, { ownerId });
      },
      ownerOf: async (id: string) => (await scoped().supportingAssets.getSupportingAsset(id))?.ownerId,
      table: supportingAssets,
    },
    {
      name: 'treatment plan',
      create: async (ownerId: string | null) => scoped().treatmentPlans.createTreatmentPlan({ organizationId, name: 'Q3 hardening', ownerId }),
      update: async (id: string, ownerId: string | null) => scoped().treatmentPlans.updateTreatmentPlan(id, { ownerId }),
      ownerOf: async (id: string) => (await scoped().treatmentPlans.getTreatmentPlan(id))?.ownerId,
      table: treatmentPlans,
    },
  ];

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    organizationId = uuidv7();
    await scoped().organizations.createOrganizations([{ id: organizationId, name: 'Payment platform' }]);
    memberId = (await createTenantUser(services, db, adminOrigin)).userId;
    outsiderId = (await createTenantWithAdmin(services)).userId;
  });

  describe.each(entities)('$name', (entity) => {
    it('should refuse a member of another tenant as owner on creation, and write nothing', async () => {
      await expect(entity.create(outsiderId)).rejects.toThrow(OUTSIDE_TENANT);

      expect(await db.$count(entity.table)).toBe(0);
    });

    it('should refuse a member of another tenant as owner on update, and keep the owner on file', async () => {
      const id = await entity.create(memberId);

      await expect(entity.update(id, outsiderId)).rejects.toThrow(OUTSIDE_TENANT);

      expect(await entity.ownerOf(id)).toBe(memberId);
    });

    it('should accept a member of the tenant as owner, and clear it with null', async () => {
      const id = await entity.create(null);

      await entity.update(id, memberId);
      expect(await entity.ownerOf(id)).toBe(memberId);

      await entity.update(id, null);
      expect(await entity.ownerOf(id)).toBeNull();
    });
  });
});
