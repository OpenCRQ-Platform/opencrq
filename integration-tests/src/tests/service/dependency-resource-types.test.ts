import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventOrigin } from '@app/module';
import { DEFAULT_DEPENDENCY_RESOURCE_TYPES, dependencyResourceTypes, primaryToPrimaryLinks, tenants } from '@app/module';
import { eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const ENGLISH_NAMES = DEFAULT_DEPENDENCY_RESOURCE_TYPES.map((names) => names.en);
const FRENCH_NAMES = DEFAULT_DEPENDENCY_RESOURCE_TYPES.map((names) => names.fr);

const sortedNames = (names: ReadonlyArray<string>) => names.toSorted((first, second) => first.localeCompare(second, 'en'));

/** The statement of the migration that pre-filled the tenants existing when the table was created. */
const migrationFillStatement = (): string => {
  const folder = join(dirname(fileURLToPath(import.meta.url)), '../../../../module/src/db/migrations');
  const statements = readdirSync(folder)
    .filter((file) => file.endsWith('.sql'))
    .flatMap((file) => readFileSync(join(folder, file), 'utf8').split('--> statement-breakpoint'))
    .filter((statement) => statement.includes('INSERT INTO "dependency_resource_types"'));
  expect(statements).toHaveLength(1);
  return statements[0];
};

describe('Dependency resource types', () => {
  let origin: EventOrigin;
  let tenantId: string;
  let userId: string;
  let organizationId: string;
  let billingId: string;
  let ordersId: string;

  const typesOf = (caller: EventOrigin) => services.withOrigin(caller).assetDependencies.listDependencyResourceTypes();
  const typeNamed = async (name: string, caller: EventOrigin = origin) => {
    const type = (await typesOf(caller)).find((candidate) => candidate.name === name);
    if (type === undefined) {
      throw new Error(`no type ${name}`);
    }
    return type.id;
  };
  const linksOf = (primaryAssetId: string) => services.withOrigin(origin).assetDependencies.getPrimaryToPrimaryLinks(primaryAssetId);
  const otherTenantOrigin = async (): Promise<EventOrigin> => ({ type: 'client', userId, tenantId: await createTenant(services, userId) });

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    origin = setup.origin;
    tenantId = setup.tenantId;
    userId = setup.userId;
    organizationId = uuidv7();
    await services.withOrigin(origin).organizations.createOrganizations([{ id: organizationId, name: 'Test Org' }]);
    billingId = uuidv7();
    ordersId = uuidv7();
    for (const [id, name] of [[billingId, 'Billing'], [ordersId, 'Order management']]) {
      await services.withOrigin(origin).primaryAssets.createPrimaryAsset({
        id, organizationId, name, description: null, ownerId: null, businessValueCategoryIds: [],
      });
    }
  });

  describe('pre-fill', () => {
    it('should give a new tenant the eight ISO 22301 categories, sorted by name', async () => {
      const types = await typesOf(origin);

      expect(types.map((type) => type.name)).toEqual(sortedNames(ENGLISH_NAMES));
      expect(types.every((type) => type.linkCount === 0)).toBe(true);
    });

    it('should fill an existing tenant in its default language, and leave a tenant already filled as it is', async () => {
      const frenchTenantId = await createTenant(services, userId);
      const englishTenantId = await createTenant(services, userId);
      await db.delete(dependencyResourceTypes).where(inArray(dependencyResourceTypes.tenantId, [frenchTenantId, englishTenantId]));
      await db.update(tenants).set({ defaultLocale: 'fr' }).where(eq(tenants.id, frenchTenantId));
      const renamed = await typeNamed('IT');
      await services.withOrigin(origin).assetDependencies.renameDependencyResourceType(renamed, 'Information systems');

      await db.execute(sql.raw(migrationFillStatement()));

      const frenchTypes = await typesOf({ type: 'client', userId, tenantId: frenchTenantId });
      expect(sortedNames(frenchTypes.map((type) => type.name))).toEqual(sortedNames(FRENCH_NAMES));
      const englishTypes = await typesOf({ type: 'client', userId, tenantId: englishTenantId });
      expect(englishTypes.map((type) => type.name)).toEqual(sortedNames(ENGLISH_NAMES));
      expect((await typesOf(origin)).map((type) => type.name))
        .toEqual(sortedNames(ENGLISH_NAMES.map((name) => (name === 'IT' ? 'Information systems' : name))));
    });
  });

  describe('CRUD', () => {
    it('should add, rename and delete a type', async () => {
      const id = uuidv7();
      await services.withOrigin(origin).assetDependencies.createDependencyResourceType({ id, name: '  Cloud provider ' });
      expect((await typesOf(origin)).find((type) => type.id === id)?.name).toBe('Cloud provider');

      await services.withOrigin(origin).assetDependencies.renameDependencyResourceType(id, 'Hosting');
      expect((await typesOf(origin)).find((type) => type.id === id)?.name).toBe('Hosting');

      await services.withOrigin(origin).assetDependencies.deleteDependencyResourceType(id);
      expect((await typesOf(origin)).some((type) => type.id === id)).toBe(false);
    });

    it('should refuse a name another type holds, case and accents aside', async () => {
      await expect(services.withOrigin(origin).assetDependencies.createDependencyResourceType({ id: uuidv7(), name: 'supplier' }))
        .rejects.toThrow('This dependency resource type name is already taken');
      await expect(services.withOrigin(origin).assetDependencies.renameDependencyResourceType(await typeNamed('Finance'), 'Prémises'))
        .rejects.toThrow('This dependency resource type name is already taken');
    });

    it('should refuse to rename or delete a type that is gone', async () => {
      await expect(services.withOrigin(origin).assetDependencies.renameDependencyResourceType(uuidv7(), 'Hosting'))
        .rejects.toThrow('Dependency resource type not found');
      await expect(services.withOrigin(origin).assetDependencies.deleteDependencyResourceType(uuidv7()))
        .rejects.toThrow('Dependency resource type not found');
    });

    it('should leave the links of a deleted type in place, with no type', async () => {
      const supplierId = await typeNamed('Supplier');
      const linkId = uuidv7();
      await services.withOrigin(origin).assetDependencies.createPrimaryToPrimaryLinks([{
        id: linkId, dependentAssetId: billingId, providerAssetId: ordersId, strength: 'critical', dependencyResourceTypeId: supplierId,
      }]);
      expect((await typesOf(origin)).find((type) => type.id === supplierId)?.linkCount).toBe(1);

      await services.withOrigin(origin).assetDependencies.deleteDependencyResourceType(supplierId);

      expect(await linksOf(billingId)).toEqual([{
        id: linkId,
        direction: 'depends',
        relatedAssetId: ordersId,
        relatedAssetName: 'Order management',
        strength: 'critical',
        dependencyResourceTypeId: null,
        dependencyResourceTypeName: null,
      }]);
    });
  });

  describe('links', () => {
    it('should create a link with a type and read it, with its name, from both ends', async () => {
      const itId = await typeNamed('IT');
      const linkId = uuidv7();
      await services.withOrigin(origin).assetDependencies.createPrimaryToPrimaryLinks([{
        id: linkId, dependentAssetId: billingId, providerAssetId: ordersId, dependencyResourceTypeId: itId,
      }]);

      expect((await linksOf(billingId)).map(({ dependencyResourceTypeId, dependencyResourceTypeName }) => ({ dependencyResourceTypeId, dependencyResourceTypeName })))
        .toEqual([{ dependencyResourceTypeId: itId, dependencyResourceTypeName: 'IT' }]);
      expect((await linksOf(ordersId))[0]?.dependencyResourceTypeName).toBe('IT');
    });

    it('should change the type alone, the strength alone, and clear the type', async () => {
      const itId = await typeNamed('IT');
      const supplierId = await typeNamed('Supplier');
      const linkId = uuidv7();
      await services.withOrigin(origin).assetDependencies.createPrimaryToPrimaryLinks([{
        id: linkId, dependentAssetId: billingId, providerAssetId: ordersId, strength: 'minor', dependencyResourceTypeId: itId,
      }]);
      const stored = async () => {
        const [link] = await linksOf(billingId);
        return { strength: link?.strength, type: link?.dependencyResourceTypeName };
      };

      await services.withOrigin(origin).assetDependencies.updatePrimaryToPrimaryLinks([{ id: linkId, dependencyResourceTypeId: supplierId }]);
      expect(await stored()).toEqual({ strength: 'minor', type: 'Supplier' });

      await services.withOrigin(origin).assetDependencies.updatePrimaryToPrimaryLinks([{ id: linkId, strength: 'critical' }]);
      expect(await stored()).toEqual({ strength: 'critical', type: 'Supplier' });

      await services.withOrigin(origin).assetDependencies.updatePrimaryToPrimaryLinks([{ id: linkId, dependencyResourceTypeId: null }]);
      expect(await stored()).toEqual({ strength: 'critical', type: null });
    });
  });

  describe('tenant isolation', () => {
    it('should refuse a link naming another tenant\'s type, on create and on update, and store nothing', async () => {
      const foreignTypeId = await typeNamed('Supplier', await otherTenantOrigin());

      await expect(services.withOrigin(origin).assetDependencies.createPrimaryToPrimaryLinks([{
        id: uuidv7(), dependentAssetId: billingId, providerAssetId: ordersId, dependencyResourceTypeId: foreignTypeId,
      }])).rejects.toThrow('A dependency resource type must be one of this tenant');
      expect(await linksOf(billingId)).toEqual([]);

      const linkId = uuidv7();
      await services.withOrigin(origin).assetDependencies.createPrimaryToPrimaryLinks([{ id: linkId, dependentAssetId: billingId, providerAssetId: ordersId }]);
      await expect(services.withOrigin(origin).assetDependencies.updatePrimaryToPrimaryLinks([{ id: linkId, dependencyResourceTypeId: foreignTypeId }]))
        .rejects.toThrow('A dependency resource type must be one of this tenant');
      expect((await linksOf(billingId))[0]?.dependencyResourceTypeId).toBeNull();
    });

    it('should refuse a link naming another tenant\'s type in the database', async () => {
      const foreignTypeId = await typeNamed('Supplier', await otherTenantOrigin());

      await expect(db.insert(primaryToPrimaryLinks).values({
        id: uuidv7(), tenantId, dependentAssetId: billingId, providerAssetId: ordersId, dependencyResourceTypeId: foreignTypeId,
      })).rejects.toThrow();
    });

    it('should neither list, rename nor delete another tenant\'s types', async () => {
      const other = await otherTenantOrigin();
      const foreignTypeId = await typeNamed('Supplier', other);

      expect((await typesOf(origin)).some((type) => type.id === foreignTypeId)).toBe(false);
      await expect(services.withOrigin(origin).assetDependencies.renameDependencyResourceType(foreignTypeId, 'Taken over'))
        .rejects.toThrow('Dependency resource type not found');
      await expect(services.withOrigin(origin).assetDependencies.deleteDependencyResourceType(foreignTypeId))
        .rejects.toThrow('Dependency resource type not found');
      expect((await typesOf(other)).find((type) => type.id === foreignTypeId)?.name).toBe('Supplier');
    });

    it('should let two tenants hold a type of the same name', async () => {
      const other = await otherTenantOrigin();

      await services.withOrigin(origin).assetDependencies.createDependencyResourceType({ id: uuidv7(), name: 'Hosting' });
      await services.withOrigin(other).assetDependencies.createDependencyResourceType({ id: uuidv7(), name: 'Hosting' });

      expect((await typesOf(other)).some((type) => type.name === 'Hosting')).toBe(true);
    });
  });
});
