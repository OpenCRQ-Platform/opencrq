import type { EventOrigin } from '@app/module';
import { markingStixId } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
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
    ]);
    expect(result).toEqual({ synced: 2, skipped: 1 });

    const after = await scoped.listMarkingDefinitions();
    const redAfter = after.find((marking) => marking.stixId === TLP_RED);
    expect(redAfter).toMatchObject({ id: redBefore!.id, color: '#c62828', order: 4 });
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
});
