import type { AssetCategory, AssetSubcategory, DeclaredEstateAnswer, EventOrigin } from '@app/module';
import { declaredEstate, declaredEstateEvents, supportingAssetIdentityProperties, supportingAssets, supportingAssetSources } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const answer = (kind: DeclaredEstateAnswer['kind'], low: number, high: number, internetFacing: boolean | null = null): DeclaredEstateAnswer =>
  ({ kind, bounds: { low, high }, internetFacing });

describe('Declared estate service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let organizationId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
    organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Scope' }]);
  });

  const estateOf = async (origin: EventOrigin = adminOrigin) => services.withOrigin(origin).declaredEstate.getDeclaredEstate(organizationId);
  const kindOf = async (kind: DeclaredEstateAnswer['kind']) => (await estateOf()).find((row) => row.kind === kind)!;

  describe('answers', () => {
    it('should list every kind unanswered before any save', async () => {
      const estate = await estateOf();

      expect(estate).toHaveLength(12);
      expect(estate.every((row) => row.bounds === null && row.internetFacing === null && row.setAt === null)).toBe(true);
    });

    it('should store a range, an exact number as two equal bounds, and the exposure, with who saved them and when', async () => {
      await services.withOrigin(adminOrigin).declaredEstate.saveDeclaredEstate(organizationId, [
        answer('workstations', 1001, 5000),
        answer('servers', 180, 180, true),
      ]);

      const workstations = await kindOf('workstations');
      const servers = await kindOf('servers');
      expect(workstations.bounds).toEqual({ low: 1001, high: 5000 });
      expect(servers).toMatchObject({ bounds: { low: 180, high: 180 }, internetFacing: true, setByName: expect.any(String) });
      expect(servers.setAt).toBeInstanceOf(Date);
    });

    it('should leave the kinds a save does not send as they were', async () => {
      const scoped = services.withOrigin(adminOrigin).declaredEstate;
      await scoped.saveDeclaredEstate(organizationId, [answer('workstations', 51, 250), answer('people', 251, 1000)]);
      await scoped.saveDeclaredEstate(organizationId, [answer('people', 300, 300)]);

      expect((await kindOf('workstations')).bounds).toEqual({ low: 51, high: 250 });
      expect((await kindOf('people')).bounds).toEqual({ low: 300, high: 300 });
    });

    it('should clear a kind sent with null bounds', async () => {
      const scoped = services.withOrigin(adminOrigin).declaredEstate;
      await scoped.saveDeclaredEstate(organizationId, [answer('servers', 11, 50, true)]);
      await scoped.saveDeclaredEstate(organizationId, [{ kind: 'servers', bounds: null, internetFacing: null }]);

      expect(await kindOf('servers')).toMatchObject({ bounds: null, internetFacing: null, setAt: null });
    });

    it('should refuse a scope that does not exist', async () => {
      await expect(services.withOrigin(adminOrigin).declaredEstate.saveDeclaredEstate(uuidv7(), [answer('servers', 1, 10)]))
        .rejects.toThrow('Risk scope not found');
    });

    it('should go with its risk scope', async () => {
      await services.withOrigin(adminOrigin).declaredEstate.saveDeclaredEstate(organizationId, [answer('servers', 1, 10)]);
      await services.withOrigin(adminOrigin).organizations.deleteOrganizations([organizationId]);

      expect(await db.select().from(declaredEstate).where(eq(declaredEstate.organizationId, organizationId))).toEqual([]);
      expect(await db.select().from(declaredEstateEvents).where(eq(declaredEstateEvents.organizationId, organizationId))).toEqual([]);
    });
  });

  describe('journal', () => {
    it('should write one event per kind changed, with its author and the answer before and after', async () => {
      const scoped = services.withOrigin(adminOrigin).declaredEstate;
      await scoped.saveDeclaredEstate(organizationId, [answer('servers', 11, 50, false)]);
      await scoped.saveDeclaredEstate(organizationId, [answer('servers', 51, 250, true), answer('workstations', 1, 10)]);

      const history = await scoped.getDeclaredEstateHistory(organizationId);
      expect(history.map((event) => event.kind).toSorted()).toEqual(['servers', 'servers', 'workstations']);
      const latestServers = history.find((event) => event.kind === 'servers' && event.after.bounds?.low === 51)!;
      expect(latestServers.before).toEqual({ bounds: { low: 11, high: 50 }, internetFacing: false });
      expect(latestServers.after).toEqual({ bounds: { low: 51, high: 250 }, internetFacing: true });
      const rows = await db.select().from(declaredEstateEvents).where(eq(declaredEstateEvents.organizationId, organizationId));
      expect(rows.every((row) => row.userId === adminUserId)).toBe(true);
    });

    it('should journal nothing and write nothing for a save repeating the stored answers', async () => {
      const scoped = services.withOrigin(adminOrigin).declaredEstate;
      await scoped.saveDeclaredEstate(organizationId, [answer('servers', 11, 50, true)]);
      const before = await kindOf('servers');
      await scoped.saveDeclaredEstate(organizationId, [answer('servers', 11, 50, true)]);

      expect(await scoped.getDeclaredEstateHistory(organizationId)).toHaveLength(1);
      expect((await kindOf('servers')).setAt).toEqual(before.setAt);
    });

    it('should chain two saves of one kind made at once, the later one reading what the earlier wrote', async () => {
      const scoped = services.withOrigin(adminOrigin).declaredEstate;
      await scoped.saveDeclaredEstate(organizationId, [answer('servers', 1, 10)]);
      await Promise.all([
        scoped.saveDeclaredEstate(organizationId, [answer('servers', 11, 50)]),
        scoped.saveDeclaredEstate(organizationId, [answer('servers', 51, 250)]),
      ]);

      const [first, second, third] = (await scoped.getDeclaredEstateHistory(organizationId)).toSorted((a, b) => a.id.localeCompare(b.id));
      expect(second.before.bounds).toEqual(first.after.bounds);
      expect(third.before.bounds).toEqual(second.after.bounds);
      expect((await kindOf('servers')).bounds).toEqual(third.after.bounds);
    });

    it('should journal a cleared kind with no answer after', async () => {
      const scoped = services.withOrigin(adminOrigin).declaredEstate;
      await scoped.saveDeclaredEstate(organizationId, [answer('servers', 11, 50)]);
      await scoped.saveDeclaredEstate(organizationId, [{ kind: 'servers', bounds: null, internetFacing: null }]);

      const [latest] = await scoped.getDeclaredEstateHistory(organizationId);
      expect(latest.after).toEqual({ bounds: null, internetFacing: null });
    });
  });

  describe('comparison', () => {
    const asset = async (categoryId: AssetCategory, subcategoryId: AssetSubcategory | null, enabled: boolean | null = null) => {
      const id = uuidv7();
      await db.insert(supportingAssets).values({ id, tenantId, name: `Asset ${id}`, exposure: 'internal', categoryId, subcategoryId, criticality: 'low' });
      if (enabled !== null) {
        const sourceId = uuidv7();
        await db.insert(supportingAssetSources).values({ id: sourceId, supportingAssetId: id, tenantId, sourceAssetId: id, reportedCategoryId: categoryId });
        await db.insert(supportingAssetIdentityProperties).values({ id: sourceId, supportingAssetSourceId: sourceId, tenantId, isEnabled: enabled });
      }
      return id;
    };

    const comparisonOf = async (scopeId: string = organizationId, origin: EventOrigin = adminOrigin) =>
      services.withOrigin(origin).declaredEstate.getDeclaredEstateComparison(scopeId);
    const kindIn = (comparison: Awaited<ReturnType<typeof comparisonOf>>, kind: DeclaredEstateAnswer['kind']) =>
      comparison.kinds.find((entry) => entry.kind === kind)!;

    it('should count the measured assets into kinds as the engine does', async () => {
      await asset('host', 'laptop');
      await asset('host', null);
      await asset('identity', 'user_account', true);
      await asset('identity', 'user_account', false);
      await asset('identity', 'user_account');
      await asset('identity', 'group', true);
      await asset('cloud_resource', 'iam_principal');
      await asset('generic_asset', null);

      const comparison = await comparisonOf();

      expect(kindIn(comparison, 'workstations').measured).toBe(2);
      expect(kindIn(comparison, 'people').measured).toBe(2);
      expect(kindIn(comparison, 'cloud_resources').measured).toBe(1);
      expect(comparison.kinds.reduce((sum, entry) => sum + entry.measured, 0)).toBe(5);
    });

    it('should read a measure below, within and above its bounds, and nothing measured as neutral', async () => {
      await asset('host', 'server');
      await asset('host', 'server');
      await asset('host', 'workstation');
      await asset('mobile_device', null);
      await asset('mobile_device', null);
      await services.withOrigin(adminOrigin).declaredEstate.saveDeclaredEstate(organizationId, [
        answer('servers', 1, 10),
        answer('workstations', 11, 50),
        answer('mobile_devices', 1, 1),
        answer('people', 51, 250),
      ]);

      const comparison = await comparisonOf();

      expect(kindIn(comparison, 'servers')).toMatchObject({ bounds: { low: 1, high: 10 }, measured: 2, state: 'within' });
      expect(kindIn(comparison, 'workstations').state).toBe('below');
      expect(kindIn(comparison, 'mobile_devices').state).toBe('above');
      expect(kindIn(comparison, 'people')).toMatchObject({ measured: 0, state: 'none_measured' });
      expect(kindIn(comparison, 'containers')).toMatchObject({ bounds: null, state: 'not_declared' });
      expect(comparison.declaredAt).toBeInstanceOf(Date);
    });

    it('should measure a closed scope on the assets it maps only', async () => {
      const mapped = await asset('host', 'server');
      await asset('host', 'server');
      const closedId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: closedId, name: 'Closed', estateMode: 'closed', mappedAssetIds: [mapped] }]);

      const closed = await comparisonOf(closedId);
      expect(kindIn(closed, 'servers').measured).toBe(1);
      expect(kindIn(await comparisonOf(), 'servers').measured).toBe(2);
    });

    it('should measure the whole tenant with no scope, every kind undeclared', async () => {
      await asset('host', 'server');
      await asset('host', 'server');
      const closedId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: closedId, name: 'Closed', estateMode: 'closed', mappedAssetIds: [] }]);
      await services.withOrigin(adminOrigin).declaredEstate.saveDeclaredEstate(closedId, [answer('servers', 1, 1)]);

      const tenant = await services.withOrigin(adminOrigin).declaredEstate.getDeclaredEstateComparison(null);

      expect(kindIn(tenant, 'servers')).toMatchObject({ measured: 2, bounds: null, state: 'not_declared' });
      expect(tenant.kinds.every((entry) => entry.bounds === null)).toBe(true);
      expect(tenant.declaredAt).toBeNull();
    });

    it('should date nothing when nothing is declared', async () => {
      expect((await comparisonOf()).declaredAt).toBeNull();
    });

    it('should date the declaration by its last save, one that only cleared an answer included', async () => {
      const scoped = services.withOrigin(adminOrigin).declaredEstate;
      await scoped.saveDeclaredEstate(organizationId, [answer('workstations', 51, 250)]);
      await scoped.saveDeclaredEstate(organizationId, [answer('servers', 11, 50)]);
      const kept = (await kindOf('workstations')).setAt!;
      await scoped.saveDeclaredEstate(organizationId, [{ kind: 'servers', bounds: null, internetFacing: null }]);

      const [clearing] = await scoped.getDeclaredEstateHistory(organizationId);
      const { declaredAt } = await comparisonOf();
      expect(declaredAt).toEqual(clearing.createdAt);
      expect(declaredAt!.getTime()).toBeGreaterThan(kept.getTime());

      await scoped.saveDeclaredEstate(organizationId, [{ kind: 'workstations', bounds: null, internetFacing: null }]);
      expect((await comparisonOf()).declaredAt).toBeNull();
    });

    it('should refuse a scope that does not exist', async () => {
      await expect(comparisonOf(uuidv7())).rejects.toThrow('Risk scope not found');
    });
  });

  describe('tenant isolation', () => {
    it('should not show a declaration to another tenant', async () => {
      await services.withOrigin(adminOrigin).declaredEstate.saveDeclaredEstate(organizationId, [answer('servers', 11, 50)]);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: await createTenant(services, adminUserId) };

      expect((await estateOf(otherOrigin)).every((row) => row.bounds === null)).toBe(true);
      expect(await services.withOrigin(otherOrigin).declaredEstate.getDeclaredEstateHistory(organizationId)).toEqual([]);
    });

    it('should neither compare a scope of another tenant nor count its assets', async () => {
      await services.withOrigin(adminOrigin).declaredEstate.saveDeclaredEstate(organizationId, [answer('servers', 11, 50)]);
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const otherScopeId = uuidv7();
      await services.withOrigin(otherOrigin).organizations.createOrganizations([{ id: otherScopeId, name: 'Other scope' }]);
      await db.insert(supportingAssets).values({ id: uuidv7(), tenantId: otherTenantId, name: 'Other server', exposure: 'internal', categoryId: 'host', subcategoryId: 'server', criticality: 'low' });

      await expect(services.withOrigin(otherOrigin).declaredEstate.getDeclaredEstateComparison(organizationId)).rejects.toThrow('Risk scope not found');
      const own = await services.withOrigin(adminOrigin).declaredEstate.getDeclaredEstateComparison(organizationId);
      expect(own.kinds.find((entry) => entry.kind === 'servers')).toMatchObject({ measured: 0, state: 'none_measured' });
    });

    it('should refuse another tenant writing a declaration on a scope it cannot see', async () => {
      await services.withOrigin(adminOrigin).declaredEstate.saveDeclaredEstate(organizationId, [answer('servers', 11, 50)]);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: await createTenant(services, adminUserId) };

      await expect(services.withOrigin(otherOrigin).declaredEstate.saveDeclaredEstate(organizationId, [answer('servers', 1, 1)]))
        .rejects.toThrow('Risk scope not found');
      expect((await kindOf('servers')).bounds).toEqual({ low: 11, high: 50 });
    });

    it('should refuse a row naming another tenant\'s scope, even written past the service', async () => {
      const otherTenantId = await createTenant(services, adminUserId);

      await expect(db.insert(declaredEstate).values({ tenantId: otherTenantId, organizationId, kind: 'servers', low: 1, high: 1 }))
        .rejects.toThrow();
    });
  });
});
