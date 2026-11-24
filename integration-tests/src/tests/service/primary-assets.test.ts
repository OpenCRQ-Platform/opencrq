import type { EventOrigin, PrimaryAssetOnboardingTemplate } from '@app/module';
import { DuplicatePrimaryAssetReferenceError, DuplicatePrimaryAssetTemplateError, PRIMARY_ASSET_ONBOARDING_TEMPLATES } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Primary Assets Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let businessValueCategoryIds: Array<string>;
  let organizationId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;

    organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{
      id: organizationId,
      name: 'Test Organization',
    }]);

    const categories = await services.withOrigin(adminOrigin).businessValueCategories.getBusinessValueCategories();
    businessValueCategoryIds = categories.map((category) => category.id);
  });

  describe('CRUD', () => {
    it('should create and retrieve a primary asset', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id,
        organizationId,
        name: 'Customer Data',
        description: 'All customer personal data',
        ownerId: null,
        businessValueCategoryIds: [businessValueCategoryIds[0]],
      });

      const result = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAsset(id);
      expect(result).toBeTruthy();
      expect(result!.name).toBe('Customer Data');
      expect(result!.description).toBe('All customer personal data');
      expect(result!.businessValueCategories).toHaveLength(1);
      expect(result!.businessValueCategories[0].id).toBe(businessValueCategoryIds[0]);
      expect(result!.businessValueCategories[0].name).toBeTruthy();
    });

    it('should create a primary asset with multiple business value categories', async () => {
      const id = uuidv7();
      const selected = businessValueCategoryIds.slice(0, 2);
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id,
        organizationId,
        name: 'Multi-Value Asset',
        description: null,
        ownerId: null,
        businessValueCategoryIds: selected,
      });

      const result = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAsset(id);
      expect(result!.businessValueCategories).toHaveLength(2);
      expect(result!.businessValueCategories.map((category) => category.id).toSorted()).toEqual(selected.toSorted());
    });

    it('should list all primary assets for an organization', async () => {
      const id1 = uuidv7();
      const id2 = uuidv7();
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id: id1, organizationId, name: 'Asset 1', description: null, ownerId: null, businessValueCategoryIds: [],
      });
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id: id2, organizationId, name: 'Asset 2', description: null, ownerId: null, businessValueCategoryIds: [businessValueCategoryIds[0]],
      });

      const assets = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAssets(organizationId);
      expect(assets).toHaveLength(2);
    });

    it('should return an empty array for an organization with no primary assets', async () => {
      const emptyOrgId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{
        id: emptyOrgId,
        name: 'Empty Organization',
      }]);

      const assets = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAssets(emptyOrgId);
      expect(assets).toEqual([]);
    });

    it('should not list primary assets from another organization', async () => {
      const otherOrgId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{
        id: otherOrgId,
        name: 'Other Organization',
      }]);

      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id: uuidv7(), organizationId, name: 'In Org 1', description: null, ownerId: null, businessValueCategoryIds: [],
      });
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id: uuidv7(), organizationId: otherOrgId, name: 'In Org 2', description: null, ownerId: null, businessValueCategoryIds: [],
      });

      const assetsOrg1 = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAssets(organizationId);
      expect(assetsOrg1).toHaveLength(1);
      expect(assetsOrg1[0].name).toBe('In Org 1');

      const assetsOrg2 = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAssets(otherOrgId);
      expect(assetsOrg2).toHaveLength(1);
      expect(assetsOrg2[0].name).toBe('In Org 2');
    });

    it('should update a primary asset', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id, organizationId, name: 'Original', description: null, ownerId: null, businessValueCategoryIds: [businessValueCategoryIds[0]],
      });

      await services.withOrigin(adminOrigin).primaryAssets.updatePrimaryAsset(id, {
        name: 'Updated',
        businessValueCategoryIds: [businessValueCategoryIds[1]],
      });

      const updated = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAsset(id);
      expect(updated!.name).toBe('Updated');
      expect(updated!.businessValueCategories).toHaveLength(1);
      expect(updated!.businessValueCategories[0].id).toBe(businessValueCategoryIds[1]);
    });

    it('should delete primary assets', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id, organizationId, name: 'To Delete', description: null, ownerId: null, businessValueCategoryIds: [],
      });

      await services.withOrigin(adminOrigin).primaryAssets.deletePrimaryAssets([id]);

      const result = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAsset(id);
      expect(result).toBeUndefined();
    });

    it('should return undefined for non-existent primary asset', async () => {
      const result = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAsset(uuidv7());
      expect(result).toBeUndefined();
    });
  });

  describe('native fields', () => {
    const create = async (id: string, overrides: Record<string, unknown> = {}, scopeId = organizationId) =>
      services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id, organizationId: scopeId, name: 'Billing', description: null, ownerId: null, businessValueCategoryIds: [], ...overrides,
      });

    it('should store and return every native field', async () => {
      const id = uuidv7();
      await create(id, {
        reference: 'FIN-03',
        businessFunction: 'Finance',
        availability: 'very_high',
        integrity: 'high',
        confidentiality: 'medium',
        traceability: 'low',
        rtoMinutes: 240,
        rpoMinutes: 60,
        mtpdMinutes: 1440,
      });

      const expected = {
        reference: 'FIN-03',
        businessFunction: 'Finance',
        availability: 'very_high',
        integrity: 'high',
        confidentiality: 'medium',
        traceability: 'low',
        rtoMinutes: 240,
        rpoMinutes: 60,
        mtpdMinutes: 1440,
      };
      expect(await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAsset(id)).toMatchObject(expected);
      const [listed] = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAssets(organizationId);
      expect(listed).toMatchObject(expected);
    });

    it('should store a field left out as null', async () => {
      const id = uuidv7();
      await create(id);

      expect(await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAsset(id)).toMatchObject({
        reference: null, businessFunction: null, availability: null, traceability: null, rtoMinutes: null, mtpdMinutes: null,
      });
    });

    it('should trim the reference and the business function, and store a blank one as null', async () => {
      const trimmed = uuidv7();
      const blank = uuidv7();
      await create(trimmed, { reference: '  FIN-03 ', businessFunction: ' Finance  ' });
      await create(blank, { reference: '   ', businessFunction: '' });

      expect(await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAsset(trimmed)).toMatchObject({ reference: 'FIN-03', businessFunction: 'Finance' });
      expect(await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAsset(blank)).toMatchObject({ reference: null, businessFunction: null });
    });

    it('should refuse a reference another primary asset of the risk scope holds', async () => {
      await create(uuidv7(), { reference: 'FIN-03' });

      await expect(create(uuidv7(), { reference: ' FIN-03' })).rejects.toBeInstanceOf(DuplicatePrimaryAssetReferenceError);
    });

    it('should let two risk scopes use the same reference', async () => {
      const otherScope = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: otherScope, name: 'Other scope' }]);
      await create(uuidv7(), { reference: 'FIN-03' });

      await expect(create(uuidv7(), { reference: 'FIN-03' }, otherScope)).resolves.toBeUndefined();
    });

    it('should let several primary assets of a scope have no reference', async () => {
      await create(uuidv7());

      await expect(create(uuidv7(), { reference: null })).resolves.toBeUndefined();
    });

    it('should refuse renaming a reference to one another primary asset holds, and keep its own', async () => {
      const first = uuidv7();
      const second = uuidv7();
      await create(first, { reference: 'FIN-03' });
      await create(second, { reference: 'FIN-04' });
      const scoped = services.withOrigin(adminOrigin).primaryAssets;

      await expect(scoped.updatePrimaryAsset(second, { reference: 'FIN-03' })).rejects.toBeInstanceOf(DuplicatePrimaryAssetReferenceError);
      await expect(scoped.updatePrimaryAsset(second, { reference: 'FIN-04', name: 'Renamed' })).resolves.toBeUndefined();
      expect(await scoped.getPrimaryAsset(second)).toMatchObject({ reference: 'FIN-04', name: 'Renamed' });
    });

    it('should leave a field out of an update unchanged and clear one sent as null', async () => {
      const id = uuidv7();
      await create(id, { reference: 'FIN-03', availability: 'high', rtoMinutes: 240 });
      const scoped = services.withOrigin(adminOrigin).primaryAssets;

      await scoped.updatePrimaryAsset(id, { availability: null });

      expect(await scoped.getPrimaryAsset(id)).toMatchObject({ reference: 'FIN-03', availability: null, rtoMinutes: 240 });
    });

    it('should store not applicable on each need, apart from an empty one', async () => {
      const id = uuidv7();
      await create(id, { availability: 'not_applicable', integrity: 'not_applicable', confidentiality: 'not_applicable', traceability: 'not_applicable' });
      const scoped = services.withOrigin(adminOrigin).primaryAssets;

      await scoped.updatePrimaryAsset(id, { integrity: 'low', traceability: null });

      expect(await scoped.getPrimaryAsset(id)).toMatchObject({
        availability: 'not_applicable', integrity: 'low', confidentiality: 'not_applicable', traceability: null,
      });
    });

    it.each(['availability', 'integrity', 'confidentiality', 'traceability'] as const)('should refuse a %s outside the five levels', async (criterion) => {
      const rejection: unknown = await create(uuidv7(), { [criterion]: 'none' }).then(() => undefined, (error: unknown) => error);

      expect(rejection).toMatchObject({ cause: { constraint: `primary_assets_${criterion}_ck` } });
    });
  });

  describe('onboarding template', () => {
    const create = async (id: string, onboardingTemplate?: PrimaryAssetOnboardingTemplate | null) =>
      services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id, organizationId, name: 'Customer data', description: null, ownerId: null, businessValueCategoryIds: [], onboardingTemplate,
      });

    it('should store the template a primary asset was created from and list it', async () => {
      const id = uuidv7();
      await create(id, 'hr-data');

      const listed = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAssets(organizationId);
      expect(listed).toEqual([expect.objectContaining({ id, onboardingTemplate: 'hr-data' })]);
    });

    it('should store every template key of the catalogue', async () => {
      for (const template of PRIMARY_ASSET_ONBOARDING_TEMPLATES) {
        await create(uuidv7(), template);
      }

      const listed = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAssets(organizationId);
      expect(listed.map((asset) => asset.onboardingTemplate).toSorted()).toEqual([...PRIMARY_ASSET_ONBOARDING_TEMPLATES].toSorted());
    });

    it('should store no template when none is given, or a null one', async () => {
      await create(uuidv7());
      await create(uuidv7(), null);

      const listed = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAssets(organizationId);
      expect(listed.map((asset) => asset.onboardingTemplate)).toEqual([null, null]);
    });

    it('should refuse a second primary asset of the same template in one risk scope, two at once included', async () => {
      await create(uuidv7(), 'customer-data');

      await expect(create(uuidv7(), 'customer-data')).rejects.toBeInstanceOf(DuplicatePrimaryAssetTemplateError);
      const results = await Promise.allSettled([create(uuidv7(), 'hr-data'), create(uuidv7(), 'hr-data')]);
      expect(results.map((result) => result.status).toSorted()).toEqual(['fulfilled', 'rejected']);
      const listed = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAssets(organizationId);
      expect(listed.map((asset) => asset.onboardingTemplate).toSorted()).toEqual(['customer-data', 'hr-data']);
    });

    it('should let two risk scopes each hold the primary asset of a template', async () => {
      const otherScope = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: otherScope, name: 'Other scope' }]);
      await create(uuidv7(), 'customer-data');

      await expect(services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id: uuidv7(), organizationId: otherScope, name: 'Customer data', description: null, ownerId: null, businessValueCategoryIds: [], onboardingTemplate: 'customer-data',
      })).resolves.toBeUndefined();
    });

    it('should keep the template when the primary asset is renamed', async () => {
      const id = uuidv7();
      await create(id, 'customer-data');
      await services.withOrigin(adminOrigin).primaryAssets.updatePrimaryAsset(id, { name: 'Données clients' });

      const [listed] = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAssets(organizationId);
      expect(listed).toMatchObject({ name: 'Données clients', onboardingTemplate: 'customer-data' });
    });
  });

  describe('business value category validation', () => {
    it('should reject a category that is not in the tenant catalog', async () => {
      await expect(
        services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
          id: uuidv7(),
          organizationId,
          name: 'Invalid Asset',
          description: null,
          ownerId: null,
          businessValueCategoryIds: [uuidv7()],
        }),
      ).rejects.toThrow('Access Denied');
    });

    it('should reject another tenant\'s category', async () => {
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const theirCategories = await services.withOrigin(otherOrigin).businessValueCategories.getBusinessValueCategories();

      await expect(
        services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
          id: uuidv7(),
          organizationId,
          name: 'Cross-tenant Asset',
          description: null,
          ownerId: null,
          businessValueCategoryIds: [theirCategories[0].id],
        }),
      ).rejects.toThrow('Access Denied');
    });

    it('should reject an unknown category on update and leave the assignments untouched', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id, organizationId, name: 'Asset', description: null, ownerId: null, businessValueCategoryIds: [businessValueCategoryIds[0]],
      });

      await expect(
        services.withOrigin(adminOrigin).primaryAssets.updatePrimaryAsset(id, {
          businessValueCategoryIds: [businessValueCategoryIds[0], uuidv7()],
        }),
      ).rejects.toThrow('Access Denied');

      const result = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAsset(id);
      expect(result!.businessValueCategories.map((category) => category.id)).toEqual([businessValueCategoryIds[0]]);
    });
  });

  describe('tenant isolation', () => {
    let tenantBOrigin: EventOrigin;

    beforeEach(async () => {
      const tenantBId = await createTenant(services, adminUserId);
      tenantBOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
    });

    it('should not list primary assets from another tenant', async () => {
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id: uuidv7(), organizationId, name: 'Tenant A Asset', description: null, ownerId: null, businessValueCategoryIds: [],
      });

      const tenantBAssets = await services.withOrigin(tenantBOrigin).primaryAssets.getPrimaryAssets(organizationId);
      expect(tenantBAssets).toHaveLength(0);
    });

    it('should not get a primary asset from another tenant by ID', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id, organizationId, name: 'Hidden Asset', description: null, ownerId: null, businessValueCategoryIds: [],
      });

      const result = await services.withOrigin(tenantBOrigin).primaryAssets.getPrimaryAsset(id);
      expect(result).toBeUndefined();
    });

    it('should not update a primary asset from another tenant', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id, organizationId, name: 'Original Name', description: null, ownerId: null, businessValueCategoryIds: [],
      });

      await services.withOrigin(tenantBOrigin).primaryAssets.updatePrimaryAsset(id, {
        name: 'Hacked Name',
      });

      const result = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAsset(id);
      expect(result!.name).toBe('Original Name');
    });

    it('should reject creating a primary asset in another tenant\'s organization', async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const tenantBUser = await createTenantUser(services, db, { type: 'client', userId: adminUserId, tenantId: tenantBId });
      await expect(
        services.withOrigin(tenantBUser.origin).primaryAssets.createPrimaryAsset({
          id: uuidv7(),
          organizationId,
          name: 'Cross-tenant asset',
          description: null,
          ownerId: null,
          businessValueCategoryIds: [],
        }),
      ).rejects.toThrow();
    });

    it('should not delete a primary asset from another tenant', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id, organizationId, name: 'Protected Asset', description: null, ownerId: null, businessValueCategoryIds: [],
      });

      await services.withOrigin(tenantBOrigin).primaryAssets.deletePrimaryAssets([id]);

      const result = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAsset(id);
      expect(result).toBeTruthy();
    });
  });
});
