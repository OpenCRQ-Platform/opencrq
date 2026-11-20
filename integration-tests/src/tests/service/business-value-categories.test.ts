import type { EventOrigin } from '@app/module';
import {
  BUSINESS_VALUE_CATEGORIES,
  businessValueCategories as businessValueCategoriesTable,
  BusinessValueCategory_PhysicalAssetsAndFacilities,
  deriveSeedId,
  seedBusinessValueCategories,
} from '@app/module';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

/**
 * Business resources are a flat closed catalog provisioned with the tenant, so there is no write
 * endpoint to exercise. The identifier stays `business-value category`.
 */
describe('Business Value Categories Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
  });

  it('should provision the ten catalog resources with the tenant', async () => {
    const categories = await services.withOrigin(adminOrigin).businessValueCategories.getBusinessValueCategories();

    expect(categories).toHaveLength(10);
    // Every row id is derived from its catalog entry rather than minted.
    expect(categories.map((category) => category.id)).toEqual(
      BUSINESS_VALUE_CATEGORIES.map((category) => deriveSeedId(tenantId, category.id)),
    );
    expect(categories.map((category) => category.code)).toEqual(BUSINESS_VALUE_CATEGORIES.map((category) => category.code));
    expect(categories.map((category) => category.name)).toEqual(BUSINESS_VALUE_CATEGORIES.map((category) => category.name));
    for (const category of categories) {
      expect(category.tenantId).toBe(tenantId);
      expect(category.description).toBeTruthy();
    }
  });

  it('should return the catalog ordered by display order', async () => {
    const categories = await services.withOrigin(adminOrigin).businessValueCategories.getBusinessValueCategories();

    const displayOrders = categories.map((category) => category.displayOrder);
    expect(displayOrders).toEqual(displayOrders.toSorted((left, right) => left - right));
    expect(new Set(displayOrders).size).toBe(10);
  });

  it('should get a single business value category by id', async () => {
    const id = deriveSeedId(tenantId, BusinessValueCategory_PhysicalAssetsAndFacilities);

    const category = await services.withOrigin(adminOrigin).businessValueCategories.getBusinessValueCategory(id);

    expect(category).toBeTruthy();
    expect(category!.id).toBe(id);
    expect(category!.name).toBe('Physical assets and facilities');
    expect(category!.code).toBe('physical-assets-and-facilities');
  });

  it('should return undefined for a non-existent category', async () => {
    const category = await services.withOrigin(adminOrigin).businessValueCategories
      .getBusinessValueCategory('00000000-0000-0000-0000-000000000000');

    expect(category).toBeUndefined();
  });

  it('should expose no write endpoint', () => {
    const api: object = services.withOrigin(adminOrigin).businessValueCategories;

    // The catalog is seeded: a tenant that could author it would drift away from the reference model.
    // The service registry throws on unknown members rather than returning undefined.
    for (const method of ['createBusinessValueCategory', 'updateBusinessValueCategory', 'deleteBusinessValueCategories']) {
      expect(() => Reflect.get(api, method)).toThrow('Unable to find method');
    }
  });

  it('should isolate the catalog per tenant', async () => {
    const otherTenantId = await createTenant(services, adminUserId);
    const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

    const mine = await services.withOrigin(adminOrigin).businessValueCategories.getBusinessValueCategories();
    const theirs = await services.withOrigin(otherOrigin).businessValueCategories.getBusinessValueCategories();

    expect(theirs).toHaveLength(10);
    expect(theirs.every((category) => category.tenantId === otherTenantId)).toBe(true);
    expect(mine.map((category) => category.id).some((id) => theirs.map((category) => category.id).includes(id))).toBe(false);

    const crossTenant = await services.withOrigin(adminOrigin).businessValueCategories.getBusinessValueCategory(theirs.at(0)!.id);
    expect(crossTenant).toBeUndefined();
  });
});

/** xmin is the row version: it only moves when Postgres actually rewrites the row. */
const categoryVersions = async (tenantId: string): Promise<Map<string, string>> => {
  const result = await db.execute(
    sql`SELECT id::text AS id, xmin::text AS v FROM business_value_categories WHERE tenant_id = ${tenantId}`,
  );
  return new Map(result.rows.map((row) => [String(row.id), String(row.v)]));
};

/** The module owns its catalog end to end: the boot seeder reprovisions it, nothing else does. */
describe('Business Value Categories re-seed', () => {
  let adminUserId: string;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
  });

  it('should rewrite nothing when the catalog has not moved', async () => {
    const before = await categoryVersions(tenantId);
    expect(before.size).toBe(10);

    await seedBusinessValueCategories(db);
    await seedBusinessValueCategories(db);

    // Two reboots on an unchanged reference: an upsert that rewrote every row on each boot would
    // churn the whole catalog and, worse, hide a real divergence in the noise.
    expect(await categoryVersions(tenantId)).toEqual(before);
  });

  it('should rewrite only the row that diverged in the database', async () => {
    const targetId = deriveSeedId(tenantId, BusinessValueCategory_PhysicalAssetsAndFacilities);
    const catalogName = BUSINESS_VALUE_CATEGORIES
      .find((category) => category.id === BusinessValueCategory_PhysicalAssetsAndFacilities)!.name;

    await db.update(businessValueCategoriesTable).set({ name: 'Locally edited category' })
      .where(eq(businessValueCategoriesTable.id, targetId));
    const before = await categoryVersions(tenantId);

    await seedBusinessValueCategories(db);

    const after = await categoryVersions(tenantId);
    expect(after.get(targetId)).not.toBe(before.get(targetId));
    for (const [id, version] of before) {
      if (id !== targetId) {
        expect(after.get(id)).toBe(version);
      }
    }

    const restored = await db.select().from(businessValueCategoriesTable)
      .where(eq(businessValueCategoriesTable.id, targetId));
    expect(restored[0].name).toBe(catalogName);
  });

  it('should prune a row the catalog does not curate without reaching another tenant', async () => {
    const otherTenantId = await createTenant(services, adminUserId);
    const strayId = uuidv7();
    await db.insert(businessValueCategoriesTable)
      .values({ id: strayId, tenantId, code: 'hand-inserted', name: 'Hand-inserted category', description: null, displayOrder: 99 });
    const otherBefore = await categoryVersions(otherTenantId);

    await seedBusinessValueCategories(db);

    const survivors = await db.select().from(businessValueCategoriesTable)
      .where(eq(businessValueCategoriesTable.tenantId, tenantId));
    expect(survivors).toHaveLength(10);
    expect(survivors.some((row) => row.id === strayId)).toBe(false);
    expect(await categoryVersions(otherTenantId)).toEqual(otherBefore);
  });
});
