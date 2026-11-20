import type { EventOrigin } from '@app/module';
import { financialProfileEvents, organizationAssetMappingEvents, organizationIdentityEvents } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { EMPTY_ANSWERS } from '../../helpers/financial-profile-answers';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Risk scope change journals', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let organizationId: string;

  const createAsset = async (name: string, mapIntoOrganizationId: string | null = null) => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
      id, name, description: null, ownerId: null, exposure: 'unknown', categoryId: 'host', mapIntoOrganizationId,
    });
    return id;
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Scope' }]);
  });

  describe('financial profile', () => {
    const save = async (answers: Partial<typeof EMPTY_ANSWERS>) =>
      services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, { ...EMPTY_ANSWERS, ...answers });
    const history = async () => services.withOrigin(adminOrigin).financialProfiles.getFinancialProfileHistory(organizationId);

    it('should journal each answer a save changes, typed, with its author', async () => {
      await save({ annualRevenue: 50_000_000, operatingDaysBand: 'about_250', recordsHeldGate: true });
      await save({ annualRevenue: 80_000_000, operatingDaysBand: 'about_250', recordsHeldGate: false });

      const events = await history();
      expect(events.map((event) => [event.field, event.before, event.after]).toSorted()).toEqual([
        ['annualRevenue', 50_000_000, 80_000_000],
        ['annualRevenue', null, 50_000_000],
        ['operatingDaysBand', null, 'about_250'],
        ['recordsHeldGate', null, true],
        ['recordsHeldGate', true, false],
      ].toSorted());
      expect(events.every((event) => event.userName !== null)).toBe(true);
      const rows = await db.select().from(financialProfileEvents).where(eq(financialProfileEvents.organizationId, organizationId));
      expect(rows.every((row) => row.userId === adminUserId)).toBe(true);
    });

    it('should journal nothing for a save repeating the stored answers', async () => {
      await save({ grossMarginPct: 40 });
      await save({ grossMarginPct: 40 });

      expect(await history()).toHaveLength(1);
    });

    it('should journal the detail a closed gate clears', async () => {
      await save({ recordsHeldGate: true, individualsBand: '100k_500k' });
      await save({ recordsHeldGate: false, individualsBand: '100k_500k' });

      const latest = (await history()).filter((event) => event.before !== null);
      expect(latest.map((event) => [event.field, event.after]).toSorted()).toEqual([['individualsBand', null], ['recordsHeldGate', false]]);
    });

    it('should leave the identity journal untouched when the revenue rewrites the revenue band', async () => {
      await save({ annualRevenue: 50_000_000 });

      expect(await services.withOrigin(adminOrigin).organizations.getIdentityHistory(organizationId)).toEqual([]);
    });
  });

  describe('identity', () => {
    const history = async () => services.withOrigin(adminOrigin).organizations.getIdentityHistory(organizationId);

    it('should journal each identity field a save changes', async () => {
      const [sector] = await services.withOrigin(adminOrigin).sectors.getSectors();
      await services.withOrigin(adminOrigin).organizations.updateOrganization(organizationId, {
        name: 'Renamed', sectorId: sector.id, employeeCount: 120, description: null,
      });

      const events = await history();
      expect(events.map((event) => [event.field, event.before, event.after]).toSorted()).toEqual([
        ['employeeCount', null, 120],
        ['name', 'Scope', 'Renamed'],
        ['sectorId', null, sector.id],
      ]);
      const rows = await db.select().from(organizationIdentityEvents).where(eq(organizationIdentityEvents.organizationId, organizationId));
      expect(rows.every((row) => row.userId === adminUserId)).toBe(true);
    });

    it('should journal the three reaction times as one field', async () => {
      const scoped = services.withOrigin(adminOrigin).organizations;
      await scoped.updateOrganization(organizationId, { reactionTimeMin: 1, reactionTimeLikely: 4, reactionTimeMax: 12 });
      await scoped.updateOrganization(organizationId, { reactionTimeMin: 1, reactionTimeLikely: 6, reactionTimeMax: 12 });
      await scoped.updateOrganization(organizationId, { reactionTimeMin: null, reactionTimeLikely: null, reactionTimeMax: null });

      const events = (await history()).toSorted((a, b) => a.id.localeCompare(b.id));
      expect(events.map((event) => [event.field, event.before, event.after])).toEqual([
        ['reactionTime', null, [1, 4, 12]],
        ['reactionTime', [1, 4, 12], [1, 6, 12]],
        ['reactionTime', [1, 6, 12], null],
      ]);
    });

    it('should journal nothing for a save repeating the stored identity', async () => {
      await services.withOrigin(adminOrigin).organizations.updateOrganization(organizationId, { name: 'Scope', employeeCount: null });

      expect(await history()).toEqual([]);
    });

    it('should not show a scope journal to another tenant', async () => {
      const asset = await createAsset('a');
      await services.withOrigin(adminOrigin).organizations.updateOrganization(organizationId, { name: 'Renamed', mapping: { added: [asset], removed: [] } });
      await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, { ...EMPTY_ANSWERS, grossMarginPct: 40 });
      const [mappingEvent] = await services.withOrigin(adminOrigin).organizations.getAssetMappingHistory(organizationId);
      expect(await services.withOrigin(adminOrigin).organizations.getAssetMappingEventAssets(mappingEvent.id)).toHaveLength(1);
      const otherTenantId = await createTenant(services, adminUserId);
      const other = services.withOrigin({ type: 'client', tenantId: otherTenantId, userId: adminUserId });

      expect(await other.organizations.getIdentityHistory(organizationId)).toEqual([]);
      expect(await other.organizations.getAssetMappingHistory(organizationId)).toEqual([]);
      expect(await other.organizations.getAssetMappingEventAssets(mappingEvent.id)).toEqual([]);
      expect(await other.financialProfiles.getFinancialProfileHistory(organizationId)).toEqual([]);
    });
  });

  describe('asset mapping', () => {
    const history = async () => services.withOrigin(adminOrigin).organizations.getAssetMappingHistory(organizationId);
    const assetsOf = async (eventId: string) => (await services.withOrigin(adminOrigin).organizations.getAssetMappingEventAssets(eventId))
      .map((asset) => [asset.change, asset.name]).toSorted();

    it('should journal one event per save, with the assets it really added and removed', async () => {
      const [first, second, third] = [await createAsset('a'), await createAsset('b'), await createAsset('c')];
      const scoped = services.withOrigin(adminOrigin).organizations;
      await scoped.updateOrganization(organizationId, { estateMode: 'closed', mapping: { added: [first, second], removed: [] } });
      await scoped.updateOrganization(organizationId, { mapping: { added: [first, third], removed: [second] } });

      const [latest, earliest] = await history();
      expect(earliest).toMatchObject({ addedCount: 2, removedCount: 0, estateMode: { from: 'open', to: 'closed' } });
      expect(latest).toMatchObject({ addedCount: 1, removedCount: 1, estateMode: null });
      expect(await assetsOf(latest.id)).toEqual([['added', 'c'], ['removed', 'b']]);
    });

    it('should journal nothing for a save that maps nothing new and keeps the estate mode', async () => {
      const asset = await createAsset('a');
      const scoped = services.withOrigin(adminOrigin).organizations;
      await scoped.updateOrganization(organizationId, { mapping: { added: [asset], removed: [] } });
      await scoped.updateOrganization(organizationId, { estateMode: 'open', mapping: { added: [asset], removed: [uuidv7()] } });

      expect(await history()).toHaveLength(1);
    });

    it('should leave alone, and journal nothing for, an asset a save both adds and removes', async () => {
      const [mapped, unmapped, kept] = [await createAsset('mapped'), await createAsset('unmapped'), await createAsset('kept')];
      const scoped = services.withOrigin(adminOrigin).organizations;
      await scoped.updateOrganization(organizationId, { mapping: { added: [mapped], removed: [] } });
      await scoped.updateOrganization(organizationId, { mapping: { added: [kept, mapped, unmapped], removed: [mapped, unmapped] } });

      const [latest] = await history();
      expect(latest).toMatchObject({ addedCount: 1, removedCount: 0 });
      expect(await assetsOf(latest.id)).toEqual([['added', 'kept']]);
      expect(await scoped.getOrganization(organizationId)).toMatchObject({ mappedAssetCount: 2 });
    });

    it('should journal the assets a scope is created with and an asset created inside it', async () => {
      const asset = await createAsset('a');
      const created = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id: created, name: 'Closed', estateMode: 'closed', mappedAssetIds: [asset] },
      ]);
      await createAsset('inside', created);

      const events = await services.withOrigin(adminOrigin).organizations.getAssetMappingHistory(created);
      expect(events.map((event) => [event.addedCount, event.removedCount])).toEqual([[1, 0], [1, 0]]);
    });

    it('should keep the counts of an event whose asset was deleted since', async () => {
      const asset = await createAsset('a');
      await services.withOrigin(adminOrigin).organizations.updateOrganization(organizationId, { mapping: { added: [asset], removed: [] } });
      await services.withOrigin(adminOrigin).supportingAssets.deleteSupportingAssets([asset]);

      const [event] = await history();
      expect(event.addedCount).toBe(1);
      expect(await assetsOf(event.id)).toEqual([]);
    });

    it('should go with its risk scope', async () => {
      await services.withOrigin(adminOrigin).organizations.updateOrganization(organizationId, { mapping: { added: [await createAsset('a')], removed: [] } });
      await services.withOrigin(adminOrigin).organizations.deleteOrganizations([organizationId]);

      expect(await db.select().from(organizationAssetMappingEvents).where(eq(organizationAssetMappingEvents.organizationId, organizationId))).toEqual([]);
    });
  });
});
