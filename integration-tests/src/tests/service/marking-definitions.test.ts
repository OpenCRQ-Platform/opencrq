import type { ConnectorAssetInput, EventOrigin } from '@app/module';
import { markingStixId, ProtectedMarkingDefinitionError } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const TLP_RED = 'marking-definition--5e57c739-391a-4eb3-b6be-7d15ca92d5ed';

describe('Marking definitions service (CTEM marking parity, G2 slice 3)', () => {
  let adminOrigin: EventOrigin;

  beforeEach(async () => {
    await truncateAllTables(db);
    adminOrigin = (await createTenantWithAdmin(services)).origin;
  });

  it('should list the TLP 2.0 markings a tenant starts with, under OpenCTI ids', async () => {
    const markings = await services.withOrigin(adminOrigin).markingDefinitions.listMarkingDefinitions();
    expect(markings.map((marking) => marking.definition)).toEqual(['TLP:CLEAR', 'TLP:GREEN', 'TLP:AMBER', 'TLP:AMBER+STRICT', 'TLP:RED']);
    expect(markings.find((marking) => marking.definition === 'TLP:RED')?.stixId).toBe(TLP_RED);
  });

  it('should create a marking under the STIX id OpenCTI derives, once', async () => {
    const scoped = services.withOrigin(adminOrigin).markingDefinitions;
    const first = await scoped.createMarkingDefinition({ definitionType: 'PAP', definition: 'PAP:RED', order: 4 });
    expect(first.created).toBe(true);
    expect(first.stixId).toBe(markingStixId('PAP', 'PAP:RED'));

    const again = await scoped.createMarkingDefinition({ definitionType: 'PAP', definition: 'PAP:RED' });
    expect(again).toEqual({ id: first.id, stixId: first.stixId, created: false });
    expect((await scoped.listMarkingDefinitions()).filter((marking) => marking.stixId === first.stixId)).toHaveLength(1);
  });

  it('should add and remove a marking from a group clearance', async () => {
    const groupId = uuidv7();
    await services.withOrigin(adminOrigin).groups.createGroup({ id: groupId, name: 'Analysts' });
    const scoped = services.withOrigin(adminOrigin).markingDefinitions;
    const red = (await scoped.listMarkingDefinitions()).find((marking) => marking.stixId === TLP_RED);
    expect(red).toBeDefined();

    await scoped.addMarkingToGroup(groupId, red!.id);
    expect((await scoped.getGroupMarkings(groupId)).map((marking) => marking.stixId)).toEqual([TLP_RED]);

    await scoped.removeMarkingFromGroup(groupId, red!.id);
    expect(await scoped.getGroupMarkings(groupId)).toEqual([]);
  });

  it('should sync the markings OpenCTI defines, keeping row ids and the markings it no longer lists', async () => {
    const system = services.withOrigin({ type: 'system' }).markingDefinitions;
    const tenantId = adminOrigin.type === 'client' ? adminOrigin.tenantId : '';
    const scoped = services.withOrigin(adminOrigin).markingDefinitions;
    const redBefore = (await scoped.listMarkingDefinitions()).find((marking) => marking.stixId === TLP_RED);
    const papRed = markingStixId('PAP', 'PAP:RED');

    const result = await system.syncMarkingDefinitions(tenantId, [
      { stixId: TLP_RED, definitionType: 'TLP', definition: 'TLP:RED', color: '#c62828', order: 4 },
      { stixId: papRed, definitionType: 'PAP', definition: 'PAP:RED', color: null, order: 4 },
      { stixId: 'not-a-stix-id', definitionType: 'PAP', definition: 'PAP:GREEN', color: null, order: 2 },
    ], 'opencti');
    expect(result).toEqual({ synced: 2, skipped: 1 });

    const after = await scoped.listMarkingDefinitions();
    const redAfter = after.find((marking) => marking.stixId === TLP_RED);
    // OpenCTI ships TLP:RED at rank 5, whatever the order it states.
    expect(redAfter).toMatchObject({ id: redBefore!.id, color: '#c62828', order: 5 });
    expect(after.find((marking) => marking.stixId === papRed)).toMatchObject({ definitionType: 'PAP', definition: 'PAP:RED', order: 4 });
    expect(after.map((marking) => marking.definition)).toContain('TLP:CLEAR');
  });

  it('should refuse a marking of another tenant on a group', async () => {
    const other = await createTenantWithAdmin(services);
    const foreign = await services.withOrigin(other.origin).markingDefinitions
      .createMarkingDefinition({ definitionType: 'PAP', definition: 'PAP:AMBER' });
    const groupId = uuidv7();
    await services.withOrigin(adminOrigin).groups.createGroup({ id: groupId, name: 'Analysts' });

    await expect(
      services.withOrigin(adminOrigin).markingDefinitions.addMarkingToGroup(groupId, foreign.id),
    ).rejects.toThrow('Access Denied');
  });
  describe('rank of the markings a peer defines', () => {
    const CUSTOM = markingStixId('CUSTOM', 'CUSTOM:SECRET');
    const tenantId = () => (adminOrigin.type === 'client' ? adminOrigin.tenantId : '');
    const rankOf = async (stixId: string) =>
      (await services.withOrigin(adminOrigin).markingDefinitions.listMarkingDefinitions()).find((marking) => marking.stixId === stixId)?.order;
    const sync = (source: 'opencti' | 'openaev', order: number | null) => services.withOrigin({ type: 'system' }).markingDefinitions
      .syncMarkingDefinitions(tenantId(), [{ stixId: CUSTOM, definitionType: 'CUSTOM', definition: 'CUSTOM:SECRET', color: null, order }], source);

    it('should keep the stored rank when OpenCTI states none', async () => {
      await sync('opencti', 3);

      await sync('opencti', null);

      expect(await rankOf(CUSTOM)).toBe(3);
    });

    it('should take the rank OpenCTI changes', async () => {
      await sync('opencti', 3);

      await sync('opencti', 2);

      expect(await rankOf(CUSTOM)).toBe(2);
    });

    it('should let OpenAEV rank a marking it creates, never move the rank of one that exists', async () => {
      await sync('openaev', 3);
      expect(await rankOf(CUSTOM)).toBe(3);

      await sync('openaev', 1);

      expect(await rankOf(CUSTOM)).toBe(3);
    });

    it('should store a marking created without a rank as unranked', async () => {
      const { stixId } = await services.withOrigin(adminOrigin).markingDefinitions.createMarkingDefinition({ definitionType: 'CUSTOM', definition: 'CUSTOM:SECRET' });

      expect(await rankOf(stixId)).toBeNull();
    });
  });

  describe('clearance by rank', () => {
    const SECRET_UNRANKED = markingStixId('CUSTOM', 'CUSTOM:UNRANKED');
    const SECRET_RANKED = markingStixId('CUSTOM', 'CUSTOM:RANKED');
    let tenantId: string;
    let connectorId: string;
    let connectorOrigin: EventOrigin;
    let unrankedAssetId: string;
    let rankedAssetId: string;
    let holdsRanked: EventOrigin;
    let holdsUnranked: EventOrigin;

    const holdFor = async (marking: string, member: { userId: string }) => {
      const scoped = services.withOrigin(adminOrigin);
      const groupId = uuidv7();
      await scoped.groups.createGroup({ id: groupId, name: `Holds ${marking.slice(-6)}` });
      await scoped.groups.addUserToGroup(groupId, member.userId);
      const markingId = (await scoped.markingDefinitions.listMarkingDefinitions()).find((candidate) => candidate.stixId === marking)!.id;
      await scoped.markingDefinitions.addMarkingToGroup(groupId, markingId);
    };

    const asset = (sourceAssetId: string, markingRefs: Array<string>): ConnectorAssetInput => ({
      sourceAssetId, categoryId: 'host', connectorId, source: 'openaev', name: sourceAssetId, markingRefs,
      properties: { family: 'machine', hostname: `${sourceAssetId}.corp.example` },
    });

    const sees = async (origin: EventOrigin, assetId: string) =>
      (await services.withOrigin(origin).supportingAssets.getSupportingAsset(assetId)) !== null;

    beforeEach(async () => {
      tenantId = adminOrigin.type === 'client' ? adminOrigin.tenantId : '';
      const scoped = services.withOrigin(adminOrigin).markingDefinitions;
      await scoped.createMarkingDefinition({ definitionType: 'CUSTOM', definition: 'CUSTOM:UNRANKED' });
      await scoped.createMarkingDefinition({ definitionType: 'CUSTOM', definition: 'CUSTOM:RANKED', order: 3 });
      const rankedMember = await createTenantUser(services, db, adminOrigin);
      const unrankedMember = await createTenantUser(services, db, adminOrigin);
      holdsRanked = rankedMember.origin;
      holdsUnranked = unrankedMember.origin;
      await holdFor(SECRET_RANKED, rankedMember);
      await holdFor(SECRET_UNRANKED, unrankedMember);

      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Test OpenAEV Bot' });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
      connectorOrigin = { type: 'connector', serviceAccountId, tenantId };
      const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
        asset('oaev-unranked', [SECRET_UNRANKED]),
        asset('oaev-ranked', [SECRET_RANKED]),
      ]);
      unrankedAssetId = idMap.get('oaev-unranked')!;
      rankedAssetId = idMap.get('oaev-ranked')!;
    });

    it('should not clear an unranked marking through a ranked marking of its type', async () => {
      expect(await sees(holdsRanked, unrankedAssetId)).toBe(false);
    });

    it('should clear an unranked marking for the group that holds it directly', async () => {
      expect(await sees(holdsUnranked, unrankedAssetId)).toBe(true);
    });

    it('should not clear a ranked marking through an unranked one, and keep the rank expansion of ranked markings', async () => {
      expect(await sees(holdsUnranked, rankedAssetId)).toBe(false);
      expect(await sees(holdsRanked, rankedAssetId)).toBe(true);
    });
  });

  describe('a default marking', () => {
    it('should refuse a change of rank of TLP:RED, and keep its rank', async () => {
      const scoped = services.withOrigin(adminOrigin).markingDefinitions;
      const red = (await scoped.listMarkingDefinitions()).find((marking) => marking.stixId === TLP_RED)!;

      await expect(scoped.updateMarkingDefinition(red.id, { order: 1 })).rejects.toBeInstanceOf(ProtectedMarkingDefinitionError);

      expect((await scoped.listMarkingDefinitions()).find((marking) => marking.stixId === TLP_RED)?.order).toBe(5);
    });

    it('should accept its colour alone, or the rank it already has', async () => {
      const scoped = services.withOrigin(adminOrigin).markingDefinitions;
      const red = (await scoped.listMarkingDefinitions()).find((marking) => marking.stixId === TLP_RED)!;

      await scoped.updateMarkingDefinition(red.id, { color: '#000000' });
      await scoped.updateMarkingDefinition(red.id, { order: 5 });

      expect((await scoped.listMarkingDefinitions()).find((marking) => marking.stixId === TLP_RED)).toMatchObject({ color: '#000000', order: 5 });
    });

    it('should let a PAP marking change its rank', async () => {
      const scoped = services.withOrigin(adminOrigin).markingDefinitions;
      const { id, stixId } = await scoped.createMarkingDefinition({ definitionType: 'PAP', definition: 'PAP:RED' });

      await scoped.updateMarkingDefinition(id, { order: 2 });

      expect((await scoped.listMarkingDefinitions()).find((marking) => marking.stixId === stixId)?.order).toBe(2);
    });
  });
});
