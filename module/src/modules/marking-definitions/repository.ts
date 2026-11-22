import { and, asc, eq } from 'drizzle-orm';
import { newError } from '@app/utils';
import { defineRepository } from '../../registry';
import { groupMarkingDefinitions, markingDefinitions } from './schema';

/**
 * The marking definitions of a tenant and the clearance of its groups (CTEM marking parity, G2).
 * Reads go through the secured views, so a caller reads only its own tenant; writes are guarded by
 * `manageSecurityWritePolicy` and by the security procedure in `back`.
 */
export const markingDefinitionsRepository = defineRepository({
  findMarkingDefinitions: ({ db, views }) => db.select({
    id: views.markingDefinitions.id,
    stixId: views.markingDefinitions.stixId,
    definitionType: views.markingDefinitions.definitionType,
    definition: views.markingDefinitions.definition,
    color: views.markingDefinitions.color,
    order: views.markingDefinitions.order,
  })
    .from(views.markingDefinitions)
    .orderBy(asc(views.markingDefinitions.definitionType), asc(views.markingDefinitions.order), asc(views.markingDefinitions.definition)),
  findMarkingDefinitionByStixId: async ({ db, views }, stixId: string) => {
    const rows = await db.select({ id: views.markingDefinitions.id })
      .from(views.markingDefinitions)
      .where(eq(views.markingDefinitions.stixId, stixId))
      .limit(1);
    return rows.length > 0 ? rows[0] : undefined;
  },
  insertMarkingDefinition: ({ db }, marking: typeof markingDefinitions.$inferInsert) =>
    db.insert(markingDefinitions).values(marking).onConflictDoNothing(),
  updateMarkingDefinition: ({ db }, id: string, values: { color?: string | null, order?: number }) =>
    db.update(markingDefinitions).set(values).where(eq(markingDefinitions.id, id)),
  deleteMarkingDefinition: ({ db }, id: string) => db.delete(markingDefinitions).where(eq(markingDefinitions.id, id)),

  findGroupMarkings: ({ db, views }, groupId: string) => db.select({
    id: views.markingDefinitions.id,
    stixId: views.markingDefinitions.stixId,
    definitionType: views.markingDefinitions.definitionType,
    definition: views.markingDefinitions.definition,
  })
    .from(views.groupMarkingDefinitions)
    .innerJoin(views.markingDefinitions, eq(views.groupMarkingDefinitions.markingDefinitionId, views.markingDefinitions.id))
    .where(eq(views.groupMarkingDefinitions.groupId, groupId))
    .orderBy(asc(views.markingDefinitions.definitionType), asc(views.markingDefinitions.order)),
  addGroupMarking: async ({ db, views }, tenantId: string, groupId: string, markingDefinitionId: string) => {
    const [group, marking] = await Promise.all([
      db.select({ id: views.groups.id }).from(views.groups).where(eq(views.groups.id, groupId)).limit(1),
      db.select({ id: views.markingDefinitions.id }).from(views.markingDefinitions).where(eq(views.markingDefinitions.id, markingDefinitionId)).limit(1),
    ]);
    if (group.length === 0 || marking.length === 0) {
      throw newError('Access Denied');
    }
    return db.insert(groupMarkingDefinitions).values({ tenantId, groupId, markingDefinitionId }).onConflictDoNothing();
  },
  removeGroupMarking: ({ db }, groupId: string, markingDefinitionId: string) =>
    db.delete(groupMarkingDefinitions).where(and(
      eq(groupMarkingDefinitions.groupId, groupId),
      eq(groupMarkingDefinitions.markingDefinitionId, markingDefinitionId),
    )),
});
