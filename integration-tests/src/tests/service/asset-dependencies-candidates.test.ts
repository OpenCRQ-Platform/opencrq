import type { EventOrigin } from '@app/module';
import { supportingAssets, supportToPrimaryLinks, supportToSupportLinks } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Asset Dependencies Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let adminEmail: string;
  let adminTenantId: string;
  let primaryAssetId: string;
  let supportingAssetId: string;
  let supportingAssetId2: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    adminEmail = setup.email;
    adminTenantId = setup.tenantId;

    const organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{
      id: organizationId, name: 'Test Org',
    }]);

    primaryAssetId = uuidv7();
    await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
      id: primaryAssetId, organizationId, name: 'Customer Data', description: null, ownerId: null, businessValueCategoryIds: [],
    });

    supportingAssetId = uuidv7();
    await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
      id: supportingAssetId, name: 'Database Server', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
    });

    supportingAssetId2 = uuidv7();
    await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
      id: supportingAssetId2, name: 'Web Server', description: null, ownerId: null, exposure: 'internet_facing', categoryId: 'host',
    });
  });

  describe('dependency candidates', () => {
    let alphaCacheId: string;

    const candidates = (
      relation: 'dependsOn' | 'providesTo' | 'supportsPrimary',
      assetId: string,
      options: { linkedOnly?: boolean, search?: string, page?: number, limit?: number } = {},
    ) =>
      services.withOrigin(adminOrigin).supportingAssets.listDependencyCandidates({
        page: options.page ?? 1,
        limit: options.limit ?? 50,
        search: options.search ?? null,
        source: null,
        categoryId: null,
        dependency: { relation, assetId, linkedOnly: options.linkedOnly ?? false },
      });

    beforeEach(async () => {
      // Sorts first by name, so it shows that a linked row outranks the alphabet.
      alphaCacheId = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: alphaCacheId, name: 'Alpha Cache', description: null, ownerId: null, exposure: 'internal', categoryId: 'host',
      });
      // Web Server provides to Database Server.
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id: uuidv7(), providerAssetId: supportingAssetId2, dependentAssetId: supportingAssetId,
      }]);
    });

    it('should raise the providers of the asset first', async () => {
      const result = await candidates('dependsOn', supportingAssetId);

      expect(result.items.map((row) => row.name)).toEqual(['Web Server', 'Alpha Cache']);
      expect(result.total).toBe(2);
    });

    it('should raise the dependents of the asset first for the opposite relation', async () => {
      const fromProvider = await candidates('providesTo', supportingAssetId2);
      const fromDependent = await candidates('providesTo', supportingAssetId, { linkedOnly: true });

      expect(fromProvider.items.map((row) => row.name)).toEqual(['Database Server', 'Alpha Cache']);
      expect(fromDependent.items).toEqual([]);
    });

    it('should order the unlinked assets by name with case and accents folded together', async () => {
      const names = ['Zèbre', 'école', 'eden', 'Ecole', 'abc'];
      for (const name of names) {
        await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
          id: uuidv7(), name, description: null, ownerId: null, exposure: 'internal', categoryId: 'host',
        });
      }

      const result = await candidates('dependsOn', supportingAssetId);

      expect(result.items.map((row) => row.name).filter((name) => name !== null && names.includes(name))).toEqual(['abc', 'Ecole', 'école', 'eden', 'Zèbre']);
    });

    it('should never offer the asset as its own provider or dependent', async () => {
      const result = await candidates('dependsOn', supportingAssetId);

      expect(result.items.map((row) => row.id)).not.toContain(supportingAssetId);
    });

    it('should keep only the linked assets, and count only them, when asked', async () => {
      const result = await candidates('dependsOn', supportingAssetId, { linkedOnly: true });

      expect(result.items.map((row) => row.name)).toEqual(['Web Server']);
      expect(result.total).toBe(1);
    });

    describe('an asset with no name, known by its derived name', () => {
      let addressId: string;

      beforeEach(async () => {
        addressId = uuidv7();
        await db.insert(supportingAssets).values({
          id: addressId, tenantId: adminTenantId, name: null, derivedName: '10.0.0.1', exposure: 'internal', categoryId: 'host', criticality: 'low',
        });
      });

      it('should sit among the others by its derived name, after the linked rows', async () => {
        const result = await candidates('dependsOn', supportingAssetId);

        expect(result.items.map((row) => row.id)).toEqual([supportingAssetId2, addressId, alphaCacheId]);
      });

      it('should be found by a part of its derived name', async () => {
        const result = await candidates('dependsOn', supportingAssetId, { search: '0.0.1' });

        expect(result.items.map((row) => row.id)).toEqual([addressId]);
        expect(result.total).toBe(1);
      });
    });

    it('should combine the search with the link state', async () => {
      const result = await candidates('dependsOn', supportingAssetId, { search: 'cache' });

      expect(result.items.map((row) => row.name)).toEqual(['Alpha Cache']);
      expect(result.total).toBe(1);
    });

    it('should cut the pages across the end of the linked rows', async () => {
      const zetaProxyId = uuidv7();
      for (const [id, name] of [[zetaProxyId, 'Zeta Proxy'], [uuidv7(), 'Beta Queue']]) {
        await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
          id, name, description: null, ownerId: null, exposure: 'internal', categoryId: 'host',
        });
      }
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id: uuidv7(), providerAssetId: zetaProxyId, dependentAssetId: supportingAssetId,
      }]);
      const page = async (pageNumber: number, limit: number) =>
        (await candidates('dependsOn', supportingAssetId, { page: pageNumber, limit })).items.map((row) => row.name);

      expect(await Promise.all([1, 2, 3, 4, 5].map(async (pageNumber) => page(pageNumber, 1))))
        .toEqual([['Web Server'], ['Zeta Proxy'], ['Alpha Cache'], ['Beta Queue'], []]);
      expect([await page(1, 3), await page(2, 3)]).toEqual([['Web Server', 'Zeta Proxy', 'Alpha Cache'], ['Beta Queue']]);
    });

    it('should keep the linked-first order past the link count it binds as a list', async () => {
      // 2,001 links: one past what the page cut binds as a list, which sorts the tenant instead. The
      // service creates assets one by one, so they go in as one statement.
      const linkedIds = Array.from({ length: 2_001 }, () => uuidv7());
      await db.insert(supportingAssets).values(linkedIds.map((id, index) => ({
        id, tenantId: adminTenantId, name: `Linked ${String(index + 1).padStart(4, '0')}`, exposure: 'internal' as const, categoryId: 'host' as const, criticality: 'low' as const,
      })));
      for (let start = 0; start < linkedIds.length; start += 500) {
        await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks(linkedIds.slice(start, start + 500).map((id) => ({
          id: uuidv7(), providerAssetId: supportingAssetId, dependentAssetId: id,
        })));
      }
      const page = async (pageNumber: number) => candidates('providesTo', supportingAssetId, { page: pageNumber, limit: 2 });

      const [first, boundary, last] = await Promise.all([page(1), page(1_001), page(1_002)]);

      expect(first.items.map((row) => row.name)).toEqual(['Linked 0001', 'Linked 0002']);
      expect(boundary.items.map((row) => row.name)).toEqual(['Linked 2001', 'Alpha Cache']);
      expect(last.items.map((row) => row.name)).toEqual(['Web Server']);
      expect(first.total).toBe(2_003);
    });

    it('should raise the supporting assets of a primary asset first, the asset itself included', async () => {
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId, primaryAssetId, roles: ['stores'],
      }]);

      const result = await candidates('supportsPrimary', primaryAssetId);

      expect(result.items.map((row) => row.name)).toEqual(['Database Server', 'Alpha Cache', 'Web Server']);
    });

    it('should not offer or reveal the assets of another tenant', async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      const result = await services.withOrigin(tenantBOrigin).supportingAssets.listDependencyCandidates({
        page: 1,
        limit: 50,
        search: null,
        source: null,
        categoryId: null,
        dependency: { relation: 'dependsOn', assetId: supportingAssetId, linkedOnly: false },
      });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('primary assets with scope', () => {
    it('should list the primary assets of every scope with their scope, by name', async () => {
      const otherOrganizationId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: otherOrganizationId, name: 'Other Org' }]);
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id: uuidv7(), organizationId: otherOrganizationId, name: 'Billing', description: null, ownerId: adminUserId, businessValueCategoryIds: [],
      });

      const result = await services.withOrigin(adminOrigin).primaryAssets.getPrimaryAssetsWithScope();

      expect(result.map((row) => [row.name, row.organization.name])).toEqual([['Billing', 'Other Org'], ['Customer Data', 'Test Org']]);
      expect(result[0].owner).toMatchObject({ id: adminUserId, email: adminEmail });
      expect(result[1].owner).toBeNull();
    });

    it('should not list the primary assets of another tenant', async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      const result = await services.withOrigin(tenantBOrigin).primaryAssets.getPrimaryAssetsWithScope();

      expect(result).toEqual([]);
    });
  });

  describe('cascade deletes', () => {
    it('should cascade delete S→P links when supporting asset is deleted', async () => {
      const linkId = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: linkId, supportingAssetId, primaryAssetId,
      }]);

      await services.withOrigin(adminOrigin).supportingAssets.deleteSupportingAssets([supportingAssetId]);

      const link = (await services.withOrigin(adminOrigin).assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId(primaryAssetId)).find((l) => l.id === linkId);
      expect(link).toBeUndefined();
    });

    it('should cascade delete S→P links when primary asset is deleted', async () => {
      const linkId = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: linkId, supportingAssetId, primaryAssetId,
      }]);

      await services.withOrigin(adminOrigin).primaryAssets.deletePrimaryAssets([primaryAssetId]);

      const link = (await services.withOrigin(adminOrigin).assetDependencies.getSupportToPrimaryLinksBySupportingAssetId(supportingAssetId)).find((l) => l.id === linkId);
      expect(link).toBeUndefined();
    });

    it('should cascade delete S→S links when provider asset is deleted', async () => {
      const linkId = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id: linkId, providerAssetId: supportingAssetId, dependentAssetId: supportingAssetId2,
      }]);

      await services.withOrigin(adminOrigin).supportingAssets.deleteSupportingAssets([supportingAssetId]);

      const link = (await services.withOrigin(adminOrigin).assetDependencies.getSupportToSupportLinks(supportingAssetId2)).find((l) => l.id === linkId);
      expect(link).toBeUndefined();
    });

    it('should cascade delete S→S links when dependent asset is deleted', async () => {
      const linkId = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id: linkId, providerAssetId: supportingAssetId, dependentAssetId: supportingAssetId2,
      }]);

      await services.withOrigin(adminOrigin).supportingAssets.deleteSupportingAssets([supportingAssetId2]);

      const link = (await services.withOrigin(adminOrigin).assetDependencies.getSupportToSupportLinks(supportingAssetId)).find((l) => l.id === linkId);
      expect(link).toBeUndefined();
    });
  });

  describe('tenant isolation', () => {
    let tenantBOrigin: EventOrigin;

    beforeEach(async () => {
      const tenantBId = await createTenant(services, adminUserId);
      tenantBOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
    });

    it('should not list S→P links from another tenant', async () => {
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId, primaryAssetId,
      }]);

      const links = await services.withOrigin(tenantBOrigin).assetDependencies.getSupportToPrimaryLinksBySupportingAssetId(supportingAssetId);
      expect(links).toHaveLength(0);
    });

    it('should not list S→S links from another tenant', async () => {
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id: uuidv7(), providerAssetId: supportingAssetId, dependentAssetId: supportingAssetId2,
      }]);

      const asProvider = (await services.withOrigin(tenantBOrigin).assetDependencies.getSupportToSupportLinks(supportingAssetId)).filter((l) => l.direction === 'provides');
      expect(asProvider).toHaveLength(0);

      const asDependent = (await services.withOrigin(tenantBOrigin).assetDependencies.getSupportToSupportLinks(supportingAssetId2)).filter((l) => l.direction === 'depends');
      expect(asDependent).toHaveLength(0);
    });

    it('should not get a single S→P link from another tenant by ID', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id, supportingAssetId, primaryAssetId,
      }]);

      const link = (await services.withOrigin(tenantBOrigin).assetDependencies.getSupportToPrimaryLinksBySupportingAssetId(supportingAssetId)).find((l) => l.id === id);
      expect(link).toBeUndefined();
    });

    it('should not get a single S→S link from another tenant by ID', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id, providerAssetId: supportingAssetId, dependentAssetId: supportingAssetId2,
      }]);

      const link = (await services.withOrigin(tenantBOrigin).assetDependencies.getSupportToSupportLinks(supportingAssetId)).find((l) => l.id === id);
      expect(link).toBeUndefined();
    });

    it('should create no dependency between another tenant\'s assets, and report it gone', async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const tenantBUser = await createTenantUser(services, db, { type: 'client', userId: adminUserId, tenantId: tenantBId });
      const id = uuidv7();

      const outcome = await services.withOrigin(tenantBUser.origin).assetDependencies.createSupportToPrimaryLinks([{
        id,
        supportingAssetId,
        primaryAssetId,
      }]);

      expect(outcome).toEqual({ skippedIds: [], goneIds: [id] });
      expect(await services.withOrigin(adminOrigin).assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId(primaryAssetId)).toHaveLength(0);
    });

    it('should create only the links of a batch between its own tenant\'s assets', async () => {
      const foreignAssetId = uuidv7();
      await services.withOrigin(tenantBOrigin).supportingAssets.createSupportingAsset({
        id: foreignAssetId, name: 'Foreign Server', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });
      const foreignSupportId = uuidv7();
      const foreignPrimaryId = uuidv7();

      const supportOutcome = await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([
        { id: uuidv7(), providerAssetId: supportingAssetId2, dependentAssetId: supportingAssetId },
        { id: foreignSupportId, providerAssetId: foreignAssetId, dependentAssetId: supportingAssetId },
      ]);
      const primaryOutcome = await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([
        { id: uuidv7(), supportingAssetId, primaryAssetId },
        { id: foreignPrimaryId, supportingAssetId: foreignAssetId, primaryAssetId },
      ]);

      expect(supportOutcome.goneIds).toEqual([foreignSupportId]);
      expect(primaryOutcome.goneIds).toEqual([foreignPrimaryId]);
      expect((await services.withOrigin(adminOrigin).assetDependencies.getSupportToSupportLinks(supportingAssetId)).map((l) => l.relatedAssetId))
        .toEqual([supportingAssetId2]);
      expect((await services.withOrigin(adminOrigin).assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId(primaryAssetId)).map((l) => l.supportingAssetId))
        .toEqual([supportingAssetId]);
      expect(await services.withOrigin(tenantBOrigin).assetDependencies.getSupportToSupportLinks(foreignAssetId)).toHaveLength(0);
    });

    it('should create no link from its own asset to another tenant\'s primary asset or dependent asset', async () => {
      const foreignOrganizationId = uuidv7();
      await services.withOrigin(tenantBOrigin).organizations.createOrganizations([{ id: foreignOrganizationId, name: 'Foreign Org' }]);
      const foreignPrimaryAssetId = uuidv7();
      await services.withOrigin(tenantBOrigin).primaryAssets.createPrimaryAsset({
        id: foreignPrimaryAssetId, organizationId: foreignOrganizationId, name: 'Foreign Data', description: null, ownerId: null, businessValueCategoryIds: [],
      });
      const foreignDependentId = uuidv7();
      await services.withOrigin(tenantBOrigin).supportingAssets.createSupportingAsset({
        id: foreignDependentId, name: 'Foreign Server', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });
      const primaryLinkId = uuidv7();
      const supportLinkId = uuidv7();

      const primaryOutcome = await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([
        { id: primaryLinkId, supportingAssetId, primaryAssetId: foreignPrimaryAssetId },
      ]);
      const supportOutcome = await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([
        { id: supportLinkId, providerAssetId: supportingAssetId, dependentAssetId: foreignDependentId },
      ]);

      expect(primaryOutcome.goneIds).toEqual([primaryLinkId]);
      expect(supportOutcome.goneIds).toEqual([supportLinkId]);
      expect(await db.select().from(supportToPrimaryLinks)).toHaveLength(0);
      expect(await db.select().from(supportToSupportLinks)).toHaveLength(0);
    });

    it('should not read the roles of a link from another tenant', async () => {
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId, primaryAssetId, roles: ['stores'],
      }]);

      const links = await services.withOrigin(tenantBOrigin).assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId(primaryAssetId);
      expect(links).toHaveLength(0);
    });

    it('should skip a link from another tenant, leaving its roles unchanged', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id, supportingAssetId, primaryAssetId, roles: ['stores'],
      }]);

      const outcome = await services.withOrigin(tenantBOrigin).assetDependencies.updateSupportToPrimaryLinks([{ id: id, roles: ['monitors'] }]);

      expect(outcome.skippedIds).toEqual([id]);

      const link = (await services.withOrigin(adminOrigin).assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId(primaryAssetId)).find((l) => l.id === id);
      expect(link!.roles).toEqual(['stores']);
    });

    it('should not delete S→P links from another tenant', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id, supportingAssetId, primaryAssetId,
      }]);

      await services.withOrigin(tenantBOrigin).assetDependencies.deleteSupportToPrimaryLinks([id]);

      const link = (await services.withOrigin(adminOrigin).assetDependencies.getSupportToPrimaryLinksBySupportingAssetId(supportingAssetId)).find((l) => l.id === id);
      expect(link).toBeTruthy();
    });

    it('should not delete S→S links from another tenant', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id, providerAssetId: supportingAssetId, dependentAssetId: supportingAssetId2,
      }]);

      await services.withOrigin(tenantBOrigin).assetDependencies.deleteSupportToSupportLinks([id]);

      const link = (await services.withOrigin(adminOrigin).assetDependencies.getSupportToSupportLinks(supportingAssetId)).find((l) => l.id === id);
      expect(link).toBeTruthy();
    });
  });
});
