import type { EventOrigin } from '@app/module';
import { primaryAssetReach, primaryAssets, supportingAssets, supportToPrimaryLinks } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('primary asset reach', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let organizationId: string;
  let otherOrganizationId: string;
  let primaryAssetId: string;
  let otherPrimaryAssetId: string;
  let chain: Array<string>;

  const as = (origin: EventOrigin) => services.withOrigin(origin);

  const jobOrigin = (forTenantId = tenantId): EventOrigin =>
    ({ type: 'job', tenantId: forTenantId, jobKind: 'primary-asset-reach-recompute', interactive: false });

  const runJob = (forTenantId = tenantId) => as(jobOrigin(forTenantId)).assetDependencies.recomputePrimaryAssetReach();

  const createOrganization = async (origin: EventOrigin, name: string) => {
    const id = uuidv7();
    await as(origin).organizations.createOrganizations([{ id, name }]);
    return id;
  };

  const createPrimaryAsset = async (origin: EventOrigin, forOrganizationId: string, name: string) => {
    const id = uuidv7();
    await as(origin).primaryAssets.createPrimaryAsset({
      id, organizationId: forOrganizationId, name, description: null, ownerId: null, businessValueCategoryIds: [],
    });
    return id;
  };

  const createSupportingAssets = async (origin: EventOrigin, count: number) => {
    const ids: Array<string> = [];
    for (let i = 0; i < count; i += 1) {
      const id = uuidv7();
      await as(origin).supportingAssets.createSupportingAsset({
        id, name: `Asset ${i}`, description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });
      ids.push(id);
    }
    return ids;
  };

  const linkToPrimary = (origin: EventOrigin, supportingAssetId: string, forPrimaryAssetId: string) =>
    as(origin).assetDependencies.createSupportToPrimaryLinks([{ id: uuidv7(), supportingAssetId, primaryAssetId: forPrimaryAssetId }]);

  const dependOn = (origin: EventOrigin, dependentAssetId: string, providerAssetId: string) =>
    as(origin).assetDependencies.createSupportToSupportLinks([{ id: uuidv7(), dependentAssetId, providerAssetId }]);

  const reachOf = async (forPrimaryAssetId: string) => {
    const rows = await db.select().from(primaryAssetReach).where(eq(primaryAssetReach.primaryAssetId, forPrimaryAssetId));
    return new Map(rows.map((row) => [row.supportingAssetId, row.depth]));
  };

  const allRows = () => db.select().from(primaryAssetReach);

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
    organizationId = await createOrganization(adminOrigin, 'Org');
    otherOrganizationId = await createOrganization(adminOrigin, 'Other Org');
    primaryAssetId = await createPrimaryAsset(adminOrigin, organizationId, 'Customer Data');
    otherPrimaryAssetId = await createPrimaryAsset(adminOrigin, organizationId, 'Payroll');

    // chain[0] is linked to the primary asset, chain[i + 1] provides for chain[i]: depths 0 to 6.
    chain = await createSupportingAssets(adminOrigin, 7);
    await linkToPrimary(adminOrigin, chain[0], primaryAssetId);
    for (let i = 0; i < chain.length - 1; i += 1) {
      await dependOn(adminOrigin, chain[i], chain[i + 1]);
    }
  });

  it('should reach the direct links and five provider levels through a cycle, and leave out depth 6', async () => {
    await dependOn(adminOrigin, chain[4], chain[1]);

    const outcome = await runJob();

    expect(await reachOf(primaryAssetId)).toEqual(new Map(chain.slice(0, 6).map((id, depth) => [id, depth])));
    expect(outcome).toEqual({ primaryAssets: 2, rows: 6, upserted: 6, deleted: 0 });
  });

  it('should keep one row per primary asset for an asset they share, each at its own shortest depth', async () => {
    await linkToPrimary(adminOrigin, chain[3], otherPrimaryAssetId);

    await runJob();

    expect((await reachOf(primaryAssetId)).get(chain[3])).toBe(3);
    expect(await reachOf(otherPrimaryAssetId)).toEqual(new Map([[chain[3], 0], [chain[4], 1], [chain[5], 2], [chain[6], 3]]));
    expect((await allRows()).filter((row) => row.supportingAssetId === chain[3])).toHaveLength(2);
  });

  it('should copy the organization of the primary asset onto each row', async () => {
    const elsewhere = await createPrimaryAsset(adminOrigin, otherOrganizationId, 'Elsewhere');
    await linkToPrimary(adminOrigin, chain[6], elsewhere);

    await runJob();

    const rows = await allRows();
    expect(new Set(rows.filter((row) => row.primaryAssetId === primaryAssetId).map((row) => row.organizationId))).toEqual(new Set([organizationId]));
    expect(rows.filter((row) => row.primaryAssetId === elsewhere)).toEqual([expect.objectContaining({ organizationId: otherOrganizationId, supportingAssetId: chain[6], depth: 0 })]);
  });

  it('should write a reach wider than one write batch, and nothing on the next run', async () => {
    const wide = Array.from({ length: 2_500 }, () => uuidv7());
    await db.insert(supportingAssets).values(wide.map((id, i) => ({ id, tenantId, name: `Wide ${i}`, categoryId: 'host' as const })));
    await db.insert(supportToPrimaryLinks).values(wide.map((supportingAssetId) => ({ id: uuidv7(), tenantId, supportingAssetId, primaryAssetId: otherPrimaryAssetId })));

    expect(await runJob()).toEqual({ primaryAssets: 2, rows: 2_506, upserted: 2_506, deleted: 0 });
    expect(await reachOf(otherPrimaryAssetId)).toEqual(new Map(wide.map((id) => [id, 0])));
    expect(await runJob()).toMatchObject({ upserted: 0, deleted: 0 });
  });

  it('should write nothing on a second run with nothing to change', async () => {
    await runJob();
    const before = await allRows();

    expect(await runJob()).toEqual({ primaryAssets: 2, rows: 6, upserted: 0, deleted: 0 });
    expect(await allRows()).toEqual(before);
  });

  it('should delete the rows a removed link carried', async () => {
    await runJob();
    const links = await as(adminOrigin).assetDependencies.getSupportToSupportLinks(chain[2]);

    await as(adminOrigin).assetDependencies.deleteSupportToSupportLinks(
      links.filter((link) => link.relatedAssetId === chain[3]).map((link) => link.id),
    );
    const outcome = await runJob();

    expect(await reachOf(primaryAssetId)).toEqual(new Map(chain.slice(0, 3).map((id, depth) => [id, depth])));
    expect(outcome).toMatchObject({ upserted: 0, deleted: 3 });
  });

  it('should empty the reach of a primary asset whose last link is removed', async () => {
    await runJob();
    const [link] = await as(adminOrigin).assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId(primaryAssetId);

    await as(adminOrigin).assetDependencies.deleteSupportToPrimaryLinks([link.id]);
    await runJob();

    expect(await reachOf(primaryAssetId)).toEqual(new Map());
  });

  it('should rewrite the organization of the rows of a primary asset moved to another organization', async () => {
    await runJob();

    await db.update(primaryAssets).set({ organizationId: otherOrganizationId }).where(eq(primaryAssets.id, primaryAssetId));
    const outcome = await runJob();

    const rows = (await allRows()).filter((row) => row.primaryAssetId === primaryAssetId);
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((row) => row.organizationId))).toEqual(new Set([otherOrganizationId]));
    expect(outcome).toMatchObject({ upserted: 6, deleted: 0 });
  });

  it('should leave another tenant\'s links unread and its rows untouched', async () => {
    const otherTenantId = await createTenant(services, adminUserId);
    const other = { tenantId: otherTenantId, origin: { type: 'client', userId: adminUserId, tenantId: otherTenantId } as const satisfies EventOrigin };
    const otherOrganization = await createOrganization(other.origin, 'Foreign Org');
    const foreignPrimary = await createPrimaryAsset(other.origin, otherOrganization, 'Foreign Data');
    const [foreignAsset] = await createSupportingAssets(other.origin, 1);
    await linkToPrimary(other.origin, foreignAsset, foreignPrimary);

    await runJob();

    expect(await reachOf(foreignPrimary)).toEqual(new Map());
    expect((await allRows()).every((row) => row.tenantId === tenantId)).toBe(true);

    await runJob(other.tenantId);
    expect(await reachOf(foreignPrimary)).toEqual(new Map([[foreignAsset, 0]]));
    expect(await reachOf(primaryAssetId)).toHaveProperty('size', 6);

    await as(other.origin).assetDependencies.deleteSupportToPrimaryLinks(
      (await as(other.origin).assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId(foreignPrimary)).map((link) => link.id),
    );
    await runJob(other.tenantId);
    expect(await reachOf(foreignPrimary)).toEqual(new Map());
    expect(await reachOf(primaryAssetId)).toHaveProperty('size', 6);
  });

  it('should refuse an origin that is not a job', async () => {
    await expect(as(adminOrigin).assetDependencies.recomputePrimaryAssetReach()).rejects.toThrow('recomputed by its job alone');
    expect(await allRows()).toEqual([]);
  });

  it('should drop a primary asset\'s rows with the asset', async () => {
    await runJob();

    await as(adminOrigin).primaryAssets.deletePrimaryAssets([primaryAssetId]);

    expect(await reachOf(primaryAssetId)).toEqual(new Map());
  });
});
