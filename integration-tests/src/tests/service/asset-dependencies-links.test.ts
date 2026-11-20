import type { EventOrigin, SupportToPrimaryLinkRole } from '@app/module';
import { supportToPrimaryLinks } from '@app/module';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Asset Dependencies Service', () => {
  let adminOrigin: EventOrigin;
  let adminTenantId: string;
  let primaryAssetId: string;
  let supportingAssetId: string;
  let supportingAssetId2: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
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

  /** An asset the caller read before another writer deleted it. */
  const deletedSupportingAsset = async () => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
      id, name: 'Retired Server', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
    });
    await services.withOrigin(adminOrigin).supportingAssets.deleteSupportingAssets([id]);
    return id;
  };

  describe('Support-to-Primary links', () => {
    it('should create and retrieve a support-to-primary link', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id,
        supportingAssetId,
        primaryAssetId,
      }]);

      const link = (await services.withOrigin(adminOrigin).assetDependencies.getSupportToPrimaryLinksBySupportingAssetId(supportingAssetId)).find((l) => l.id === id);
      expect(link).toBeTruthy();
      expect(link!.primaryAssetId).toBe(primaryAssetId);
      expect(link!.primaryAssetName).toBe('Customer Data');
    });

    it('should list links by supporting asset', async () => {
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId, primaryAssetId,
      }]);

      const links = await services.withOrigin(adminOrigin).assetDependencies.getSupportToPrimaryLinksBySupportingAssetId(supportingAssetId);
      expect(links).toHaveLength(1);
    });

    it('should delete support-to-primary links', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id, supportingAssetId, primaryAssetId,
      }]);

      await services.withOrigin(adminOrigin).assetDependencies.deleteSupportToPrimaryLinks([id]);

      const link = (await services.withOrigin(adminOrigin).assetDependencies.getSupportToPrimaryLinksBySupportingAssetId(supportingAssetId)).find((l) => l.id === id);
      expect(link).toBeUndefined();
    });

    it('should skip a pair already linked, keeping the stored link and its roles', async () => {
      const storedId = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: storedId, supportingAssetId, primaryAssetId, roles: ['stores'],
      }]);

      const duplicateId = uuidv7();
      const outcome = await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: duplicateId, supportingAssetId, primaryAssetId, roles: ['monitors'],
      }]);

      expect(outcome.skippedIds).toEqual([duplicateId]);
      const links = await services.withOrigin(adminOrigin).assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId(primaryAssetId);
      expect(links.map((l) => [l.id, l.roles])).toEqual([[storedId, ['stores']]]);
    });

    it('should create every link of a batch, each with its own roles', async () => {
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([
        { id: uuidv7(), supportingAssetId, primaryAssetId, roles: ['stores'] },
        { id: uuidv7(), supportingAssetId: supportingAssetId2, primaryAssetId },
      ]);

      const links = await services.withOrigin(adminOrigin).assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId(primaryAssetId);
      expect(links.map((l) => [l.supportingAssetName, l.roles]).sort()).toEqual([['Database Server', ['stores']], ['Web Server', ['unknown']]]);
    });

    it('should create a pair two concurrent calls both link once, and skip it in the other', async () => {
      const outcomes = await Promise.all([uuidv7(), uuidv7()].map((id) =>
        services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{ id, supportingAssetId, primaryAssetId }])));

      expect(outcomes.flatMap((outcome) => outcome.skippedIds)).toHaveLength(1);
      expect(await services.withOrigin(adminOrigin).assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId(primaryAssetId)).toHaveLength(1);
    });

    it('should create the rest of a batch holding a pair already linked', async () => {
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId, primaryAssetId,
      }]);

      const duplicateId = uuidv7();
      const outcome = await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([
        { id: uuidv7(), supportingAssetId: supportingAssetId2, primaryAssetId },
        { id: duplicateId, supportingAssetId, primaryAssetId },
      ]);

      expect(outcome.skippedIds).toEqual([duplicateId]);
      const links = await services.withOrigin(adminOrigin).assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId(primaryAssetId);
      expect(links.map((l) => l.supportingAssetId).sort()).toEqual([supportingAssetId, supportingAssetId2].sort());
    });

    it('should create the rest of a batch naming a deleted asset, and report its link gone', async () => {
      const deletedAssetId = await deletedSupportingAsset();

      const goneId = uuidv7();
      const outcome = await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([
        { id: uuidv7(), supportingAssetId, primaryAssetId },
        { id: goneId, supportingAssetId: deletedAssetId, primaryAssetId },
      ]);

      expect(outcome).toEqual({ skippedIds: [], goneIds: [goneId] });
      const links = await services.withOrigin(adminOrigin).assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId(primaryAssetId);
      expect(links.map((l) => l.supportingAssetId)).toEqual([supportingAssetId]);
    });

    it('should create none of a batch holding an invalid role set', async () => {
      await expect(
        services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([
          { id: uuidv7(), supportingAssetId, primaryAssetId },
          { id: uuidv7(), supportingAssetId: supportingAssetId2, primaryAssetId, roles: [] },
        ]),
      ).rejects.toThrow('at least one role');
      expect(await services.withOrigin(adminOrigin).assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId(primaryAssetId)).toHaveLength(0);
    });
  });

  describe('Support-to-Primary link roles', () => {
    const create = (roles?: Array<SupportToPrimaryLinkRole>, linkedAssetId = supportingAssetId) => {
      const id = uuidv7();
      return services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id, supportingAssetId: linkedAssetId, primaryAssetId, roles,
      }]).then(() => id);
    };
    const rolesOf = async (id: string) =>
      (await services.withOrigin(adminOrigin).assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId(primaryAssetId))
        .find((l) => l.id === id)?.roles;

    it('should store a link created without a role as unknown', async () => {
      const id = await create();

      expect(await rolesOf(id)).toEqual(['unknown']);
    });

    it('should give a row inserted without roles the unknown default', async () => {
      const id = uuidv7();
      await db.insert(supportToPrimaryLinks).values({ id, tenantId: adminTenantId, supportingAssetId, primaryAssetId });

      expect(await rolesOf(id)).toEqual(['unknown']);
    });

    it('should store several roles in the list order', async () => {
      const id = await create(['processes', 'stores']);

      expect(await rolesOf(id)).toEqual(['stores', 'processes']);
    });

    it('should return the roles on the supporting asset side too', async () => {
      const id = await create(['transmits']);

      const link = (await services.withOrigin(adminOrigin).assetDependencies.getSupportToPrimaryLinksBySupportingAssetId(supportingAssetId))
        .find((l) => l.id === id);
      expect(link!.roles).toEqual(['transmits']);
    });

    it('should refuse to create a link with unknown beside another role', async () => {
      await expect(create(['unknown', 'stores'])).rejects.toThrow('Unknown cannot be combined');
    });

    it('should refuse to create a link with an empty role list', async () => {
      await expect(create([])).rejects.toThrow('at least one role');
    });

    it('should change the roles of a link', async () => {
      const id = await create();

      await services.withOrigin(adminOrigin).assetDependencies.updateSupportToPrimaryLinks([{ id: id, roles: ['administers', 'monitors'] }]);

      expect(await rolesOf(id)).toEqual(['administers', 'monitors']);
    });

    it('should refuse an update with unknown beside another role', async () => {
      const id = await create(['stores']);

      await expect(
        services.withOrigin(adminOrigin).assetDependencies.updateSupportToPrimaryLinks([{ id: id, roles: ['stores', 'unknown'] }]),
      ).rejects.toThrow('Unknown cannot be combined');
      expect(await rolesOf(id)).toEqual(['stores']);
    });

    it('should change the roles of every link of a batch, each to its own set', async () => {
      const cacheId = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: cacheId, name: 'Cache', description: null, ownerId: null, exposure: 'internal', categoryId: 'host',
      });
      const first = await create();
      const second = await create(['stores'], supportingAssetId2);
      const thirdId = await create(undefined, cacheId);

      await services.withOrigin(adminOrigin).assetDependencies.updateSupportToPrimaryLinks([
        { id: first, roles: ['monitors'] },
        { id: second, roles: ['processes', 'stores'] },
        { id: thirdId, roles: ['monitors'] },
      ]);

      expect([await rolesOf(first), await rolesOf(second), await rolesOf(thirdId)])
        .toEqual([['monitors'], ['stores', 'processes'], ['monitors']]);
    });

    it('should change none of a batch holding an invalid role set', async () => {
      const first = await create(['stores']);
      const second = await create(['stores'], supportingAssetId2);

      await expect(
        services.withOrigin(adminOrigin).assetDependencies.updateSupportToPrimaryLinks([
          { id: first, roles: ['monitors'] },
          { id: second, roles: [] },
        ]),
      ).rejects.toThrow('at least one role');
      expect([await rolesOf(first), await rolesOf(second)]).toEqual([['stores'], ['stores']]);
    });

    it('should update the rest of a batch naming a link that is gone', async () => {
      const id = await create(['stores']);
      const goneId = await create(['reads'], supportingAssetId2);
      await services.withOrigin(adminOrigin).assetDependencies.deleteSupportToPrimaryLinks([goneId]);

      const outcome = await services.withOrigin(adminOrigin).assetDependencies.updateSupportToPrimaryLinks([
        { id, roles: ['monitors'] },
        { id: goneId, roles: ['monitors'] },
      ]);

      expect(outcome.skippedIds).toEqual([goneId]);
      expect(await rolesOf(id)).toEqual(['monitors']);
    });

    it('should refuse a role outside the closed list in the database', async () => {
      await expect(
        db.execute(sql`INSERT INTO support_to_primary_links (id, tenant_id, supporting_asset_id, primary_asset_id, roles)
          VALUES (${uuidv7()}, ${adminTenantId}, ${supportingAssetId}, ${primaryAssetId}, ARRAY['depends_on'])`),
      ).rejects.toThrow();
    });

    it('should refuse unknown beside another role in the database', async () => {
      const id = await create(['stores']);

      await expect(
        db.update(supportToPrimaryLinks).set({ roles: ['stores', 'unknown'] }).where(eq(supportToPrimaryLinks.id, id)),
      ).rejects.toThrow();
    });

    it('should refuse an empty role list in the database', async () => {
      const id = await create(['stores']);

      await expect(
        db.update(supportToPrimaryLinks).set({ roles: [] }).where(eq(supportToPrimaryLinks.id, id)),
      ).rejects.toThrow();
    });
  });

  describe('Support-to-Support links', () => {
    it('should create and retrieve a support-to-support link', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id,
        providerAssetId: supportingAssetId,
        dependentAssetId: supportingAssetId2,
      }]);

      const link = (await services.withOrigin(adminOrigin).assetDependencies.getSupportToSupportLinks(supportingAssetId)).find((l) => l.id === id);
      expect(link).toBeTruthy();
      expect(link!.relatedAssetId).toBe(supportingAssetId2);
    });

    it('should list links as provider', async () => {
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id: uuidv7(), providerAssetId: supportingAssetId, dependentAssetId: supportingAssetId2,
      }]);

      const allLinksProvider = await services.withOrigin(adminOrigin).assetDependencies.getSupportToSupportLinks(supportingAssetId);
      const asProvider = allLinksProvider.filter((l) => l.direction === 'provides');
      expect(asProvider).toHaveLength(1);
      expect(asProvider[0].relatedAssetName).toBe('Web Server');

      const asDependent = allLinksProvider.filter((l) => l.direction === 'depends');
      expect(asDependent).toHaveLength(0);
    });

    it('should list links as dependent', async () => {
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id: uuidv7(), providerAssetId: supportingAssetId, dependentAssetId: supportingAssetId2,
      }]);

      const allLinksDependent = await services.withOrigin(adminOrigin).assetDependencies.getSupportToSupportLinks(supportingAssetId2);
      const asDependent = allLinksDependent.filter((l) => l.direction === 'depends');
      expect(asDependent).toHaveLength(1);
      expect(asDependent[0].relatedAssetName).toBe('Database Server');
    });

    it('should delete support-to-support links', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id, providerAssetId: supportingAssetId, dependentAssetId: supportingAssetId2,
      }]);

      await services.withOrigin(adminOrigin).assetDependencies.deleteSupportToSupportLinks([id]);

      const link = (await services.withOrigin(adminOrigin).assetDependencies.getSupportToSupportLinks(supportingAssetId)).find((l) => l.id === id);
      expect(link).toBeUndefined();
    });

    it('should reject a self-dependency', async () => {
      await expect(
        services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
          id: uuidv7(), providerAssetId: supportingAssetId, dependentAssetId: supportingAssetId,
        }]),
      ).rejects.toThrow('An asset cannot depend on itself');
    });

    it('should accept a pair already linked, keeping the stored link', async () => {
      const storedId = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id: storedId, providerAssetId: supportingAssetId, dependentAssetId: supportingAssetId2,
      }]);

      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id: uuidv7(), providerAssetId: supportingAssetId, dependentAssetId: supportingAssetId2,
      }]);

      const links = await services.withOrigin(adminOrigin).assetDependencies.getSupportToSupportLinks(supportingAssetId);
      expect(links.map((l) => l.id)).toEqual([storedId]);
    });

    it('should allow a reverse-direction link for the same asset pair (mutual dependency)', async () => {
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id: uuidv7(), providerAssetId: supportingAssetId, dependentAssetId: supportingAssetId2,
      }]);

      const reverseId = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id: reverseId, providerAssetId: supportingAssetId2, dependentAssetId: supportingAssetId,
      }]);

      const link = (await services.withOrigin(adminOrigin).assetDependencies.getSupportToSupportLinks(supportingAssetId)).find((l) => l.id === reverseId);
      expect(link).toBeTruthy();
    });

    it('should create every link of a batch', async () => {
      const cacheId = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: cacheId, name: 'Cache', description: null, ownerId: null, exposure: 'internal', categoryId: 'host',
      });

      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([
        { id: uuidv7(), providerAssetId: supportingAssetId2, dependentAssetId: supportingAssetId },
        { id: uuidv7(), providerAssetId: cacheId, dependentAssetId: supportingAssetId },
      ]);

      const providers = (await services.withOrigin(adminOrigin).assetDependencies.getSupportToSupportLinks(supportingAssetId))
        .filter((l) => l.direction === 'depends');
      expect(providers.map((l) => l.relatedAssetName).sort()).toEqual(['Cache', 'Web Server']);
    });

    it('should create none of a batch holding a self-dependency', async () => {
      await expect(
        services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([
          { id: uuidv7(), providerAssetId: supportingAssetId2, dependentAssetId: supportingAssetId },
          { id: uuidv7(), providerAssetId: supportingAssetId, dependentAssetId: supportingAssetId },
        ]),
      ).rejects.toThrow('An asset cannot depend on itself');
      expect(await services.withOrigin(adminOrigin).assetDependencies.getSupportToSupportLinks(supportingAssetId)).toHaveLength(0);
    });

    it('should create the rest of a batch holding a pair already linked', async () => {
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id: uuidv7(), providerAssetId: supportingAssetId2, dependentAssetId: supportingAssetId,
      }]);

      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([
        { id: uuidv7(), providerAssetId: supportingAssetId, dependentAssetId: supportingAssetId2 },
        { id: uuidv7(), providerAssetId: supportingAssetId2, dependentAssetId: supportingAssetId },
      ]);

      expect(await services.withOrigin(adminOrigin).assetDependencies.getSupportToSupportLinks(supportingAssetId)).toHaveLength(2);
    });

    it('should create the rest of a batch naming a deleted asset, and report its link gone', async () => {
      const deletedAssetId = await deletedSupportingAsset();

      const goneId = uuidv7();
      const outcome = await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([
        { id: uuidv7(), providerAssetId: supportingAssetId2, dependentAssetId: supportingAssetId },
        { id: goneId, providerAssetId: deletedAssetId, dependentAssetId: supportingAssetId },
      ]);

      expect(outcome).toEqual({ goneIds: [goneId] });
      const links = await services.withOrigin(adminOrigin).assetDependencies.getSupportToSupportLinks(supportingAssetId);
      expect(links.map((l) => l.relatedAssetId)).toEqual([supportingAssetId2]);
    });
  });
});
