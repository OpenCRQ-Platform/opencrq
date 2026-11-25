import type { EventOrigin } from '@app/module';
import { primaryToPrimaryLinks } from '@app/module';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Primary-to-primary links', () => {
  let adminOrigin: EventOrigin;
  let adminTenantId: string;
  let adminUserId: string;
  let organizationId: string;
  let billingId: string;
  let ordersId: string;
  let treasuryId: string;

  const createPrimaryAsset = async (origin: EventOrigin, organization: string, name: string) => {
    const id = uuidv7();
    await services.withOrigin(origin).primaryAssets.createPrimaryAsset({
      id, organizationId: organization, name, description: null, ownerId: null, businessValueCategoryIds: [],
    });
    return id;
  };

  const createOrganization = async (origin: EventOrigin, name: string) => {
    const id = uuidv7();
    await services.withOrigin(origin).organizations.createOrganizations([{ id, name }]);
    return id;
  };

  const otherTenantOrigin = async (): Promise<EventOrigin> =>
    ({ type: 'client', userId: adminUserId, tenantId: await createTenant(services, adminUserId) });

  const linksOf = (primaryAssetId: string) => services.withOrigin(adminOrigin).assetDependencies.getPrimaryToPrimaryLinks(primaryAssetId);

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminTenantId = setup.tenantId;
    adminUserId = setup.userId;
    organizationId = await createOrganization(adminOrigin, 'Test Org');
    billingId = await createPrimaryAsset(adminOrigin, organizationId, 'Billing');
    ordersId = await createPrimaryAsset(adminOrigin, organizationId, 'Order management');
    treasuryId = await createPrimaryAsset(adminOrigin, organizationId, 'Treasury');
  });

  describe('CRUD', () => {
    it('should read a link from both of its ends', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([{
        id, dependentAssetId: billingId, providerAssetId: ordersId, strength: 'critical',
      }]);

      expect(await linksOf(billingId)).toEqual([
        { id, direction: 'depends', relatedAssetId: ordersId, relatedAssetName: 'Order management', strength: 'critical' },
      ]);
      expect(await linksOf(ordersId)).toEqual([
        { id, direction: 'provides', relatedAssetId: billingId, relatedAssetName: 'Billing', strength: 'critical' },
      ]);
    });

    it('should store a link created without a strength as unknown', async () => {
      await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([{
        id: uuidv7(), dependentAssetId: billingId, providerAssetId: ordersId,
      }]);

      expect((await linksOf(billingId)).map((link) => link.strength)).toEqual(['unknown']);
    });

    it('should change the strength of every link of a batch, each to its own', async () => {
      const toOrders = uuidv7();
      const toTreasury = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([
        { id: toOrders, dependentAssetId: billingId, providerAssetId: ordersId },
        { id: toTreasury, dependentAssetId: billingId, providerAssetId: treasuryId },
      ]);

      await services.withOrigin(adminOrigin).assetDependencies.updatePrimaryToPrimaryLinks([
        { id: toOrders, strength: 'important' },
        { id: toTreasury, strength: 'minor' },
      ]);

      expect((await linksOf(billingId)).map((link) => [link.relatedAssetName, link.strength]))
        .toEqual([['Order management', 'important'], ['Treasury', 'minor']]);
    });

    it('should update the rest of a batch naming a link that is gone', async () => {
      const id = uuidv7();
      const goneId = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([
        { id, dependentAssetId: billingId, providerAssetId: ordersId },
        { id: goneId, dependentAssetId: billingId, providerAssetId: treasuryId },
      ]);
      await services.withOrigin(adminOrigin).assetDependencies.deletePrimaryToPrimaryLinks([goneId]);

      const outcome = await services.withOrigin(adminOrigin).assetDependencies.updatePrimaryToPrimaryLinks([
        { id, strength: 'critical' },
        { id: goneId, strength: 'critical' },
      ]);

      expect(outcome.skippedIds).toEqual([goneId]);
      expect((await linksOf(billingId)).map((link) => [link.id, link.strength])).toEqual([[id, 'critical']]);
    });

    it('should delete a link', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([{
        id, dependentAssetId: billingId, providerAssetId: ordersId,
      }]);

      await services.withOrigin(adminOrigin).assetDependencies.deletePrimaryToPrimaryLinks([id]);

      expect(await linksOf(billingId)).toEqual([]);
    });
  });

  describe('rules', () => {
    it('should keep a mutual pair as two links, each with its own strength', async () => {
      await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([
        { id: uuidv7(), dependentAssetId: billingId, providerAssetId: ordersId, strength: 'critical' },
        { id: uuidv7(), dependentAssetId: ordersId, providerAssetId: billingId, strength: 'minor' },
      ]);

      expect((await linksOf(billingId)).map((link) => [link.direction, link.strength]).sort())
        .toEqual([['depends', 'critical'], ['provides', 'minor']]);
    });

    it('should skip a pair already linked, keeping the stored strength', async () => {
      const storedId = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([{
        id: storedId, dependentAssetId: billingId, providerAssetId: ordersId, strength: 'critical',
      }]);

      const replayedId = uuidv7();
      const outcome = await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([{
        id: replayedId, dependentAssetId: billingId, providerAssetId: ordersId, strength: 'minor',
      }]);

      expect(outcome).toEqual({ skippedIds: [replayedId], goneIds: [] });
      expect((await linksOf(billingId)).map((link) => [link.id, link.strength])).toEqual([[storedId, 'critical']]);
    });

    it('should create the rest of a batch naming a deleted primary asset, and report its link gone', async () => {
      const retiredId = await createPrimaryAsset(adminOrigin, organizationId, 'Retired');
      await services.withOrigin(adminOrigin).primaryAssets.deletePrimaryAssets([retiredId]);

      const goneId = uuidv7();
      const outcome = await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([
        { id: uuidv7(), dependentAssetId: billingId, providerAssetId: ordersId },
        { id: goneId, dependentAssetId: billingId, providerAssetId: retiredId },
      ]);

      expect(outcome).toEqual({ skippedIds: [], goneIds: [goneId] });
      expect((await linksOf(billingId)).map((link) => link.relatedAssetId)).toEqual([ordersId]);
    });

    it('should report the outcome of ids written in upper case against what it stored', async () => {
      const storedId = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([{
        id: storedId, dependentAssetId: billingId, providerAssetId: ordersId,
      }]);

      const created = await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([{
        id: uuidv7().toUpperCase(), dependentAssetId: billingId.toUpperCase(), providerAssetId: treasuryId.toUpperCase(),
      }]);
      const updated = await services.withOrigin(adminOrigin).assetDependencies.updatePrimaryToPrimaryLinks([
        { id: storedId.toUpperCase(), strength: 'minor' },
      ]);

      expect([created, updated]).toEqual([{ skippedIds: [], goneIds: [] }, { skippedIds: [] }]);
      expect((await linksOf(billingId)).map((link) => [link.relatedAssetName, link.strength]))
        .toEqual([['Order management', 'minor'], ['Treasury', 'unknown']]);
    });

    it('should apply two batches crossing the same links in opposite orders', async () => {
      const toOrders = uuidv7();
      const toTreasury = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([
        { id: toOrders, dependentAssetId: billingId, providerAssetId: ordersId },
        { id: toTreasury, dependentAssetId: billingId, providerAssetId: treasuryId },
      ]);

      const outcomes = await Promise.all([
        services.withOrigin(adminOrigin).assetDependencies.updatePrimaryToPrimaryLinks([{ id: toOrders, strength: 'critical' }, { id: toTreasury, strength: 'minor' }]),
        services.withOrigin(adminOrigin).assetDependencies.updatePrimaryToPrimaryLinks([{ id: toTreasury, strength: 'critical' }, { id: toOrders, strength: 'minor' }]),
      ]);

      expect(outcomes).toEqual([{ skippedIds: [] }, { skippedIds: [] }]);
    });

    it('should create none of a batch holding a self-dependency', async () => {
      await expect(
        services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([
          { id: uuidv7(), dependentAssetId: billingId, providerAssetId: ordersId },
          { id: uuidv7(), dependentAssetId: billingId, providerAssetId: billingId },
        ]),
      ).rejects.toThrow('A primary asset cannot depend on itself');
      expect(await linksOf(billingId)).toEqual([]);
    });

    it('should create none of a batch linking two organizations', async () => {
      const otherOrganizationId = await createOrganization(adminOrigin, 'Subsidiary');
      const payrollId = await createPrimaryAsset(adminOrigin, otherOrganizationId, 'Payroll');

      await expect(
        services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([
          { id: uuidv7(), dependentAssetId: billingId, providerAssetId: ordersId },
          { id: uuidv7(), dependentAssetId: billingId, providerAssetId: payrollId },
        ]),
      ).rejects.toThrow('of its own organization');
      expect(await linksOf(billingId)).toEqual([]);
    });

    it('should delete every link of a primary asset, both ways, with it', async () => {
      await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([
        { id: uuidv7(), dependentAssetId: billingId, providerAssetId: ordersId },
        { id: uuidv7(), dependentAssetId: treasuryId, providerAssetId: ordersId },
        { id: uuidv7(), dependentAssetId: ordersId, providerAssetId: treasuryId },
      ]);

      await services.withOrigin(adminOrigin).primaryAssets.deletePrimaryAssets([ordersId]);

      expect([...await linksOf(billingId), ...await linksOf(treasuryId)]).toEqual([]);
    });
  });

  describe('database constraints', () => {
    it('should refuse a self-dependency in the database', async () => {
      await expect(
        db.insert(primaryToPrimaryLinks).values({ id: uuidv7(), tenantId: adminTenantId, dependentAssetId: billingId, providerAssetId: billingId }),
      ).rejects.toThrow();
    });

    it('should refuse a strength outside the closed list in the database', async () => {
      await expect(
        db.execute(sql`INSERT INTO primary_to_primary_links (id, tenant_id, dependent_asset_id, provider_asset_id, strength)
          VALUES (${uuidv7()}, ${adminTenantId}, ${billingId}, ${ordersId}, 'hard')`),
      ).rejects.toThrow();
    });
  });

  describe('graph', () => {
    let paymentsId: string;
    let reportingId: string;

    const link = (dependentAssetId: string, providerAssetId: string, strength: 'critical' | 'important' | 'minor' | 'unknown' = 'unknown') => ({
      id: uuidv7(), dependentAssetId, providerAssetId, strength,
    });
    const graphOf = (primaryAssetId: string, depth: number) =>
      services.withOrigin(adminOrigin).assetDependencies.getPrimaryToPrimaryLinkGraph(primaryAssetId, depth);
    const namesOf = (graph: Awaited<ReturnType<typeof graphOf>>) => graph.primaryAssets.map((asset) => asset.name).sort();
    const pairsOf = (graph: Awaited<ReturnType<typeof graphOf>>, nameOf: Map<string, string>) =>
      graph.links.map((row) => `${nameOf.get(row.dependentId)} > ${nameOf.get(row.providerId)} ${row.strength}`).sort();

    beforeEach(async () => {
      paymentsId = await createPrimaryAsset(adminOrigin, organizationId, 'Payments');
      reportingId = await createPrimaryAsset(adminOrigin, organizationId, 'Reporting');
    });

    it('should walk what an asset depends on and what depends on it, two levels each way', async () => {
      const auditId = await createPrimaryAsset(adminOrigin, organizationId, 'Audit');
      await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([
        link(billingId, ordersId, 'critical'),
        link(ordersId, treasuryId, 'important'),
        link(paymentsId, billingId, 'minor'),
        link(reportingId, paymentsId),
        link(auditId, ordersId),
      ]);

      const graph = await graphOf(billingId, 3);

      const nameOf = new Map([[billingId, 'Billing'], [ordersId, 'Orders'], [treasuryId, 'Treasury'], [paymentsId, 'Payments'], [reportingId, 'Reporting']]);
      expect(namesOf(graph)).toEqual(['Order management', 'Payments', 'Reporting', 'Treasury']);
      expect(pairsOf(graph, nameOf)).toEqual([
        'Billing > Orders critical',
        'Orders > Treasury important',
        'Payments > Billing minor',
        'Reporting > Payments unknown',
      ]);
      expect(graph.truncated).toEqual([]);
    });

    it('should stop each side at the depth and count the primary assets it left past each last asset', async () => {
      await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([
        link(billingId, ordersId),
        link(ordersId, treasuryId),
        link(paymentsId, billingId),
        link(reportingId, paymentsId),
      ]);

      const graph = await graphOf(billingId, 1);

      expect(namesOf(graph)).toEqual(['Order management', 'Payments']);
      expect(graph.links).toHaveLength(2);
      expect(graph.truncated).toEqual(expect.arrayContaining([
        { assetId: ordersId, hiddenCount: 1, side: 'provider' },
        { assetId: paymentsId, hiddenCount: 1, side: 'dependent' },
      ]));
      expect(graph.truncated).toHaveLength(2);
    });

    it('should end on a cycle, and keep the dependents of an asset the cycle puts on both sides', async () => {
      await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([
        link(billingId, ordersId),
        link(ordersId, treasuryId),
        link(treasuryId, billingId),
        link(reportingId, treasuryId),
      ]);

      const graph = await graphOf(billingId, 6);

      expect(namesOf(graph)).toEqual(['Order management', 'Reporting', 'Treasury']);
      expect(graph.links).toHaveLength(4);
      expect(graph.truncated).toEqual([]);
    });

    it('should draw the link between two assets of the walk that neither side followed', async () => {
      await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([
        link(billingId, ordersId),
        link(paymentsId, billingId),
        link(paymentsId, ordersId, 'critical'),
      ]);

      const graph = await graphOf(billingId, 1);

      expect(graph.links.map((row) => [row.dependentId, row.providerId, row.strength])).toContainEqual([paymentsId, ordersId, 'critical']);
      expect(graph.links).toHaveLength(3);
    });

    it('should return no primary asset for an asset no link reaches', async () => {
      expect(await graphOf(billingId, 3)).toEqual({ primaryAssets: [], links: [], truncated: [] });
    });

    it('should refuse a primary asset of another tenant', async () => {
      await expect(
        services.withOrigin(await otherTenantOrigin()).assetDependencies.getPrimaryToPrimaryLinkGraph(billingId, 3),
      ).rejects.toThrow('Primary asset not found');
    });
  });

  describe('tenant isolation', () => {
    it('should refuse a link naming another tenant\'s primary asset in the database', async () => {
      const otherOrigin = await otherTenantOrigin();
      const otherOrganizationId = await createOrganization(otherOrigin, 'Other Org');
      const foreignId = await createPrimaryAsset(otherOrigin, otherOrganizationId, 'Foreign process');

      await expect(
        db.insert(primaryToPrimaryLinks).values({ id: uuidv7(), tenantId: adminTenantId, dependentAssetId: billingId, providerAssetId: foreignId }),
      ).rejects.toThrow();
    });

    it('should report a link naming another tenant\'s primary asset gone, and store nothing', async () => {
      const otherOrigin = await otherTenantOrigin();
      const otherOrganizationId = await createOrganization(otherOrigin, 'Other Org');
      const foreignId = await createPrimaryAsset(otherOrigin, otherOrganizationId, 'Foreign process');

      const goneId = uuidv7();
      const outcome = await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([
        { id: goneId, dependentAssetId: billingId, providerAssetId: foreignId },
      ]);

      expect(outcome).toEqual({ skippedIds: [], goneIds: [goneId] });
      expect(await linksOf(billingId)).toEqual([]);
    });

    it('should neither read, update nor delete another tenant\'s links', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).assetDependencies.createPrimaryToPrimaryLinks([{
        id, dependentAssetId: billingId, providerAssetId: ordersId, strength: 'critical',
      }]);
      const otherOrigin = await otherTenantOrigin();
      const otherServices = services.withOrigin(otherOrigin).assetDependencies;

      expect(await otherServices.getPrimaryToPrimaryLinks(billingId)).toEqual([]);
      expect(await otherServices.updatePrimaryToPrimaryLinks([{ id, strength: 'minor' }])).toEqual({ skippedIds: [id] });
      await otherServices.deletePrimaryToPrimaryLinks([id]);

      expect((await linksOf(billingId)).map((link) => link.strength)).toEqual(['critical']);
    });
  });
});
